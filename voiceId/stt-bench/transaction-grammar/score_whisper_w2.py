"""Refactor 210 Gate STT-1: score Rule W2 (with Rule W and Rule A for
comparison) on the Whisper large-v3 transcripts.

Usage, from voiceId/stt-bench:
  python3 transaction-grammar/score_whisper_w2.py <decisions.jsonl> <meta.json> <report.json>

<decisions.jsonl> and <meta.json> come from `txg-text rulew2`. The script
makes no network calls.

A near miss that a rule accepts is a false accept, except one case: the
audio names a different contact that is confusable with the true receiver,
and the decision pays the true receiver with the exact amount. That case is
counted in the row "homophone of the true receiver".
"""
import collections
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_whisper import group_by, pct, quantile, refusal_reasons  # noqa: E402

RULES = ("ruleW2", "ruleW", "ruleA")


def pays_request_exactly(row, rule):
    """True if the accepted decision pays the request's receiver its amount."""
    if rule != "ruleW2":
        # Rule W and Rule A accept only text equal to the expected text.
        return True
    d = row.get("detail", {})
    return d.get("parsedReceiver") == row.get("receiver") and d.get("parsedHundredths") == row.get("expectedHundredths")


def main():
    rows = [json.loads(l) for l in open(sys.argv[1])]
    meta = json.load(open(sys.argv[2]))
    ok = [r for r in rows if "error" not in r]
    correct = [r for r in ok if r["role"] == "correct"]
    misses = [r for r in ok if r["role"] == "near_miss"]
    n_correct = sum(r["role"] == "correct" for r in rows)
    n_miss = sum(r["role"] == "near_miss" for r in rows)

    vaults = meta["vaults"]
    removed_counts = [len(v["removed"]) for v in vaults]
    removed_union = sorted({a for v in vaults for a in v["removed"]})
    meta_summary = {
        "aliases": meta["aliases"],
        "grammarWordCount": meta["grammarWordCount"],
        "contacts": meta["contacts"],
        "confusablePairs": meta["confusablePairs"],
        "transferRequests": len(vaults),
        "removedPerRequest": {
            "min": min(removed_counts),
            "median": statistics.median(removed_counts),
            "max": max(removed_counts),
            "distribution": dict(sorted(collections.Counter(removed_counts).items())),
        },
        "removedConfusableWithReceiverPerRequest": dict(
            sorted(collections.Counter(len(v["removedConfusableWithReceiver"]) for v in vaults).items())
        ),
        "contactsRemovedInAnyVault": removed_union,
    }

    report = {
        "gate": "STT-1",
        "model": "whisper-large-v3 (NEAR AI Cloud)",
        "date": "2026-11-07",
        "decisions": "txg-text rulew2 (transaction-grammar/grammar/src/rulew.rs)",
        "ruleDefinitions": {
            "ruleW2": "ruleW, plus: whole-word aliases; account tokens (letters with - _ ., or letters with "
            "digits) spell each digit as a word; transfers match and parse against a valid vault (corpus "
            "contacts minus contacts confusable with the receiver, minus the later contact of any other "
            "confusable pair)",
            "ruleW": "as in stt1-transaction-grammar-whisper-nearai-2026-11-07 (all 60 contacts)",
            "ruleA": "normalize(transcript) equals the expected spoken text, word for word",
            "homophoneOfTrueReceiver": "near miss whose audio names a contact confusable with the true "
            "receiver, accepted, and the parsed recipient and amount equal the request exactly",
        },
        "cases": len(rows),
        "errors": len(rows) - len(ok),
        "vault": meta_summary,
        "rules": {},
    }
    for rule in RULES:
        a = sum(r[rule] for r in correct)
        accepted_misses = [r for r in misses if r[rule]]
        homophone = [r for r in accepted_misses if r.get("audioNamesConfusableOfReceiver") and pays_request_exactly(r, rule)]
        hset = {r["caseId"] for r in homophone}
        false_accepts = [r for r in accepted_misses if r["caseId"] not in hset]

        def by(key):
            return {
                str(k): {"accepted": sum(r[rule] for r in g), "cases": len(g), "percent": pct(sum(r[rule] for r in g), len(g))}
                for k, g in sorted(group_by(correct, key).items())
            }

        def case_list(group):
            return [
                {
                    "caseId": r["caseId"],
                    "missKind": r["missKind"],
                    "audioText": r["audioText"],
                    "expected": r["expected"],
                    "heard": r["heard"].strip(),
                    "audioRecipient": r.get("audioRecipient"),
                    "paid": (r.get("detail", {}).get("parsedReceiver") if rule == "ruleW2" else r.get("receiver")),
                }
                for r in group
            ]

        report["rules"][rule] = {
            "correctAccepted": a,
            "correctCases": n_correct,
            "correctPercent": pct(a, n_correct),
            "correctByRequestKind": by("requestKind"),
            "correctByVoice": by("voice"),
            "correctByRate": by("rate"),
            "nearMissCases": n_miss,
            "nearMissesAccepted": len(accepted_misses),
            "homophoneOfTrueReceiver": len(homophone),
            "falseAccepts": len(false_accepts),
            "falseAcceptsByKind": {
                k: {"falseAccepts": sum(r["caseId"] not in hset and r[rule] for r in g), "cases": len(g)}
                for k, g in sorted(group_by(misses, "missKind").items())
            },
            "falseAcceptCases": case_list(false_accepts),
            "homophoneCases": case_list(homophone),
            "pass": n_correct > 0 and a >= 0.95 * n_correct and not false_accepts,
        }

    refused = [r for r in correct if not r["ruleW2"]]
    report["ruleW2RefusedCorrectByStage"] = dict(collections.Counter(r["stage"] for r in refused).most_common())
    counter = collections.Counter()
    examples = collections.defaultdict(list)
    for r in refused:
        for reason in set(refusal_reasons(r)):
            counter[reason] += 1
            if len(examples[reason]) < 2:
                examples[reason].append(r["heard"].strip())
    report["ruleW2TopRefusalReasons"] = [
        {"reason": k, "cases": n, "examples": examples[k]} for k, n in counter.most_common(20)
    ]
    report["ruleW2AliasHits"] = dict(
        collections.Counter(a for r in ok for a in r.get("detail", {}).get("aliases", [])).most_common()
    )
    json.dump(report, open(sys.argv[3], "w"), indent=2)
    for rule in RULES:
        w = report["rules"][rule]
        print(rule, json.dumps({k: w[k] for k in ("correctAccepted", "correctPercent", "nearMissesAccepted",
                                                   "homophoneOfTrueReceiver", "falseAccepts", "pass")}))


if __name__ == "__main__":
    main()
