"""Refactor 210 Gate STT-1: score the crate text step
(`spoken_intent::normalize_punctuated`) on the Whisper large-v3 transcripts,
with the in-tool Rule W2 and Rule A for comparison.

Usage, from voiceId/stt-bench:
  python3 transaction-grammar/score_whisper_crate.py <decisions.jsonl> <report.json>

<decisions.jsonl> comes from `txg-text rulecrate`. The script makes no
network calls. The homophone rule is the one of score_whisper_w2.py.
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_whisper import group_by, pct, refusal_reasons  # noqa: E402

RULES = ("ruleCrate", "ruleW2", "ruleA")
DETAIL = {"ruleCrate": "detail", "ruleW2": "ruleW2Detail"}


def pays_request_exactly(row, rule):
    """True if the accepted decision pays the request's receiver its amount."""
    if rule not in DETAIL:
        return True
    d = row.get(DETAIL[rule], {})
    return d.get("parsedReceiver") == row.get("receiver") and d.get("parsedHundredths") == row.get("expectedHundredths")


def main():
    rows = [json.loads(l) for l in open(sys.argv[1])]
    ok = [r for r in rows if "error" not in r]
    correct = [r for r in ok if r["role"] == "correct"]
    misses = [r for r in ok if r["role"] == "near_miss"]
    n_correct = sum(r["role"] == "correct" for r in rows)
    n_miss = sum(r["role"] == "near_miss" for r in rows)
    report = {
        "gate": "STT-1",
        "model": "whisper-large-v3 (NEAR AI Cloud)",
        "date": "2026-11-07",
        "decisions": "txg-text rulecrate (transaction-grammar/grammar/src/rulew.rs)",
        "ruleDefinitions": {
            "ruleCrate": "spoken_intent::normalize_punctuated with the valid vault (transfers) or no contacts "
            "(multisig approvals), then parse_transfer and render, or word equality",
            "ruleW2": "as in stt1-transaction-grammar-whisper-nearai-w2-2026-11-07",
            "ruleA": "normalize(transcript) equals the expected spoken text, word for word",
        },
        "expectedText": "the corpus spoken text; set verifier version cases speak five check digits",
        "cases": len(rows),
        "errors": len(rows) - len(ok),
        "decisionsDifferFromRuleW2": sum(r["ruleCrate"] != r["ruleW2"] for r in ok),
        "rules": {},
    }
    for rule in RULES:
        a = sum(r[rule] for r in correct)
        accepted_misses = [r for r in misses if r[rule]]
        homophone = {r["caseId"] for r in accepted_misses if r.get("audioNamesConfusableOfReceiver") and pays_request_exactly(r, rule)}
        false_accepts = [r for r in accepted_misses if r["caseId"] not in homophone]

        def by(key):
            return {
                str(k): {"accepted": sum(r[rule] for r in g), "cases": len(g), "percent": pct(sum(r[rule] for r in g), len(g))}
                for k, g in sorted(group_by(correct, key).items())
            }

        report["rules"][rule] = {
            "correctAccepted": a,
            "correctCases": n_correct,
            "correctPercent": pct(a, n_correct),
            "correctByRequestKind": by("requestKind"),
            "correctByKind": by("requestKindDetail"),
            "correctByVoice": by("voice"),
            "correctByRate": by("rate"),
            "nearMissCases": n_miss,
            "nearMissesAccepted": len(accepted_misses),
            "homophoneOfTrueReceiver": len(homophone),
            "falseAccepts": len(false_accepts),
            "falseAcceptsByKind": {
                k: {"falseAccepts": sum(r["caseId"] not in homophone and r[rule] for r in g), "cases": len(g)}
                for k, g in sorted(group_by(misses, "missKind").items())
            },
            "falseAcceptCases": [{"caseId": r["caseId"], "audioText": r["audioText"], "heard": r["heard"].strip()} for r in false_accepts],
            "pass": n_correct > 0 and a >= 0.95 * n_correct and not false_accepts,
        }

    refused = [r for r in correct if not r["ruleCrate"]]
    report["ruleCrateRefusedCorrectByStage"] = dict(collections.Counter(r["stage"] for r in refused).most_common())
    counter = collections.Counter()
    examples = collections.defaultdict(list)
    for r in refused:
        for reason in set(refusal_reasons(r)):
            counter[reason] += 1
            if len(examples[reason]) < 2:
                examples[reason].append(r["heard"].strip())
    report["ruleCrateTopRefusalReasons"] = [{"reason": k, "cases": n, "examples": examples[k]} for k, n in counter.most_common(20)]
    json.dump(report, open(sys.argv[2], "w"), indent=2)
    for rule in RULES:
        w = report["rules"][rule]
        print(rule, json.dumps({k: w[k] for k in ("correctAccepted", "correctPercent", "nearMissesAccepted",
                                                   "homophoneOfTrueReceiver", "falseAccepts", "pass")}))
    print("byKind", json.dumps({k: v["accepted"] for k, v in report["rules"]["ruleCrate"]["correctByKind"].items()}))
    print("byGroup", json.dumps(report["rules"]["ruleCrate"]["correctByRequestKind"]))
    print("stages", json.dumps(report["ruleCrateRefusedCorrectByStage"]))


if __name__ == "__main__":
    main()
