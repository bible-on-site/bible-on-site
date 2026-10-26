"""Give every pending chapter concern a durable, source-bound human action."""

from collections import defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import struct
import subprocess  # nosec B404: fixed resolved PCM conversion argv, never a shell.
import wave

from alignment import text_hash
from listening_accept import verify_original_evidence
from listening_audio import duration, hidden_audio_options, original_audio_errors
from listening_files import read_state_json, write_state_json
from listening_machine import build_machine_study, canonical_words, decode_source
from listening_review import (candidate_digest, chapter_labels, digest_file, digest_json,
                              hebrew_number, load_queue, read_json, validate_case, write_json)
from recite import executable
from trusted import SOFT_WARNING

POLICY = "source-bound-human-action-v1"
PRIMARY_OLD_TARGETS = {28: 9, 116: 45, 217: 17, 231: 40}


def _checked(path, expected):
    path = Path(path)
    if digest_file(path) != expected:
        raise ValueError("An immutable concern input changed")
    return read_json(path)


def _source_paths(config, pid):
    source = Path(config["jobRoot"]) / "source"
    if not (source / "alignments" / f"{pid}.json").is_file():
        if pid not in PRIMARY_OLD_TARGETS:
            raise ValueError(f"Pending chapter {pid} has no completed immutable source")
        source = Path(config["sourceFallback"])
    return {"manifest": source / "alignments" / f"{pid}.json",
            "report": source / f"{pid}.review.json", "asr": source / f"{pid}.asr.json"}


def _source(config, pid, canonical_sha):
    paths = _source_paths(config, pid)
    evidence, data = {}, {}
    for name, path in paths.items():
        raw = path.read_bytes()
        evidence[name + "Path"] = str(path.resolve())
        evidence[name + "Sha256"] = hashlib.sha256(raw).hexdigest()
        data[name] = json.loads(raw)
    summary = paths["report"].with_name(f"{pid}-diagnostic-summary.json")
    if summary.is_file():
        hashes = read_json(summary)["sourceEvidenceHashes"]
        expected = {f"alignments/{pid}.json": evidence["manifestSha256"],
                    f"{pid}.review.json": evidence["reportSha256"], f"{pid}.asr.json": evidence["asrSha256"]}
        if hashes != expected:
            raise ValueError("Completed concern source differs from its diagnostic summary")
    canonical = Path(config["canonicalPath"]).resolve()
    words = canonical_words(canonical, canonical_sha, pid)
    audio = Path(config["recordings"]).resolve() / f"{pid}_record.mp3"
    verify_original_evidence(data["manifest"], data["report"], data["asr"], words, audio, duration(audio))
    evidence.update(canonicalPath=str(canonical), canonicalSha256=canonical_sha,
                    decoderProfile={"sampleRate": 16000, "channels": 1,
                                    "sampleFormat": "f32le", "completeSource": True})
    return data, evidence, words, audio


def _playback(state, pid, audio_sha, decoder, audio, cached=None):
    """Keep the exact full IEEE-float32 source playback; never seek in the MP3."""
    folder = state / "source-audio"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{pid}-{audio_sha}.wav"
    if cached is not None:
        if digest_file(path) != cached["playbackSha256"]:
            raise ValueError("The immutable whole-source action playback changed")
        raw = path.read_bytes()
        if (raw[:4] != b"RIFF" or raw[8:12] != b"WAVE" or raw[12:16] != b"fmt "
                or raw[20:22] != struct.pack("<H", 3) or raw[36:40] != b"data"
                or len(raw) != 44 + cached["sourceFrames"] * 4
                or hashlib.sha256(raw[44:]).hexdigest() != cached["sourcePcmSha256"]):
            raise ValueError("Whole-source action playback differs from complete PCM")
        return deepcopy(cached), None
    pcm = decoder(audio)
    if not isinstance(pcm, bytes) or not pcm or len(pcm) % 4:
        raise ValueError("Every source action needs complete float32 decoded frames")
    size = len(pcm)
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", size + 36, b"WAVE", b"fmt ",
                         16, 3, 1, 16000, 64000, 4, 32, b"data", size)
    if path.exists():
        if path.read_bytes() != header + pcm:
            raise ValueError("Existing immutable source playback must not be replaced")
    else:
        with path.open("xb") as stream:
            stream.write(header)
            stream.write(pcm)
    return {"sourcePlaybackPath": str(path.resolve()), "playbackSha256": digest_file(path),
            "sourceFrames": size // 4, "sourceSampleRate": 16000,
            "sourcePcmSha256": hashlib.sha256(pcm).hexdigest()}, pcm


