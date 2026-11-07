"""Gate STT-1 metrics from `txg-text decide` output.

Rule A: the `ruleA` field (greedy decode, normalize, exact token match).
Rule B: accept if llExpected - llBestMiss >= margin and the normalized word
count is within one word of the expected count. The margin is the smallest
value that accepts no near miss of the calibration requests (even request
index); results are reported on the test requests (odd index) and on all.

Usage: python3 score.py <out.json> corpus=<corpus.json> <model>=<decisions.jsonl> [...]
Standard library only.
"""

import json
import math
import sys
from collections import Counter, defaultdict

GATE_ACCEPT = 0.95


def upper95(k, n):
    """One-sided 95% Clopper-Pearson upper bound for k of n."""
    if n == 0:
        return 1.0
    if k == 0:
        return 1 - 0.05 ** (1 / n)
    lo, hi = k / n, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        # P(X <= k) for Binomial(n, mid)
        cdf = sum(math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1)
                           + i * math.log(mid) + (n - i) * math.log1p(-mid)) for i in range(k + 1))
        lo, hi = (mid, hi) if cdf > 0.05 else (lo, mid)
    return hi


def request_index(row):
    return int(row["requestId"][1:]) + (0 if row["requestId"][0] == "t" else 1000)


def b_score(row):
    e, m = row["llExpected"], row["llBestMiss"]
    e = -math.inf if e is None else e
    m = -math.inf if m is None else m
    if e == -math.inf:
        return -math.inf
    return e - m


def rule_b(row, margin):
    return b_score(row) >= margin and abs(row["words"] - row["expectedWords"]) <= 1


def rate(rows, accept):
    n = len(rows)
    k = sum(1 for r in rows if accept(r))
    return {"accepted": k, "n": n, "rate": k / n if n else None}


def group(rows, key):
    out = defaultdict(list)
    for r in rows:
        out[key(r)].append(r)
    return dict(sorted(out.items()))


def misses(rows, accept):
    k = sum(1 for r in rows if accept(r))
    return {"accepted": k, "n": len(rows), "upper95": upper95(k, len(rows)),
            "examples": [{"text": r["text"], "expected": r["expected"], "transcript": r["transcript"]}
                         for r in rows if accept(r)][:10]}


def amount_words_heard(row):
    """Diagnostic: the expected amount words appear, in order and contiguous,
    in the normalized transcript of a transfer."""
    words = row["expected"].split()
    amount = " ".join(words[1:words.index("near")])
    return f" {amount} " in f" {row['normalized'] or ''} "


def word_recall(rows, word):
    have = [r for r in rows if word in r["expected"].split()]
    return rate(have, lambda r: word in (r["normalized"] or "").split())


def evaluate(rows, kinds):
    correct = [r for r in rows if r["role"] == "correct"]
    transfers = [r for r in correct if r["requestId"].startswith("t")]
    near = [r for r in rows if r["role"] == "near_miss"]
    calibration = lambda r: request_index(r) % 2 == 0
    cal_near = [r for r in near if calibration(r)]
    passing = [b_score(r) for r in cal_near if abs(r["words"] - r["expectedWords"]) <= 1]
    finite = [s for s in passing if s != -math.inf]
    margin = max([0.0] + [s + 1e-6 for s in finite])
    test_correct = [r for r in correct if not calibration(r)]
    test_near = [r for r in near if not calibration(r)]
    a = lambda r: r["ruleA"]
    b = lambda r: rule_b(r, margin)
    field = lambda r: kinds[r["requestId"]]
    out = {
        "ruleA": {
            "correct": rate(correct, a),
            "correctByVoice": {k: rate(v, a) for k, v in group(correct, lambda r: r["voice"]).items()},
            "correctByRate": {str(k): rate(v, a) for k, v in group(correct, lambda r: r["rate"]).items()},
            "correctByField": {k: rate(v, a) for k, v in group(correct, field).items()},
            "nearMiss": misses(near, a),
            "nearMissByKind": {k: misses(v, a)["accepted"] for k, v in group(near, lambda r: r["missKind"]).items()},
            "transferRefusals": dict(Counter(
                (r["parse"] if isinstance(r.get("parse"), str) else "OtherValidTransfer")
                for r in correct if r["requestId"].startswith("t") and not r["ruleA"])),
            "failureExamples": [{"expected": r["expected"], "transcript": r["transcript"], "voice": r["voice"]}
                                for r in correct if not r["ruleA"]][:25],
        },
        "ruleB": {
            "margin": margin,
            "calibrationNearMisses": len(cal_near),
            "testCorrect": rate(test_correct, b),
            "testNearMiss": misses(test_near, b),
            "allCorrect": rate(correct, b),
            "allNearMiss": misses(near, b),
            "allNearMissByKind": {k: misses(v, b)["accepted"] for k, v in group(near, lambda r: r["missKind"]).items()},
            "correctByField": {k: rate(v, b) for k, v in group(correct, field).items()},
            "atMarginZero": {"correct": rate(correct, lambda r: rule_b(r, 0.0)),
                             "nearMiss": misses(near, lambda r: rule_b(r, 0.0))},
        },
        "diagnostics": {
            "transferAmountWordsHeard": rate(transfers, amount_words_heard),
            "transferAmountWordsHeardByCategory": {
                k: rate(v, amount_words_heard) for k, v in group(transfers, lambda r: kinds[r["requestId"]].split("/")[1]).items()},
            "wordRecall": {w: word_recall(correct, w) for w in
                           ("send", "near", "to", "dot", "testnet", "point", "approve", "proposal")},
            "withinOneWord": rate(correct, lambda r: abs(r["words"] - r["expectedWords"]) <= 1),
        },
        "meanInferMs": sum(r["inferMs"] for r in rows) / len(rows),
        "meanSeconds": sum(r["samples"] for r in rows) / len(rows) / 16000,
    }
    ra, rb = out["ruleA"], out["ruleB"]
    out["stt1"] = {
        "ruleA": ra["correct"]["rate"] >= GATE_ACCEPT and ra["nearMiss"]["accepted"] == 0,
        "ruleB": (rb["testCorrect"]["rate"] or 0) >= GATE_ACCEPT and rb["testNearMiss"]["accepted"] == 0
                 and rb["allNearMiss"]["accepted"] == 0,
    }
    return out


def main():
    out_path = sys.argv[1]
    corpus = None
    result = {"gate": "STT-1", "acceptGate": GATE_ACCEPT, "models": {}}
    for spec in sys.argv[2:]:
        if spec.startswith("corpus="):
            corpus = json.load(open(spec.split("=", 1)[1]))
            continue
        model, path = spec.split("=", 1)
        rows = [json.loads(line) for line in open(path)]
        kinds = {}
        for req in corpus["requests"]:
            if req["kind"] == "transfer":
                kinds[req["id"]] = f"transfer/{req['amountCategory']}/{req['accountCategory']}"
            else:
                kinds[req["id"]] = req["kind"]
        result["models"][model] = evaluate(rows, kinds)
        m = result["models"][model]
        print(f"{model}: A {m['ruleA']['correct']} near {m['ruleA']['nearMiss']['accepted']}/{m['ruleA']['nearMiss']['n']}"
              f" | B margin {m['ruleB']['margin']:.2f} test {m['ruleB']['testCorrect']} near {m['ruleB']['allNearMiss']['accepted']}"
              f" | STT-1 {m['stt1']}")
    json.dump(result, open(out_path, "w"), indent=1)


if __name__ == "__main__":
    main()
