"""Write the Markdown tables for one bench report next to its JSON."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BANDS = ("clean", "10 dB", "5 dB", "0 dB")


def percent(value: float | None) -> str:
    return "–" if value is None else f"{value * 100:.1f}%"


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def main() -> None:
    report_path = Path(sys.argv[1])
    report = json.loads(report_path.read_text())
    results = {(r["runId"], r["set"], r["condition"]): r for r in report["results"]}
    runs = sorted(report["runs"])

    def metric(run: str, set_name: str, band: str, key: str) -> float | None:
        result = results.get((run, set_name, band))
        return None if result is None else result[key]

    sections = [f"# Speech-to-text bench report\n\nSource: `{report_path.name}`. Error rates are lower-is-better; "
                "recall and accept rates of the correct phrase are higher-is-better.\n"]
    for set_name, title, key in (
        ("dictation_en", "English bakery dictation: word error rate", "errorRate"),
        ("dictation_en", "English bakery dictation: key-term recall", "keyTermRecall"),
        ("fleurs_en", "English human read speech (FLEURS): word error rate", "errorRate"),
        ("dictation_ja", "Japanese bakery dictation: character error rate", "errorRate"),
        ("dictation_ja", "Japanese bakery dictation: key-term recall", "keyTermRecall"),
        ("fleurs_ja", "Japanese human read speech (FLEURS): character error rate", "errorRate"),
    ):
        rows = [[run] + [percent(metric(run, set_name, band, key)) for band in BANDS]
                for run in runs if (run, set_name, "all") in results]
        sections.append(f"## {title}\n\n" + table(["Run", *BANDS], rows))

    for policy in ("strict", "one_edit"):
        rows = []
        for run in runs:
            if (run, "approval_en", "all") not in results:
                continue
            row = [run]
            for band in BANDS:
                stats = results[(run, "approval_en", band)][policy]
                row.append(f"{percent(stats['trueAccept']['rate'])} / {percent(stats['nearMissAccept']['rate'])}")
            overall = results[(run, "approval_en", "all")][policy]
            row += [percent(overall[f"nearMissAccept.{kind}"]["rate"]) for kind in ("negation", "verb", "detail", "missing")]
            row += [percent(overall["unrelatedAccept"]["rate"]), percent(overall["crossPhraseAccept"]["rate"])]
            rows.append(row)
        header = ["Run", *(f"{band}: correct / near miss" for band in BANDS),
                  "negation", "verb", "detail", "missing", "unrelated", "other phrase"]
        sections.append(f"## Approval phrases, `{policy}` policy: accept rates\n\n" + table(header, rows))

    rows = []
    for run in runs:
        summary = report["runs"][run]
        rows.append([run, f"{summary['modelBytes'] / 1e6:.0f} MB", f"{summary['loadSeconds']:.1f} s",
                     f"{summary['computeSeconds'] / summary['caseCount'] * 1000:.0f} ms",
                     f"{summary['realTimeFactor']:.3f}", f"{summary['peakResidentBytes'] / 1e9:.2f} GB",
                     f"{summary['peakGpuBytes'] / 1e9:.2f} GB" if summary["peakGpuBytes"] else "–"])
    sections.append("## Size and speed on this Mac\n\n" + table(
        ["Run", "Model files", "Load", "Mean per utterance", "Real-time factor", "Peak resident", "Peak GPU"], rows))

    report_path.with_suffix(".md").write_text("\n\n".join(sections) + "\n")
    print(report_path.with_suffix(".md"))


if __name__ == "__main__":
    main()
