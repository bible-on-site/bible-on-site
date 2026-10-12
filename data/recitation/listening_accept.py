"""Import exact human-approved verse cuts alongside unchanged automatic evidence."""

import argparse
from collections import defaultdict
from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import shutil
import tempfile

from alignment import load_chapters, reconcile, validate_timings, words_for
from listening_review import (ReviewStore, digest_file, digest_json, load_queue,
                              read_json, validate_case, validate_decision)
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from recite import cached_transcript, duration, export_database, write_json
from trusted import POLICY_VERSION, SOFT_WARNING, TRUSTED_PIPELINE, valid_score, verify_source, verify_warnings

POLICY = "targeted-human-listening-v1"
RESOLVABLE = {"insufficient ASR agreement", "verse boundary words lack reliable ASR anchors", SOFT_WARNING}


def verify_review(case, decision, queue_hash):
    """A real latest answer approves only the exact candidate the human heard."""
    evidence = decision["listenEvidenceReportedByBrowser"]
    checked = validate_decision(case, {
        "candidateSha256": decision["candidateSha256"], "verdict": decision["verdict"],
        "verseHeard": evidence["verseHeard"], "heardSegments": evidence["heardSegments"],
        "note": decision["note"],
    })
    for key, value in checked.items():
        if key != "savedAt" and decision.get(key) != value:
            raise ValueError(f"Saved listening evidence differs from candidate: {key}")
    if decision.get("queueSha256") != queue_hash or not decision.get("savedAt"):
        raise ValueError("Listening answer is not bound to this queue")
    if decision["verdict"] != "good":
        raise ValueError(f"Human decision remains {decision['verdict']} for {case['id']}")


def verify_diagnostic(case):
    study = read_json(Path(case["diagnosticPath"]))
    if digest_file(Path(case["diagnosticPath"])) != case["diagnosticSha256"]:
        raise ValueError("Diagnostic changed after listening")
    if (study.get("revision") != ALIGN_REVISION or study.get("model") != ALIGN_MODEL
            or study.get("dtype") != "float32" or not study.get("diagnosticOnly")):
        raise ValueError("Candidate lacks pinned full-FP32 acoustic evidence")
    for diagnostic in study.get("cases", []):
        rows = [row for row in diagnostic.get("diagnosticCandidates", []) if row["pasuk"] == case["pasuk"]]
        if (diagnostic.get("perekId") == case["perekId"]
                and diagnostic.get("sourceAudioSha256") == case["audioSha256"]
                and round(diagnostic["contextStartSec"] * 1000) == case["clipStartMs"]
                and round(diagnostic["contextEndSec"] * 1000) == case["clipEndMs"]
                and rows == case["words"]):
            return
    raise ValueError("Listening candidate differs from actual acoustic result")


