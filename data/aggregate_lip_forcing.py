#!/usr/bin/env python3
"""
Aggregate user study results for the LipForcing study.

Pulls every issue labeled `user-study-result` from the GitHub repo
(jinhyukj/LipForcing_user_study), extracts each participant's JSON
responses, and computes:
  - Per-participant per-model average scores (4 questions)
  - Cross-participant per-model average scores (mean of mean)

Usage:
    python aggregate_lip_forcing.py --token <github_pat>

Output:
    - prints a summary table to stdout
    - writes per-participant + aggregate JSON to ./aggregated_results.json
"""
import argparse
import json
import re
import statistics
import sys
from collections import defaultdict
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

REPO = "jinhyukj/LipForcing_user_study"
LABEL = "user-study-result"
QUESTIONS = ["sync", "quality", "id_pres", "natural"]


def gh_get(url, token):
    req = Request(url)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    with urlopen(req) as r:
        return json.loads(r.read().decode())


def fetch_issues(token):
    issues = []
    page = 1
    while True:
        url = f"https://api.github.com/repos/{REPO}/issues?labels={LABEL}&state=all&per_page=100&page={page}"
        try:
            batch = gh_get(url, token)
        except HTTPError as e:
            print(f"GitHub API error on page {page}: {e}", file=sys.stderr)
            break
        if not batch:
            break
        issues.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return issues


JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def extract_payload(issue):
    m = JSON_BLOCK_RE.search(issue.get("body") or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def per_participant_aggregates(payload):
    """{model: {qid: avg}} for one participant."""
    bucket = defaultdict(lambda: defaultdict(list))   # model -> qid -> [scores]
    for sec in payload.get("responses", []):
        for video in sec.get("videos", []):
            model = video["model"]
            for qid in QUESTIONS:
                v = video.get("scores", {}).get(qid)
                if v is not None:
                    bucket[model][qid].append(int(v))
    return {
        model: {qid: statistics.mean(vals) if vals else None for qid, vals in qs.items()}
        for model, qs in bucket.items()
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True, help="GitHub PAT with repo scope")
    ap.add_argument("--out", default="aggregated_results.json", help="Write the per-participant + global aggregates JSON here")
    args = ap.parse_args()

    print(f"Fetching issues from github.com/{REPO} with label '{LABEL}' ...", file=sys.stderr)
    issues = fetch_issues(args.token)
    print(f"  fetched {len(issues)} issues", file=sys.stderr)

    per_participant = {}    # participantId -> {model -> {qid -> avg}}
    skipped = []
    for issue in issues:
        payload = extract_payload(issue)
        if not payload:
            skipped.append(issue["number"])
            continue
        pid = payload.get("participantId") or f"issue_{issue['number']}"
        per_participant[pid] = per_participant_aggregates(payload)

    if skipped:
        print(f"  skipped {len(skipped)} issues missing JSON: {skipped[:5]}{'...' if len(skipped)>5 else ''}", file=sys.stderr)

    # Cross-participant aggregate: mean of each participant's per-model means
    global_agg = defaultdict(lambda: defaultdict(list))
    for pid, models in per_participant.items():
        for model, qs in models.items():
            for qid in QUESTIONS:
                v = qs.get(qid)
                if v is not None:
                    global_agg[model][qid].append(v)
    global_summary = {
        model: {qid: statistics.mean(vals) if vals else None for qid, vals in qs.items()}
        for model, qs in global_agg.items()
    }
    global_n = {model: len(qs.get("sync", [])) for model, qs in global_agg.items()}

    # ---- pretty print ----
    all_models = sorted(global_summary.keys())
    print()
    print(f"=== Cross-participant model averages (n={len(per_participant)} participants) ===")
    header = f"{'Model':<18s}" + "".join(f"{q:>15s}" for q in QUESTIONS) + f"{'n':>6s}"
    print(header)
    print("-" * len(header))
    for m in all_models:
        row = f"{m:<18s}"
        for q in QUESTIONS:
            v = global_summary[m].get(q)
            row += f"{v:>15.2f}" if v is not None else f"{'—':>15s}"
        row += f"{global_n.get(m, 0):>6d}"
        print(row)

    out = {
        "repo": REPO,
        "n_participants": len(per_participant),
        "per_participant": per_participant,
        "global_summary": global_summary,
        "global_n_per_model": global_n,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
