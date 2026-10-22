"""Import exact human-approved verse cuts alongside unchanged automatic evidence."""

import argparse
from collections import defaultdict
from contextlib import closing
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import shutil
import tempfile

from alignment import load_chapters, reconcile, validate_timings, words_for
from listening_audio import duration
from listening_edits import verify_word_review
from listening_review import (ReviewStore, digest_file, digest_json,
                              read_json, validate_case, validate_decision)
from listening_round import load_review_evidence
from listening_tail import INITIAL_SOURCE_METHOD, MACHINE_METHOD, verify_corrections
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from recite import cached_transcript, export_database, write_json
from trusted import POLICY_VERSION, SOFT_WARNING, TRUSTED_PIPELINE, valid_score, verify_source, verify_warnings

POLICY = "targeted-human-listening-v1"
RESOLVABLE = {"insufficient ASR agreement", "verse boundary words lack reliable ASR anchors", SOFT_WARNING}


def review_instant(row):
    """Compare separately stored actual answers without rewriting either history."""
    try:
        stamp = datetime.fromisoformat(row["savedAt"].replace("Z", "+00:00"))
        if stamp.utcoffset() is None:
            raise ValueError("Listening answer timestamp requires a timezone")
        return stamp
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise ValueError("Listening answer has an invalid saved timestamp") from error


def current_review_decisions(queue, reviews_path):
    """Keep typed manual coordinates separate, choosing the latest genuine answer."""
    decisions = ReviewStore(reviews_path, queue).snapshot()
    saved = read_json(reviews_path) if reviews_path.exists() else {}
    typed = saved.get("wordReviews", [])
    if not isinstance(typed, list) or any(not isinstance(row, dict) for row in typed):
        raise ValueError("Manual word review history must contain saved review objects")
    cases = {case["id"]: case for case in queue["cases"]}
    latest = {}
    for row in typed:
        case = cases.get(row.get("caseId"))
        # Historical manual coordinates belong only to their immutable parent.
        if (case and row.get("candidateSha256") == case["candidateSha256"]
                and row.get("clipSha256") == case["clipSha256"]):
            latest[case["id"]] = row
    for case_id, row in latest.items():
        legacy = decisions.get(case_id)
        # A legacy tab still plays the original proposal. Its later answer does
        # not concern a separately edited coordinate version of those words.
        # Compare ordering across stores only for byte-identical word rows.
        same_coordinates = (legacy is not None
            and legacy.get("candidateWords") == row.get("candidateWords")
            and all(legacy.get(key) == row.get(key) for key in
                    ("caseId", "perekId", "pasuk", "audioSha256", "textSha256",
                     "candidateSha256", "clipSha256", "diagnosticSha256")))
        if not same_coordinates or review_instant(row) >= review_instant(legacy):
            decisions[case_id] = deepcopy(row)
    return decisions


def verify_manual_review(case, decision, queue_hash):
    """A typed GOOD approves explicit human timings, never modified model evidence."""
    allowed = queue_hash.get(case["id"], []) if isinstance(queue_hash, dict) else [queue_hash]
    if decision.get("queueSha256") not in allowed:
        raise ValueError("Manual word review is not bound to this queue")
    verify_word_review(case, decision, decision["queueSha256"])
    review_instant(decision)
    if decision["verdict"] != "good":
        raise ValueError(f"Human decision remains {decision['verdict']} for {case['id']}")


def verify_review(case, decision, queue_hash):
    """A real latest answer approves only the exact candidate the human heard."""
    evidence = decision["listenEvidenceReportedByBrowser"]
    checked = validate_decision(case, {
        "candidateSha256": decision["candidateSha256"], "verdict": decision["verdict"],
        "verseHeard": evidence["verseHeard"], "heardSegments": evidence["heardSegments"],
        **({"freshHeardSegments": evidence["freshHeardSegments"]} if "freshHeardSegments" in evidence else {}),
        "note": decision["note"],
    })
    for key, value in checked.items():
        if key != "savedAt" and decision.get(key) != value:
            raise ValueError(f"Saved listening evidence differs from candidate: {key}")
    allowed = queue_hash.get(case["id"], []) if isinstance(queue_hash, dict) else [queue_hash]
    if decision.get("queueSha256") not in allowed or not decision.get("savedAt"):
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
            if (diagnostic.get("boundaryMethod") == MACHINE_METHOD
                    and (study.get("device") != "cuda" or study.get("threads") != 2)):
                raise ValueError("Machine proposal cannot relabel actual CUDA inference")
            if diagnostic.get("boundaryMethod") in (INITIAL_SOURCE_METHOD, MACHINE_METHOD):
                if (case.get("reviewKind") != "missing" or case.get("listeningReusePath")
                        or case.get("reusableHeardSegments") or case.get("listeningReuseSha256")
                        or diagnostic.get("canonicalTextSha256") != case["textSha256"]):
                    raise ValueError("Initial source candidate requires fresh full-verse cut hearing")
            if diagnostic.get("boundaryMethod"):
                verify_corrections(diagnostic)
            return
    raise ValueError("Listening candidate differs from actual acoustic result")