def approve_chapter(manifest, report, cached, words, recording, duration_ms, cases, decisions, queue_hash):
    """Human evidence resolves listed verses; all other verses keep original gates."""
    verify_source(manifest, words, recording, duration_ms)
    for key in ("perekId", "audioSha256", "textSha256", "pipeline", "words"):
        if report.get(key) != manifest.get(key):
            raise ValueError(f"Diagnostic report differs from alignment: {key}")
    if report.get("totalWords") != len(words) or not isinstance(report.get("review"), list):
        raise ValueError("Incomplete diagnostic report")
    if not cached_transcript(cached, manifest["audioSha256"], ASR_MODEL, ASR_REVISION):
        raise ValueError("ASR evidence has a different source or model snapshot")

    replacements, reviews = {}, []
    for case in cases:
        if case["perekId"] != manifest["perekId"] or case["pasuk"] in replacements:
            raise ValueError("Duplicate or wrong-chapter listening case")
        decision = decisions.get(case["id"])
        if decision is None:
            continue
        # A problem answer must never be ignored in favor of an earlier good answer.
        verify_review(case, decision, queue_hash)
        validate_case(case, words, manifest)
        verify_diagnostic(case)
        replacements[case["pasuk"]] = deepcopy(case["words"])
        reviews.append(deepcopy(decision))
    if not replacements:
        raise ValueError("No current human approval for this chapter")
    for warning in report["review"]:
        if warning["pasuk"] in replacements and warning["reason"] not in RESOLVABLE:
            raise ValueError(f"Unsupported failure still requires recovery: {warning['reason']}")
        if warning["reason"] != SOFT_WARNING and warning["pasuk"] not in replacements:
            raise ValueError(f"Unreviewed held pasuk {warning['pasuk']}: {warning['reason']}")

    original = {(row["pasuk"], row["segment"]): row for row in manifest["words"]}
    expected = {(word.pasuk, word.segment): word.text for word in words}
    if (len(original) != len(manifest["words"]) or set(original) != set(expected)
            or any(original[key]["text"] != value for key, value in expected.items())):
        raise ValueError("Duplicate, missing or stale original word evidence")
    matches = reconcile([word.speech for word in words], [row["text"] for row in cached["words"]])
    rows = []
    for index, word in enumerate(words):
        if word.pasuk in replacements:
            row = next(row for row in replacements[word.pasuk] if row["segment"] == word.segment)
            # Record the actual original ASR score, even when human evidence resolves its failure.
            row["textScore"] = round(matches[index][1], 4)
        else:
            row = deepcopy(original[(word.pasuk, word.segment)])
            if row.get("textScore") != round(matches[index][1], 4):
                raise ValueError("Automatic text evidence differs from original ASR")
        rows.append(row)
    validate_timings(words, rows, duration_ms, require_complete=True)
    for row in rows:
        if not 40 <= row["endMs"] - row["startMs"] <= 3000:
            raise ValueError("Word duration outside original quality limits")
        if not all(valid_score(row.get(key)) for key in ("acousticScore", "textScore")):
            raise ValueError("Missing or invalid acoustic/text evidence")
    for pasuk in sorted({word.pasuk for word in words} - replacements.keys()):
        indices = [i for i, word in enumerate(words) if word.pasuk == pasuk]
        anchors = [i for i in indices if matches[i][0] and matches[i][1] >= TRUSTED_PIPELINE["minTextScore"]]
        if (len(anchors) / len(indices) < TRUSTED_PIPELINE["minCoverage"]
                or indices[0] not in anchors or indices[-1] not in anchors):
            raise ValueError(f"Insufficient automatic ASR anchors in unreviewed pasuk {pasuk}")
    verify_warnings(rows, [warning for warning in report["review"] if warning["pasuk"] not in replacements])

    accepted = deepcopy(manifest)
    accepted.update(alignmentStatus="ready", words=rows, reviewMethod="trusted-process-with-human-verse-review",
                    acceptancePolicy={"name": POLICY, "version": 1,
                        "automaticPolicyVersion": POLICY_VERSION,
                        "automaticPesukim": sorted({word.pasuk for word in words} - replacements.keys()),
                        "humanReviewedPesukim": sorted(replacements), "humanReviews": reviews,
                        "diagnostics": deepcopy(report["review"]),
                        "sourceEvidence": {"manifestSha256": digest_json(manifest),
                            "reportSha256": digest_json(report), "asrSha256": digest_json(cached),
                            "queueSha256": queue_hash}})
    return accepted


