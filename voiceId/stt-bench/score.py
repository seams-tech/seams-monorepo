"""Score the bench runs: dictation errors, key terms and approval decisions.

Approval uses two policies on the free transcript. `strict` accepts only an
exact match with the displayed phrase after normalization; spacing inside the
words does not count. `one_edit` also accepts one changed, missing or added
word. Neither policy constrains the decoder to the expected phrase.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import jiwer
from whisper_normalizer.english import EnglishTextNormalizer

import corpus

_english = EnglishTextNormalizer()
_KANJI_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_KANJI_UNITS = {"十": 10, "百": 100, "千": 1000}
_KANJI_RUN = re.compile("[〇零一二三四五六七八九十百千万]+")
NEAR_MISS_KINDS = ("negation", "verb", "detail", "missing")


def normalize_en(text: str) -> str:
    text = re.sub(r"(\d{1,2}):(\d{2})", r"\1\2", text)
    text = re.sub(r"¥\s?([\d,]+)", r"\1 yen", text)
    text = re.sub(r"(\d)\s?°\s?C?", r"\1 degrees", text)
    text = re.sub(r"\b(kg|kilograms)\b", "kilos", text, flags=re.IGNORECASE)
    return _english(text)


def _kanji_number(run: str) -> str:
    if not any(ch in _KANJI_UNITS or ch == "万" for ch in run):
        return "".join(str(_KANJI_DIGITS[ch]) for ch in run)
    total = section = number = 0
    for ch in run:
        if ch in _KANJI_DIGITS:
            number = _KANJI_DIGITS[ch]
        elif ch in _KANJI_UNITS:
            section += (number or 1) * _KANJI_UNITS[ch]
            number = 0
        else:
            total += (section + number or 1) * 10000
            section = number = 0
    return str(total + section + number)


def normalize_ja(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("%", "パーセント").replace("°C", "度").replace("°", "度")
    text = _KANJI_RUN.sub(lambda m: _kanji_number(m.group(0)), text)
    return "".join(ch for ch in text if unicodedata.category(ch)[0] in "LN").lower()


def contains_term(hypothesis: str, term: str, language: str) -> bool:
    if language == "ja":
        return normalize_ja(term) in hypothesis
    return f" {normalize_en(term)} " in f" {hypothesis} "


def word_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def noise_band(condition: str) -> str:
    return "clean" if condition == "clean" else f"{re.sub(r'[a-z]+', '', condition)} dB"


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def score_dictation(rows: list[dict]) -> dict:
    language = rows[0]["language"]
    norm = normalize_ja if language == "ja" else normalize_en
    refs = [norm(r["reference"]) for r in rows]
    hyps = [norm(r["hypothesis"]) for r in rows]
    if language == "ja":
        errors = jiwer.process_characters(refs, hyps).cer
    else:
        safe_hyps = [h if h else "<empty>" for h in hyps]
        errors = jiwer.process_words(refs, safe_hyps).wer
    terms = hits = 0
    for row, hyp in zip(rows, hyps):
        for term in row.get("keyTerms", []):
            terms += 1
            hits += contains_term(hyp, term, language)
    exact = sum(r == h for r, h in zip(refs, hyps))
    return {"cases": len(rows), "errorRate": round(errors, 4), "errorUnit": "character" if language == "ja" else "word",
            "keyTermRecall": rate(hits, terms), "exactSentences": rate(exact, len(rows))}


def score_approval(rows: list[dict], bank: tuple[corpus.ApprovalPhrase, ...]) -> dict:
    phrases = {p.id: normalize_en(p.text).split() for p in bank}
    counts = defaultdict(lambda: [0, 0])
    for row in rows:
        spoken = normalize_en(row["hypothesis"]).split()
        for policy, limit in (("strict", 0), ("one_edit", 1)):
            # "Re-fund" and "refund" are the same words; spacing alone never refuses.
            accepted = {pid for pid, words in phrases.items()
                        if word_distance(spoken, words) <= limit or "".join(spoken) == "".join(words)}
            variant = row["variant"]
            if variant == "correct":
                counts[(policy, "trueAccept")][0] += row["phraseId"] in accepted
                counts[(policy, "trueAccept")][1] += 1
            elif variant in NEAR_MISS_KINDS:
                for key in ("nearMissAccept", f"nearMissAccept.{variant}"):
                    counts[(policy, key)][0] += row["phraseId"] in accepted
                    counts[(policy, key)][1] += 1
            else:
                counts[(policy, "unrelatedAccept")][0] += bool(accepted)
                counts[(policy, "unrelatedAccept")][1] += 1
            if variant == "correct" or variant == "unrelated":
                others = [pid for pid in phrases if pid != row["phraseId"]]
                counts[(policy, "crossPhraseAccept")][0] += sum(pid in accepted for pid in others)
                counts[(policy, "crossPhraseAccept")][1] += len(others)
    result: dict = {}
    for (policy, key), (hit, total) in sorted(counts.items()):
        result.setdefault(policy, {})[key] = {"rate": rate(hit, total), "count": hit, "of": total}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    parser.add_argument("--report", type=Path, required=True, help="Report path without extension.")
    args = parser.parse_args()
    cache: Path = args.cache.resolve()

    cases = {}
    for line in (cache / "cases.jsonl").read_text(encoding="utf-8").splitlines():
        case = json.loads(line)
        cases[case["caseId"]] = case
    runs = {}
    joined: list[dict] = []
    for summary_path in sorted((cache / "runs").glob("*.summary.json")):
        summary = json.loads(summary_path.read_text())
        run_id = summary["runId"]
        runs[run_id] = summary
        for line in (cache / "runs" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines():
            output = json.loads(line)
            joined.append({**cases[output["caseId"]], **output, "runId": run_id})

    groups = defaultdict(list)
    for row in joined:
        groups[(row["runId"], row["set"], row["condition"])].append(row)
        groups[(row["runId"], row["set"], noise_band(row["condition"]))].append(row)
        groups[(row["runId"], row["set"], "all")].append(row)
    results = []
    for (run_id, set_name, condition), rows in sorted(groups.items()):
        bank = corpus.APPROVAL_BANKS.get(set_name)
        metrics = score_approval(rows, bank) if bank else score_dictation(rows)
        results.append({"runId": run_id, "set": set_name, "condition": condition, **metrics})

    inputs = json.loads((cache / "inputs-manifest.json").read_text())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": "stt_bench_report_v1", "inputs": inputs, "runs": runs, "results": results}
    args.report.with_suffix(".json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    with gzip.open(args.report.with_name(args.report.name + "-cases.jsonl.gz"), "wt", encoding="utf-8") as handle:
        for row in joined:
            handle.write(json.dumps({k: row[k] for k in ("runId", "caseId", "set", "condition", "reference",
                                                         "hypothesis", "computeSeconds")}, ensure_ascii=False) + "\n")
    print(f"{len(joined)} transcripts in {len(runs)} runs")


if __name__ == "__main__":
    main()