def verify_original_evidence(manifest, report, cached, words, recording, duration_ms):
    """Require the original full-quality source, diagnostic and ASR snapshots."""
    verify_source(manifest, words, recording, duration_ms)
    for key in ("perekId", "audioSha256", "textSha256", "pipeline", "words"):
        if report.get(key) != manifest.get(key):
            raise ValueError(f"Diagnostic report differs from alignment: {key}")
    if report.get("totalWords") != len(words) or not isinstance(report.get("review"), list):
        raise ValueError("Incomplete diagnostic report")
    if not cached_transcript(cached, manifest["audioSha256"], ASR_MODEL, ASR_REVISION):
        raise ValueError("ASR evidence has a different source or model snapshot")



def reviewed_replacements(manifest, report, words, cases, decisions, queue_hash):
    """Every replaced verse needs its own current, source-bound good answer."""
    replacements, reviews = {}, []
    for case in cases:
        if case["perekId"] != manifest["perekId"] or case["pasuk"] in replacements:
            raise ValueError("Duplicate or wrong-chapter listening case")
        decision = decisions.get(case["id"])
        if decision is None:
            continue
        # A problem answer must never be ignored in favor of an earlier good answer.
        validate_case(case, words, manifest)
        # Acoustic evidence always validates the immutable original proposal.
        # Human coordinates are separately typed evidence, not rewritten model rows.
        verify_diagnostic(case)
        if decision.get("kind") == "manual-word-review":
            verify_manual_review(case, decision, queue_hash)
            reviewed = {**case, "words": deepcopy(decision["candidateWords"])}
            validate_case(reviewed, words, manifest)
            replacements[case["pasuk"]] = reviewed["words"]
        else:
            verify_review(case, decision, queue_hash)
            replacements[case["pasuk"]] = deepcopy(case["words"])
        reviews.append(deepcopy(decision))
    if not replacements:
        raise ValueError("No current human approval for this chapter")
    for warning in report["review"]:
        if warning["pasuk"] in replacements and warning["reason"] not in RESOLVABLE:
            raise ValueError(f"Unsupported failure still requires recovery: {warning['reason']}")
        if warning["reason"] != SOFT_WARNING and warning["pasuk"] not in replacements:
            raise ValueError(f"Unreviewed held pasuk {warning['pasuk']}: {warning['reason']}")

    return replacements, reviews


def merged_words(manifest, report, cached, words, replacements, duration_ms):
    """Preserve the automatic remainder and validate full-chapter timing geometry."""
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

    return rows


def approve_chapter(manifest, report, cached, words, recording, duration_ms, cases, decisions, queue_hash):
    """Human evidence resolves listed verses; all other verses keep original gates."""
    verify_original_evidence(manifest, report, cached, words, recording, duration_ms)
    replacements, reviews = reviewed_replacements(manifest, report, words, cases, decisions, queue_hash)
    rows = merged_words(manifest, report, cached, words, replacements, duration_ms)
    accepted = deepcopy(manifest)
    accepted.update(alignmentStatus="ready", words=rows, reviewMethod="trusted-process-with-human-verse-review",
                    acceptancePolicy={"name": POLICY, "version": 1,
                        "automaticPolicyVersion": POLICY_VERSION,
                        "automaticPesukim": sorted({word.pasuk for word in words} - replacements.keys()),
                        "humanReviewedPesukim": sorted(replacements), "humanReviews": reviews,
                        "diagnostics": deepcopy(report["review"]),
                        "sourceEvidence": {"manifestSha256": digest_json(manifest),
                            "reportSha256": digest_json(report), "asrSha256": digest_json(cached),
                            "queueSha256": reviews[0]["queueSha256"] if len({r["queueSha256"] for r in reviews}) == 1
                            else sorted({r["queueSha256"] for r in reviews})}})
    return accepted


def overlay_reviews(staged, database, withdrawn):
    """Withdraw only this policy's approvals, atomically with the validated overlay."""
    with tempfile.TemporaryDirectory(dir=database.parent) as folder:
        temporary = Path(folder) / "recitation.sqlite"
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


def stage_reviews(queue_path, reviews_path, text, output, database):
    """Overlay complete recoveries only, preserving already accepted tracks."""
    queue, bindings = load_review_evidence(queue_path)
    decisions = current_review_decisions(queue, reviews_path)
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
                    duration(recording), cases, decisions, bindings)
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
