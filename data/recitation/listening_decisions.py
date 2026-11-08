"""Pure selection of genuine reviews without mixing original and edited coordinates."""
from copy import deepcopy
from datetime import datetime


def review_instant(row):
    """Read a timezone-aware real save timestamp without rewriting the saved row."""
    try:
        value = datetime.fromisoformat(row["savedAt"].replace("Z", "+00:00"))
        if value.utcoffset() is None:
            raise ValueError("Listening answer timestamp requires a timezone")
        return value
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise ValueError("Listening answer has an invalid saved timestamp") from error


def merge_typed_reviews(cases, legacy, typed):
    """A legacy original-cut answer cannot overrule a separately edited typed review."""
    if not isinstance(typed, list) or any(not isinstance(row, dict) for row in typed):
        raise ValueError("Manual word review history must contain saved review objects")
    decisions = deepcopy(legacy)
    by_id = {case["id"]: case for case in cases}
    latest = {}
    for row in typed:
        case = by_id.get(row.get("caseId"))
        if (case and row.get("candidateSha256") == case["candidateSha256"]
                and row.get("clipSha256") == case["clipSha256"]):
            latest[case["id"]] = row
    for case_id, row in latest.items():
        original = decisions.get(case_id)
        same = (original is not None and original.get("candidateWords") == row.get("candidateWords")
                and all(original.get(key) == row.get(key) for key in
                        ("caseId", "perekId", "pasuk", "audioSha256", "textSha256",
                         "candidateSha256", "clipSha256", "diagnosticSha256")))
        if not same or review_instant(row) >= review_instant(original):
            decisions[case_id] = deepcopy(row)
    return decisions


def current_bound_reviews(cases, entries, typed):
    """Select only exact current candidate/clip bindings before applying shared semantics."""
    by_id = {case["id"]: case for case in cases}
    legacy = {}
    for row in entries:
        case = by_id.get(row.get("caseId"))
        if (case and row.get("candidateSha256") == case["candidateSha256"]
                and row.get("clipSha256") == case["clipSha256"]):
            legacy[case["id"]] = row
    return merge_typed_reviews(cases, legacy, typed)