def _candidate(config, target, evidence, words, audio, pcm, folder, label):
    """Validate each raw verse unchanged; final whole-chapter acceptance stays held."""
    pid, verse = target["perekId"], target["pasuk"]
    existing = folder / "queue.json"
    if existing.exists():
        prior = load_queue(existing)
        if (len(prior["cases"]) != 1 or prior["cases"][0]["id"] != f"{pid}-{verse}"
                or prior["cases"][0]["manifestPath"] != evidence["manifestPath"]):
            raise ValueError("The resumed provisional concern packet changed its source")
        from listening_accept import verify_diagnostic
        verify_diagnostic(prior["cases"][0])
        return prior["cases"][0], {"path": str(existing.resolve()), "sha256": digest_file(existing)}
    raw = target["rawDiagnostic"]
    source = Path(evidence["manifestPath"]).parent.parent
    study = build_machine_study(Path(raw["path"]), raw["sha256"],
        source / f"{pid}-diagnostic-summary.json", source, Path(config["canonicalPath"]),
        audio, decoded_pcm=pcm, plan_path=Path(config["planPath"]))
    diagnostic = study["cases"][0]
    folder.mkdir(parents=True, exist_ok=True)
    diagnostic_path = folder / "diagnostic.json"
    if diagnostic_path.exists():
        if read_json(diagnostic_path) != study:
            raise ValueError("An interrupted provisional concern changed its diagnostic")
    else:
        write_json(diagnostic_path, study)
    manifest = read_json(Path(evidence["manifestPath"]))
    case = {"id": f"{pid}-{verse}", "perekId": pid, "pasuk": verse, "label": label,
        "audioSha256": manifest["audioSha256"], "textSha256": manifest["textSha256"],
        "audioPath": str(audio.resolve()), "manifestPath": evidence["manifestPath"],
        "diagnosticPath": str(diagnostic_path.resolve()), "diagnosticSha256": digest_file(diagnostic_path),
        "clipStartMs": round(diagnostic["contextStartSec"] * 1000),
        "clipEndMs": round(diagnostic["contextEndSec"] * 1000),
        "words": deepcopy(diagnostic["diagnosticCandidates"]), "reviewKind": "missing",
        "preparationKind": "machine-suspect", "preparationMethod": POLICY,
        "manualSourceInspection": False, "requiresFreshHumanCutReview": True,
        "chapterPublicationHeld": True, "publicationStatus": "held"}
    validate_case(case, words, manifest)
    case["candidateSha256"] = candidate_digest(case)
    clip = folder / "source.wav"
    if clip.exists():
        # A queue has not been committed yet. Preserve any interrupted artifact
        # and prove a fresh decoder result before reusing the original bytes.
        check = folder / "source-verification.wav"
        diagnostics = _pcm_clip(pcm, check, case["clipStartMs"], case["clipEndMs"])
        if clip.read_bytes() != check.read_bytes():
            raise ValueError("An interrupted provisional source clip is incomplete")
        case["decoderDiagnostics"] = diagnostics
    else:
        case["decoderDiagnostics"] = _pcm_clip(pcm, clip, case["clipStartMs"], case["clipEndMs"])
    case.update(clipPath=str(clip.resolve()), clipSha256=digest_file(clip))
    queue = {"version": 1, "canonicalPath": str(Path(config["canonicalPath"]).resolve()),
        "cases": [case], "excluded": [], "archivedQueues": [], "publicationStatus": "held",
        "queueSha256": digest_json([case])}
    path = folder / "queue.json"
    write_json(path, queue)
    load_queue(path)
    return case, {"path": str(path.resolve()), "sha256": digest_file(path)}


