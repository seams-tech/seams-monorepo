"""Explicit model provisioning, ONNX export, and consented local reference preparation.

This maintenance command downloads public model assets only. Fixture media and
embeddings stay in the explicitly selected local directory. Rust inference does
not call this command or access the network.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import sys
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch
from moonshine_voice.download_file import download_file
from moonshine_voice import ModelArch, Transcriber
from speechbrain.inference.speaker import EncoderClassifier
from speechbrain.utils.fetching import LocalStrategy

from compare_models import load_fixture_inventory
from model_manifest import ARTIFACTS, build_artifact

VERIFIER_DIRECTORY = Path(__file__).resolve().parents[1] / "verifier"
if str(VERIFIER_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(VERIFIER_DIRECTORY))

from voiceid_verifier.audio_decode import decode_audio_bytes, zero_float_sequence
from voiceid_verifier.moonshine import normalize_transcript

MODEL_MANIFEST = Path(__file__).with_name("model-manifest.json")
ARTIFACT_IDS = (
    "moonshine-streaming-tiny-native-quantized",
    "speechbrain-ecapa-voxceleb",
)
EXPECTED_PACKAGES = {
    "torch": "2.6.0",
    "speechbrain": "1.1.0",
    "moonshine-voice": "0.1.5",
    "onnx": "1.17.0",
    "onnxruntime": "1.23.2",
    "numpy": "2.2.6",
}
BOUNDARY_SAMPLE_COUNTS = (7841, 7999, 8000, 8001, 10239, 10240, 10241, 15999, 16000, 16001, 47999)


class ExportSTFT(torch.autograd.Function):
    """Translate the pinned real/imaginary STFT representation to ONNX STFT."""

    @staticmethod
    def forward(context, samples, window):
        spectrum = torch.stft(
            samples, n_fft=400, hop_length=160, win_length=400, window=window,
            center=True, pad_mode="constant", normalized=False, onesided=True,
            return_complex=True,
        )
        return torch.view_as_real(spectrum).transpose(1, 2)

    @staticmethod
    def symbolic(graph, samples, window):
        padding = graph.op("Constant", value_t=torch.tensor([0, 200, 0, 200], dtype=torch.int64))
        padded = graph.op("Pad", samples, padding, mode_s="constant")
        axis = graph.op("Constant", value_t=torch.tensor([-1], dtype=torch.int64))
        real_input = graph.op("Unsqueeze", padded, axis)
        step = graph.op("Constant", value_t=torch.tensor(160, dtype=torch.int64))
        frame = graph.op("Constant", value_t=torch.tensor(400, dtype=torch.int64))
        result = graph.op("STFT", real_input, step, window, frame, onesided_i=1)
        return result.setType(samples.type().with_sizes([1, None, 201, 2]))


class ExportableSTFT(torch.nn.Module):
    def __init__(self, source):
        super().__init__()
        configuration = (
            source.sample_rate, source.n_fft, source.hop_length, source.win_length,
            source.center, source.pad_mode, source.normalized_stft, source.onesided,
        )
        if configuration != (16000, 400, 160, 400, True, "constant", False, True):
            raise ValueError("ECAPA preprocessing differs from the pinned export profile")
        self.register_buffer("window", source.window.detach().clone())

    def forward(self, samples):
        return ExportSTFT.apply(samples, self.window)


class NativeEcapaEncoder(torch.nn.Module):
    def __init__(self, classifier):
        super().__init__()
        self.features = copy.deepcopy(classifier.mods.compute_features)
        self.features.compute_STFT = ExportableSTFT(self.features.compute_STFT)
        normalization = classifier.mods.mean_var_norm
        if normalization.norm_type != "sentence" or normalization.std_norm:
            raise ValueError("ECAPA export requires full-utterance mean normalization")
        self.embedding = classifier.mods.embedding_model

    def forward(self, samples):
        lengths = torch.ones(samples.shape[0], device=samples.device)
        features = self.features(samples)
        features = features - features.mean(dim=1, keepdim=True)
        return self.embedding(features, lengths).reshape(1, 192)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_identity(path: Path) -> dict:
    return {"path": str(path.resolve()), "sha256": list(bytes.fromhex(sha256_file(path)))}


def provision_models(directory: Path) -> dict:
    manifest = json.loads(MODEL_MANIFEST.read_text())
    selected = {}
    for artifact in manifest["artifacts"]:
        if artifact["id"] not in ARTIFACT_IDS:
            continue
        for entry in artifact["files"]:
            destination = directory / artifact["relativePath"] / entry["path"]
            if artifact["id"].startswith("moonshine"):
                url = "https://" + entry["path"]
            else:
                url = artifact["source"] + "/resolve/" + artifact["revision"] + "/" + entry["path"]
            download_file(url, destination, expected_sha256=entry["sha256"], show_progress=False)
        selected[artifact["id"]] = artifact
    for specification in ARTIFACTS:
        if specification.artifact_id in selected:
            actual = build_artifact(directory, specification)
            if actual != selected[specification.artifact_id]:
                raise ValueError("provisioned model differs from its immutable manifest")
    if set(selected) != set(ARTIFACT_IDS):
        raise ValueError("the model manifest lacks a required native baseline")
    return selected


def load_reference_encoder(directory: Path):
    return EncoderClassifier.from_hparams(
        source=str(directory), savedir=str(directory / ".cache/reference-loader"),
        overrides={"pretrained_path": str(directory)}, run_opts={"device": "cpu"},
        local_strategy=LocalStrategy.COPY,
    )


def export_ecapa(classifier, output: Path) -> dict:
    model = NativeEcapaEncoder(classifier).eval()
    # Export translation uses ONNX STFT while the reference keeps the original complex STFT.
    generator = torch.Generator().manual_seed(417)
    sample = torch.randn(1, 16000, generator=generator)
    started = time.perf_counter()
    with torch.inference_mode():
        torch.onnx.export(
            model, sample, str(output), input_names=["samples"], output_names=["embedding"],
            dynamic_axes={"samples": {1: "samples_count"}}, opset_version=17, dynamo=False,
        )
    onnx.checker.check_model(str(output), full_check=True)
    return {"durationMs": round((time.perf_counter() - started) * 1000, 3), **file_identity(output)}


def reference_transcript(samples, model_directory: Path) -> str:
    # The host supplies one utterance. Keep the backend's process-global VAD out of segmentation.
    options = {
        "vad_threshold": 0.0,
        "vad_hop_size": 160,
        "vad_look_behind_sample_count": 160,
        "vad_max_segment_duration": 0,
        "transcription_interval": 0.5,
    }
    with Transcriber(str(model_directory), model_arch=ModelArch.TINY_STREAMING,
                     update_interval=math.inf, options=options) as decoder:
        with decoder.create_stream() as stream:
            stream.start()
            samples_since_update = 0
            for offset in range(0, len(samples), 1600):
                chunk = list(samples[offset:offset + 1600])
                try:
                    stream.add_audio(chunk, sample_rate=16000)
                    samples_since_update += len(chunk)
                    if samples_since_update >= 8000:
                        stream.update_transcription()
                        samples_since_update = 0
                finally:
                    zero_float_sequence(chunk)
            # Moonshine ingests full 80 ms blocks. Flush every source sample and one zero block.
            padding = 1280 + (-len(samples) % 1280)
            stream.add_audio([0.0] * padding, sample_rate=16000)
            stream.set_transcribe_flags(1)
            result = stream.stop()
            if result is None or any(not line.is_complete for line in result.lines):
                raise RuntimeError("native reference did not finalize its complete utterance")
            return normalize_transcript(" ".join(line.text for line in result.lines))


def normalize_fixture_pcm(samples) -> float:
    peak = 0.0
    for sample in samples:
        if not math.isfinite(sample):
            raise ValueError("decoded fixture contains non-finite PCM")
        peak = max(peak, abs(sample))
    scale = max(1.0, peak)
    if scale > 1.0:
        for index in range(len(samples)):
            samples[index] /= scale
    return scale


def prepare_reference_case(
    fixture_id: str, relation: str, samples, peak_scale: float, pcm_directory: Path,
    moonshine_directory: Path, classifier, native_reference,
) -> tuple[dict, np.ndarray]:
    waveform = np.asarray(samples, dtype=np.float32).reshape(1, -1)
    with torch.inference_mode():
        embedding = classifier.encode_batch(torch.from_numpy(waveform)).numpy().reshape(-1)
    exported = native_reference.run(["embedding"], {"samples": waveform})[0].reshape(-1)
    direction = float(np.dot(embedding, exported) / np.linalg.norm(embedding) / np.linalg.norm(exported))
    if not np.isfinite(direction) or direction < 0.99999:
        raise ValueError("exported ECAPA differs from the reference speaker embedding")
    canonical = reference_transcript(samples, moonshine_directory)
    pcm_path = pcm_directory / (fixture_id + ".f32")
    pcm_path.write_bytes(waveform.astype("<f4").tobytes())
    pcm_path.chmod(0o600)
    case = {
        "id": fixture_id,
        "sourceFixtureId": fixture_id,
        "caseKind": "recording",
        "relation": relation,
        "pcm": file_identity(pcm_path),
        "sampleCount": len(samples),
        "peakScale": peak_scale,
        "referenceEmbedding": [float(value) for value in embedding],
        "referenceTranscriptSha256": list(hashlib.sha256(canonical.encode()).digest()),
        "exportDirectionCosine": direction,
    }
    print("prepared local reference", fixture_id, flush=True)
    return case, embedding


def prepare_references(
    directory: Path, fixture_manifest: Path, classifier, exported_model: Path,
) -> tuple[list, list]:
    inventory = load_fixture_inventory(fixture_manifest, check_media=True)
    pcm_directory = directory / "pcm"
    pcm_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    moonshine_directory = (
        directory / "models/moonshine/tiny/download.moonshine.ai/model/tiny-streaming-en/quantized"
    )
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    native_reference = onnxruntime.InferenceSession(
        str(exported_model), sess_options=options, providers=["CPUExecutionProvider"],
    )
    cases = []
    enrollment_vectors = []
    boundary_cases_prepared = False
    for entry in inventory.entries:
        decoded = decode_audio_bytes(entry.audio_path.read_bytes())
        try:
            peak_scale = normalize_fixture_pcm(decoded.samples)
            case, embedding = prepare_reference_case(
                entry.fixture_id, entry.expected_relation, decoded.samples, peak_scale,
                pcm_directory, moonshine_directory, classifier, native_reference,
            )
            cases.append(case)
            if entry.expected_relation == "owner_enrollment":
                enrollment_vectors.append(embedding.copy())
            if (not boundary_cases_prepared and entry.expected_relation == "owner_verification"
                    and len(decoded.samples) > max(BOUNDARY_SAMPLE_COUNTS)):
                for count in BOUNDARY_SAMPLE_COUNTS:
                    prefix = decoded.samples[:count]
                    try:
                        boundary_case, _ = prepare_reference_case(
                            f"{entry.fixture_id}_prefix_{count}", entry.expected_relation,
                            prefix, peak_scale, pcm_directory, moonshine_directory,
                            classifier, native_reference,
                        )
                        boundary_case["sourceFixtureId"] = entry.fixture_id
                        boundary_case["caseKind"] = "boundary_prefix"
                        cases.append(boundary_case)
                    finally:
                        zero_float_sequence(prefix)
                boundary_cases_prepared = True
        finally:
            zero_float_sequence(decoded.samples)
    if not boundary_cases_prepared:
        raise ValueError("native journey requires a verification recording for boundary cases")
    if len(enrollment_vectors) < 3:
        raise ValueError("native journey requires three deliberate owner enrollment captures")
    template = np.mean(np.vstack(enrollment_vectors), axis=0)
    return cases, [float(value) for value in template]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    args = parser.parse_args()
    packages = {}
    for name, expected in EXPECTED_PACKAGES.items():
        actual = version(name)
        if actual != expected:
            raise ValueError(f"native export requires {name}=={expected}, received {actual}")
        packages[name] = actual
    torch.set_num_threads(1)
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    artifacts = provision_models(directory / "models")
    classifier = load_reference_encoder(directory / "models/ecapa")
    exported_model = directory / "ecapa.onnx"
    exported = export_ecapa(classifier, exported_model)
    cases, template = prepare_references(directory, args.fixtures.resolve(), classifier, exported_model)
    import moonshine_voice
    library_directory = Path(moonshine_voice.__file__).parent
    payload = {
        "schemaVersion": "voiceid_native_journey_input_v1",
        "pcmNormalization": "finite_pcm_peak_scaled_only_when_peak_exceeds_one",
        "packages": packages,
        "modelManifestSha256": sha256_file(MODEL_MANIFEST),
        "exporterSha256": sha256_file(Path(__file__)),
        "sourceEcapaTreeSha256": artifacts["speechbrain-ecapa-voxceleb"]["treeSha256"],
        "export": exported,
        "modelDirectory": str(directory / "models"),
        "moonshineLibrary": file_identity(library_directory / "libmoonshine.dylib"),
        "onnxRuntimeLibrary": file_identity(library_directory / "libonnxruntime.1.23.2.dylib"),
        "speakerModel": file_identity(exported_model),
        "speakerAcceptSimilarity": 0.6,
        "speakerMinimumSamples": 8000,
        "speakerMinimumRms": 0.001,
        "speakerTemplate": template,
        "cases": cases,
    }
    output = directory / "native-inputs.json"
    output.write_text(json.dumps(payload, indent=2) + "\n")
    output.chmod(0o600)
    print("Native journey inputs:", output)
    print("Reference vectors and PCM remain private local research data.")


if __name__ == "__main__":
    main()