def overlay_reviews(staged, database, withdrawn):
    """Withdraw only this policy's approvals, atomically with the validated overlay."""
    with tempfile.NamedTemporaryFile(dir=database.parent, suffix=".sqlite", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copy2(database, temporary)
        with closing(sqlite3.connect(temporary)) as db:
            for pid in withdrawn:
                metadata = json.loads(db.execute("SELECT provenance_json FROM recitation_track WHERE perek_id=?", (pid,)).fetchone()[0])
                if metadata.get("reviewMethod") != "trusted-process-with-human-verse-review":
                    raise ValueError("Cannot withdraw an independent prior approval")
                db.execute("UPDATE recitation_track SET alignment_status='needs_review' WHERE perek_id=?", (pid,))
            db.commit()
        export_database(staged, temporary)
        temporary.replace(database)
    finally:
        temporary.unlink(missing_ok=True)

def stage_reviews(queue_path, reviews_path, text, output, database):
    """Overlay complete recoveries only, preserving already accepted tracks."""
    queue = load_queue(queue_path)
    decisions = ReviewStore(reviews_path, queue).snapshot()
    chapters = load_chapters(text)
    cases_by_chapter = defaultdict(list)
    for case in queue["cases"]:
        cases_by_chapter[case["perekId"]].append(case)
    with closing(sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)) as db:
        existing = {pid: (status, audio, canonical, json.loads(metadata)) for pid, status, audio, canonical, metadata in db.execute(
            "SELECT perek_id,alignment_status,audio_sha256,text_sha256,provenance_json FROM recitation_track")}
    summary = {"policy": POLICY, "accepted": [], "held": [], "alreadyAccepted": [], "updatedReviews": [], "withdrawn": [], "words": 0}
    with tempfile.TemporaryDirectory() as folder:
        staged = Path(folder)
        for pid, cases in sorted(cases_by_chapter.items()):
            prior = existing.get(pid)
            was_recovered = bool(prior and prior[0] == "ready"
                and prior[3].get("reviewMethod") == "trusted-process-with-human-verse-review")
            manifest = None
            try:
                paths = {case["manifestPath"] for case in cases}
                if len(paths) != 1:
                    raise ValueError("Cases refer to different alignment snapshots")
                path = Path(cases[0]["manifestPath"])
                manifest = read_json(path)
                if prior and prior[:3] == ("ready", manifest["audioSha256"], manifest["textSha256"]) and not was_recovered:
                    summary["alreadyAccepted"].append(pid)
                    continue
                reports = path.parent.parent
                recording = Path(cases[0]["audioPath"])
                accepted = approve_chapter(manifest, read_json(reports / f"{pid}.review.json"),
                    read_json(reports / f"{pid}.asr.json"), words_for(chapters[pid]), recording,
                    duration(recording), cases, decisions, queue["queueSha256"])
                if was_recovered and accepted["acceptancePolicy"] == prior[3].get("acceptancePolicy"):
                    summary["alreadyAccepted"].append(pid)
                    continue
                write_json(staged / f"{pid}.json", accepted)
                write_json(output / f"{pid}.json", accepted)
                if was_recovered:
                    summary["updatedReviews"].append(pid)
                else:
                    summary["accepted"].append(pid)
                    summary["words"] += len(accepted["words"])
            except (ValueError, KeyError, TypeError, OSError, StopIteration) as error:
                summary["held"].append({"perekId": pid, "reason": str(error)})
                if was_recovered and manifest is not None:
                    withdrawn = deepcopy(manifest)
                    withdrawn.update(alignmentStatus="needs_review", reviewMethod="human-verse-review-withdrawn",
                        acceptancePolicy={"name": POLICY, "version": 1, "withdrawalReason": str(error),
                            "previousAcceptancePolicy": prior[3]["acceptancePolicy"],
                            "latestHumanReviews": [deepcopy(decisions[c["id"]]) for c in cases if c["id"] in decisions]})
                    write_json(staged / f"{pid}.json", withdrawn)
                    write_json(output / f"{pid}.json", withdrawn)
                    summary["withdrawn"].append(pid)
        # Ignore stale files in the output directory: export only this validated pass.
        if summary["accepted"] or summary["updatedReviews"] or summary["withdrawn"]:
            overlay_reviews(staged, database, summary["withdrawn"])
    write_json(output / "summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("queue", "reviews", "text", "output", "database"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(stage_reviews(args.queue, args.reviews, args.text, args.output, args.database), indent=2))


if __name__ == "__main__":
    main()