def _pcm_clip(pcm, path, start, end):
    """Convert exact selected cached frames to the app's signed-PCM WAV format."""
    signal = pcm[start * 64:end * 64]
    if len(signal) != (end - start) * 64:
        raise ValueError("The provisional clip exceeds complete original PCM")
    converted = subprocess.run(  # nosec B603: fixed FFmpeg PCM converter, no shell.  # nosemgrep
        [executable("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2",
         "-f", "f32le", "-ar", "16000", "-ac", "1", "-i", "pipe:0", "-f", "s32le", "pipe:1"],
        input=signal, check=True, capture_output=True, timeout=120, **hidden_audio_options())
    if len(converted.stdout) != len(signal):
        raise ValueError("The provisional clip lost or added actual PCM frames")
    with wave.open(str(path), "wb") as stream:
        stream.setparams((1, 4, 16000, 0, "NONE", "not compressed"))
        stream.writeframes(converted.stdout)
    return converted.stderr.decode("utf-8", errors="replace")


def _case_reference(case):
    return {"caseId": case["id"], "candidateSha256": case["candidateSha256"],
            "clipSha256": case["clipSha256"]}


def _invalid_original_boundary(row):
    start, end = row.get("startMs"), row.get("endMs")
    numeric = (isinstance(start, int) and not isinstance(start, bool)
               and isinstance(end, int) and not isinstance(end, bool))
    return not numeric or not 40 <= end - start <= 3000


def _selected_targets(pid, data, planned, cases):
    selected = dict(planned)
    for warning in data["report"]["review"]:
        if warning["reason"] != SOFT_WARNING:
            selected.setdefault(warning["pasuk"], {"perekId": pid, "pasuk": warning["pasuk"],
                "reason": warning["reason"], "contextHoldReason": "No supported original candidate"})
    for row in data["manifest"]["words"]:
        if _invalid_original_boundary(row):
            selected.setdefault(row["pasuk"], {"perekId": pid, "pasuk": row["pasuk"],
                "reason": "Original word boundary is missing or outside the unchanged duration limits",
                "contextHoldReason": "An explicit complete-source range is needed for this verse"})
    for case in cases.values():
        if case["perekId"] == pid:
            selected.setdefault(case["pasuk"], {"perekId": pid, "pasuk": case["pasuk"],
                "reason": "Existing source-bound review concern"})
    if pid in PRIMARY_OLD_TARGETS:
        verse = PRIMARY_OLD_TARGETS[pid]
        selected.setdefault(verse, {"perekId": pid, "pasuk": verse, "reason": "Previously reported source concern"})
    if not selected:
        raise ValueError(f"Pending chapter {pid} has no explained actionable concern")
    return selected


def _target_candidate(config, target, evidence, words, audio, pcm, label,
                      cases, offered_ids, issue_verses, fingerprint):
    pid, verse = target["perekId"], target["pasuk"]
    key = f"{pid}-{verse}"
    case = cases.get(key)
    kind, failure, packet = "locate-source-range", target.get("contextHoldReason"), None
    if verse in issue_verses.get(pid, set()) or target.get("knownSourceDefectHold"):
        kind = "source-remediation"
    elif case is not None:
        kind = "review-cuts"
    elif key in offered_ids:
        raise ValueError("A previously offered concern lacks its immutable current candidate: " + key)
    elif target.get("rawDiagnostic") and not target.get("contextHoldReason"):
        folder = Path(config["batchRoot"]) / "complete-concerns" / fingerprint / key
        try:
            case, packet = _candidate(config, target, evidence, words, audio, pcm, folder, label)
            kind = "review-cuts"
        except (ValueError, KeyError) as error:
            failure = str(error)
    return case, kind, failure, packet


def _action_definition(target, evidence, words, audio, audio_sha, playback, label, case, kind, failure, issues):
    pid, verse = target["perekId"], target["pasuk"]
    selected_words = [{"pasuk": word.pasuk, "segment": word.segment, "text": word.text}
                      for word in words if word.pasuk == verse]
    if not selected_words:
        raise ValueError("An original concern points outside its canonical chapter")
    task = {"version": 1, "policy": POLICY, "taskId": f"concern-{pid}-{verse}",
        "kind": kind, "perekId": pid, "pasuk": verse, "label": label,
        "sourceAudioPath": str(audio.resolve()), "audioSha256": audio_sha,
        "textSha256": text_hash(words), **deepcopy(playback),
        "canonicalWords": selected_words, "sourceEvidence": deepcopy(evidence),
        "originalConcern": deepcopy(target), "publicationStatus": "held", "automaticApproval": False}
    if kind == "review-cuts":
        task.update(caseRef=_case_reference(case), diagnosticSha256=case["diagnosticSha256"])
    elif kind == "source-remediation" and pid in issues:
        issue = issues[pid]
        task["issueUrl"] = (str(issue) if str(issue).startswith("https://") else
            f"https://github.com/bible-on-site/bible-on-site/issues/{issue}")
    if failure:
        task["preparationFailure"] = failure
    task["taskSha256"] = digest_json(task)
    return task


def _target_groups(plan):
    groups = defaultdict(dict)
    for target in plan["targets"]:
        key = target["pasuk"]
        if key in groups[target["perekId"]]:
            raise ValueError("Duplicate original concern target")
        groups[target["perekId"]][key] = target
    return groups


def _verify_cached_targets(prior, binding, state, pid, audio_sha, decoder, audio):
    if prior["sourceBindingSha256"] != binding:
        raise ValueError("A completed concern chapter changed its original evidence")
    _playback(state, pid, audio_sha, decoder, audio, prior["playback"])
    for packet in prior["queues"]:
        if digest_file(Path(packet["path"])) != packet["sha256"]:
            raise ValueError("An immutable prepared concern queue changed")


def prepare_concerns(config, ready_ids, offered_ids, current_cases, *, decoder=decode_source,
                     progress=None):
    """Prepare all pending concerns, translating only external decoder failures."""
    with original_audio_errors("Original concern audio decoding or conversion failed"):
        return _prepare_concerns(config, ready_ids, offered_ids, current_cases,
                                 decoder=decoder, progress=progress)


def _prepare_concerns(config, ready_ids, offered_ids, current_cases, *, decoder, progress):
    plan_path, canonical = Path(config["planPath"]), Path(config["canonicalPath"])
    plan = _checked(plan_path, config["planSha256"])
    canonical_sha = digest_file(canonical)
    pending = sorted(set(config["pendingIds"]) - set(ready_ids))
    labels = chapter_labels(canonical)
    state = Path(config["stateDirectory"]).resolve() / "targets"
    state.mkdir(parents=True, exist_ok=True)
    fingerprint = digest_json({"policy": POLICY, "planSha256": config["planSha256"],
        "canonicalSha256": canonical_sha, "pendingIds": sorted(config["pendingIds"]),
        "knownSourceIssues": config.get("knownSourceIssues", {28: 2249, 136: 2223, 231: 2538}),
        "knownSourceIssueVerses": config.get("knownSourceIssueVerses", {28: [9], 136: [10], 231: [40]})})
    catalog_path = state / "catalog.json"
    catalog = read_state_json(catalog_path) if catalog_path.exists() else {
        "version": 1, "fingerprint": fingerprint, "chapters": {}}
    if catalog.get("fingerprint") != fingerprint:
        raise ValueError("Use a distinct concern state for changed immutable inputs")
    cases = dict(current_cases) if isinstance(current_cases, dict) else {case["id"]: case for case in current_cases}
    targets = _target_groups(plan)
    issues = {int(pid): issue for pid, issue in config.get("knownSourceIssues", {28: 2249, 136: 2223, 231: 2538}).items()}
    issue_verses = {int(pid): set(verses) for pid, verses in config.get(
        "knownSourceIssueVerses", {28: [9], 136: [10], 231: [40]}).items()}
    result = {"tasks": [], "queues": [], "chapters": []}
    for pid in pending:
        if progress:
            progress({"state": "seeding_concerns", "currentPerekId": pid,
                      "chaptersCompleted": len(result["chapters"]), "pendingChapters": len(pending)})
        data, evidence, words, audio = _source(config, pid, canonical_sha)
        audio_sha = data["manifest"]["audioSha256"]
        prior = catalog["chapters"].get(str(pid))
        binding = digest_json({"evidence": evidence, "audioSha256": audio_sha})
        if prior is not None:
            _verify_cached_targets(prior, binding, state, pid, audio_sha, decoder, audio)
            result["tasks"].extend(deepcopy(prior["tasks"]))
            result["queues"].extend(deepcopy(prior["queues"]))
            result["chapters"].append(deepcopy(prior["chapter"]))
            continue
        selected = _selected_targets(pid, data, targets[pid], cases)
        playback, pcm = _playback(state, pid, audio_sha, decoder, audio)
        chapter_tasks, packets = [], []
        for verse, target in sorted(selected.items()):
            label = labels[pid] + " " + hebrew_number(verse)
            case, kind, failure, packet = _target_candidate(config, target, evidence, words, audio, pcm,
                label, cases, offered_ids, issue_verses, fingerprint)
            if packet is not None:
                packets.append(packet)
            chapter_tasks.append(_action_definition(target, evidence, words, audio, audio_sha, playback,
                label, case, kind, failure, issues))
        chapter = {"perekId": pid, "expectedTargets": len(chapter_tasks),
                   "taskIds": [task["taskId"] for task in chapter_tasks], "state": "awaiting_genuine_actions"}
        catalog["chapters"][str(pid)] = {"sourceBindingSha256": binding, "playback": playback,
                                         "tasks": chapter_tasks, "queues": packets, "chapter": chapter}
        write_state_json(catalog_path, catalog)
        result["tasks"].extend(deepcopy(chapter_tasks))
        result["queues"].extend(deepcopy(packets))
        result["chapters"].append(chapter)
    return result
