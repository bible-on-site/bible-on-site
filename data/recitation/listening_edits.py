"""Validate human timing proposals without changing a listening candidate or approval."""
from copy import deepcopy
import hashlib
import io
from pathlib import Path
import wave


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _segments(value, allowed, name):
    if (not isinstance(value, list) or any(not _integer(segment) for segment in value)
            or len(value) != len(set(value)) or not set(value) <= allowed):
        raise ValueError(f"{name} contains unknown or duplicate word identities")
    return sorted(value)


def verify_clip(case):
    """Bind proposal playback limits to all actual decoded lossless PCM frames."""
    path = Path(case["clipPath"])
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    if ((before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
            or hashlib.sha256(raw).hexdigest() != case["clipSha256"]):
        raise ValueError("Exact listening audio changed")
    try:
        with wave.open(io.BytesIO(raw), "rb") as clip:
            frames, rate, channels, width = (clip.getnframes(), clip.getframerate(),
                                             clip.getnchannels(), clip.getsampwidth())
            if (clip.getcomptype() != "NONE" or rate != 16000 or channels != 1
                    or width not in (2, 3, 4) or frames <= 0):
                raise ValueError("Expected complete original-source 16 kHz mono PCM listening audio")
            pcm = clip.readframes(frames)
            if len(pcm) != frames * channels * width:
                raise ValueError("Listening PCM frames are truncated")
    except (wave.Error, EOFError) as error:
        raise ValueError("Invalid lossless listening audio") from error
    start, end = case["clipStartMs"], case["clipEndMs"]
    if (not _integer(start) or not _integer(end) or not 0 <= start < end
            or end - start > 45000 or frames * 1000 != (end - start) * rate):
        raise ValueError("Listening context differs from actual PCM frame bounds")
    return {"sampleRate": rate, "channels": channels, "frameCount": frames,
            "pcmSha256": hashlib.sha256(pcm).hexdigest()}


def validate_cut_edit(case, payload):
    """Return a held, source-bound proposal; fresh hearing never approves old coordinates."""
    if any(payload.get(key) != case[key] for key in ("candidateSha256", "clipSha256")):
        raise ValueError("Timing edit refers to a different exact candidate")
    if payload.get("caseId") != case["id"]:
        raise ValueError("Timing edit refers to a different verse")
    edits = payload.get("timingEdits")
    if not isinstance(edits, list) or not edits or len(edits) > len(case["words"]):
        raise ValueError("Provide changed word timing edits")
    words = deepcopy(case["words"])
    by_segment = {word["segment"]: word for word in words}
    if len(by_segment) != len(words):
        raise ValueError("Stored candidate has duplicate word identities")
    changed = set()
    checked_edits = []
    for edit in edits:
        if (not isinstance(edit, dict) or set(edit) != {"segment", "startMs", "endMs"}
                or any(not _integer(edit.get(key)) for key in ("segment", "startMs", "endMs"))):
            raise ValueError("Timing edits require integer word identity, start and end")
        segment = edit["segment"]
        if segment not in by_segment or segment in changed:
            raise ValueError("Timing edits contain unknown or duplicate word identities")
        word = by_segment[segment]
        if (word["startMs"], word["endMs"]) == (edit["startMs"], edit["endMs"]):
            raise ValueError("Timing edits must contain changed cuts only")
        word.update(startMs=edit["startMs"], endMs=edit["endMs"])
        changed.add(segment)
        checked_edits.append(dict(edit))
    heard = _segments(payload.get("heardSegments", []), set(by_segment), "Original listening")
    heard_edited = _segments(payload.get("heardEditedSegments", []), changed, "Edited listening")
    if set(heard_edited) != changed:
        raise ValueError("Listen to every exact edited cut before saving")
    previous_end = case["clipStartMs"]
    for word in words:
        start, end = word["startMs"], word["endMs"]
        if (not _integer(start) or not _integer(end)
                or not case["clipStartMs"] <= start < end <= case["clipEndMs"]
                or not 40 <= end - start <= 3000 or start < previous_end):
            raise ValueError("Edited cuts require ordered non-overlapping geometry inside the listening clip")
        previous_end = end
    note = payload.get("note", "")
    if not isinstance(note, str) or len(note) > 2000:
        raise ValueError("Note must be text of at most 2000 characters")
    clip_evidence = verify_clip(case)
    return {"kind": "manual-cut-proposal", "scope": "one-verse-cut-proposal",
            "caseId": case["id"], "perekId": case["perekId"], "pasuk": case["pasuk"],
            **{key: case[key] for key in ("audioSha256", "textSha256", "candidateSha256",
                                           "clipSha256", "diagnosticSha256")},
            "timingEdits": sorted(checked_edits, key=lambda edit: edit["segment"]),
            "words": words, "changedSegments": sorted(changed),
            "listenEvidenceReportedByBrowser": {"heardSegments": heard,
                                                  "heardEditedSegments": heard_edited},
            "clipEvidence": clip_evidence, "note": note,
            "publicationStatus": "held", "automaticApproval": False}
