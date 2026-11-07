"""Refactor 210 Gate STT-1: score Rule W and Rule A decisions of one
transcript source (Whisper large-v3 on NEAR AI Cloud).

Usage, from voiceId/stt-bench:
  python3 transaction-grammar/score_whisper.py <decisions.jsonl> <report.json>

<decisions.jsonl> comes from `txg-text rulew`. The script makes no network
calls.
"""
import collections
import difflib
import json
import statistics
import sys


def pct(n, d):
    return round(100.0 * n / d, 2) if d else None


def quantile(values, q):
    s = sorted(values)
    if not s:
        return None
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def word_diffs(expected, got):
    """Each non-equal span: "expected 'a' -> heard 'b'"."""
    e, g = expected.split(), got.split()
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=e, b=g, autojunk=False).get_opcodes():
        if op != "equal":
            out.append(f"'{' '.join(e[i1:i2])}' -> '{' '.join(g[j1:j2])}'")
    return out


def refusal_reasons(row):
    d = row.get("detail", {})
    stage = row["stage"]
    if stage == "normalize":
        bad = sorted({c for c in d["cleaned"] if not (c.isascii() and (c.isalnum() or c in " ,.!?;:'\"-_"))})
        return [f"normalize refused: characters {bad}" if bad else "normalize refused: numeral"]
    if stage.startswith("recipient"):
        label = {
            "recipient_no_key_match": "recipient key matches no contact",
            "recipient_ambiguous": "recipient key matches several contacts",
            "recipient_unkeyable": "recipient has a one-letter word",
        }[stage]
        exp_rec = row["expected"].split(" to ", 1)[1]
        return [f"{label}: '{exp_rec}' heard '{d.get('recipient')}'"]
    got = d.get("rendered") or d.get("normalized") or ""
    prefix = {"parse": f"parse {d.get('parseRefusal')}", "render_differs": "render differs", "words": "words differ"}[stage]
    diffs = word_diffs(row["expected"], got)
    return [f"{prefix}: {x}" for x in diffs] or [prefix]


def main():
    rows = [json.loads(l) for l in open(sys.argv[1])]
    ok = [r for r in rows if "error" not in r]
    errors = [r for r in rows if "error" in r]
    correct = [r for r in ok if r["role"] == "correct"]
    misses = [r for r in ok if r["role"] == "near_miss"]
    n_correct = sum(r["role"] == "correct" for r in rows)
    n_miss = sum(r["role"] == "near_miss" for r in rows)

    def acc(group, rule):
        return sum(r[rule] for r in group)

    report = {
        "gate": "STT-1",
        "model": "whisper-large-v3 (NEAR AI Cloud)",
        "date": "2026-11-07",
        "decisions": "txg-text rulew (transaction-grammar/grammar/src/rulew.rs)",
        "ruleDefinitions": {
            "ruleW": "text step (lowercase, trim, drop final . , ! ?, drop commas inside digit groups, "
            "'.' between letters or letter/digit -> ' dot ', '-' -> ' dash ', '_' -> ' underscore ', "
            "then normalize); transfers: words after the first 'to' must have the phonetic_key of exactly "
            "one contact, then parse_transfer + render must equal the expected spoken text; multisig: "
            "text-step words must equal the expected spoken text",
            "ruleWLiteral": "ruleW, but a '.' between two digits also becomes ' dot '",
            "ruleA": "normalize(transcript) equals the expected spoken text, word for word",
        },
        "cases": len(rows),
        "errors": len(errors),
        "errorSamples": errors[:10],
        "rules": {},
    }
    for rule in ("ruleW", "ruleWLiteral", "ruleA"):
        a = acc(correct, rule)
        fa = [r for r in misses if r[rule]]
        by = lambda key: {
            str(k): {"accepted": acc(g, rule), "cases": len(g), "percent": pct(acc(g, rule), len(g))}
            for k, g in sorted(group_by(correct, key).items())
        }
        report["rules"][rule] = {
            "correctAccepted": a,
            "correctCases": n_correct,
            "correctPercent": pct(a, n_correct),
            "correctByVoice": by("voice"),
            "correctByRate": by("rate"),
            "correctByRequestKind": by("requestKind"),
            "nearMissesAccepted": len(fa),
            "nearMissCases": n_miss,
            "nearMissesByKind": {
                k: {"accepted": sum(r[rule] for r in g), "cases": len(g)}
                for k, g in sorted(group_by(misses, "missKind").items())
            },
            "falseAccepts": [
                {k: r[k] for k in ("caseId", "missKind", "audioText", "expected", "heard")} for r in fa
            ],
            "pass": n_correct > 0 and a >= 0.95 * n_correct and not fa,
        }

    lat = [r["seconds"] for r in ok]
    ratio = [r["seconds"] / r["audioSeconds"] for r in ok if r.get("audioSeconds")]
    audio = [r["audioSeconds"] for r in ok]
    report["latency"] = {
        "callSecondsMedian": round(statistics.median(lat), 3),
        "callSecondsP95": round(quantile(lat, 0.95), 3),
        "audioSecondsMedian": round(statistics.median(audio), 3),
        "ratioToAudioMedian": round(statistics.median(ratio), 3),
        "ratioToAudioP95": round(quantile(ratio, 0.95), 3),
    }

    refused = [r for r in correct if not r["ruleW"]]
    report["refusedCorrectByStage"] = dict(collections.Counter(r["stage"] for r in refused).most_common())
    counter = collections.Counter()
    examples = collections.defaultdict(list)
    for r in refused:
        for reason in set(refusal_reasons(r)):
            counter[reason] += 1
            if len(examples[reason]) < 2:
                examples[reason].append(r["heard"].strip())
    report["topRefusalReasons"] = [
        {"reason": k, "cases": n, "examples": examples[k]} for k, n in counter.most_common(20)
    ]
    json.dump(report, open(sys.argv[2], "w"), indent=2)
    w = report["rules"]["ruleW"]
    print(json.dumps({k: w[k] for k in ("correctAccepted", "correctPercent", "nearMissesAccepted", "pass")}))


def group_by(rows, key):
    out = collections.defaultdict(list)
    for r in rows:
        k = r[key] if key != "requestKind" else ("transfer" if r["requestId"].startswith("t") else "multisig")
        out[k].append(r)
    return out


if __name__ == "__main__":
    main()
