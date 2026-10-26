"""Prepare source-bound machine proposals without granting listening approval."""

# Preserve actual CUDA letter spans, without claiming source inspection or
# corrected endpoints. Publication requires genuine cut hearing and the existing
# whole-chapter acceptance gates.

from copy import deepcopy
from collections import OrderedDict
from functools import lru_cache
import hashlib
import json
import subprocess  # nosec B404: fixed, resolved FFmpeg argv without a shell.
from pathlib import Path
import threading

from alignment import text_hash, words_for
from listening_audio import duration, hidden_audio_options
from listening_review import digest_file, read_json, validate_case
from model_versions import ALIGN_MODEL, ALIGN_REVISION
from recite import executable

MACHINE_METHOD = "machine-diagnostic-initial-candidate-v1"
RATE = 16000
_CANONICAL_CACHE = OrderedDict()
_CANONICAL_LOCK = threading.Lock()


def canonical_words(path, expected_sha, perek_id):
    """Hash actual bytes on every read; cache only immutable parsed word tuples."""
    path = Path(path).resolve()
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha:
        raise ValueError("Canonical source changed after its immutable binding")
    key = str(path), expected_sha
    with _CANONICAL_LOCK:
        chapters = _CANONICAL_CACHE.get(key)
        if chapters is None:
            books = json.loads(raw)
            chapters = {part["perekFrom"] + index: tuple(words_for(chapter))
                        for book in books for part in book.get("additionals", [book])
                        for index, chapter in enumerate(part["perakim"])}
            _CANONICAL_CACHE[key] = chapters
            while len(_CANONICAL_CACHE) > 4:
                _CANONICAL_CACHE.popitem(last=False)
        else:
            _CANONICAL_CACHE.move_to_end(key)
        return chapters[perek_id]


def _checked(path, expected):
    path = Path(path)
    if digest_file(path) != expected:
        raise ValueError("Machine preparation evidence changed")
    return read_json(path)


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


@lru_cache(maxsize=2)
def _decoded_source(path, size, modified_ns, audio_sha):
    """Cache only a fully decoded, byte-bound original; never a worker checkpoint."""
    source = Path(path)
    if digest_file(source) != audio_sha:
        raise ValueError("Machine source recording changed")
    result = subprocess.run(  # nosec B603: resolved executable, absolute source, no shell.  # nosemgrep
        [executable("ffmpeg"), "-v", "error", "-nostdin", "-threads", "2",
         "-i", str(source.resolve()), "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
        check=True, capture_output=True, timeout=120, **hidden_audio_options())
    after = source.stat()
    if (after.st_size, after.st_mtime_ns) != (size, modified_ns):
        raise ValueError("Machine source recording changed during decoding")
    return result.stdout


def decode_source(recording):
    """Share one complete original PCM decode across a chapter's preparation."""
    recording = Path(recording).resolve()
    stat = recording.stat()
    return _decoded_source(str(recording), stat.st_size, stat.st_mtime_ns, digest_file(recording))


def _pcm_bytes(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        result = bytes(value)
    elif str(getattr(value, "dtype", "")) == "float32":
        result = value.tobytes(order="C")
    else:
        raise ValueError("Machine context requires complete float32 source PCM")
    if not result or len(result) % 4:
        raise ValueError("Machine context has incomplete float32 source frames")
    return result


def _paths(raw):
    rows, paths = raw["rawLetterRows"], raw["pathEvidence"]
    if len(rows) != len(paths):
        raise ValueError("Machine candidate lacks complete original path evidence")
    for index, (row, path) in enumerate(zip(rows, paths, strict=True)):
        if (any(path.get(k) != row.get(k) for k in ("pasuk", "segment"))
                or path.get("letterStartMs") != row["startMs"]
                or path.get("letterEndMs") != row["endMs"]
                or path.get("letterAcousticScore") != row["acousticScore"]):
            raise ValueError("Machine rows differ from actual letter path")
        values = [path.get(key) for key in (
            "precedingWordEndMs", "precedingSeparatorStartMs", "precedingSeparatorEndMs",
            "letterStartMs", "letterEndMs", "separatorStartMs", "separatorEndMs", "followingWordStartMs")]
        if (not all(_integer(value) for value in values)
                or not raw["contextStartMs"] <= values[0] <= values[1] <= values[2] <= values[3]
                < values[4] <= values[5] <= values[6] <= values[7] <= raw["contextEndMs"]):
            raise ValueError("Machine candidate lacks actual bounded adjacent path context")
        if (index and path["precedingWordEndMs"] != rows[index - 1]["endMs"]
                or index + 1 < len(rows) and path["followingWordStartMs"] != rows[index + 1]["startMs"]):
            raise ValueError("Machine adjacent word paths changed")
        score = row["acousticScore"]
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1:
            raise ValueError("Machine candidate has invalid actual acoustic score")


def _validate(raw, evidence, decoded_pcm=None):
    """Verify immutable selection, original evidence, complete PCM and raw spans."""
    if (raw.get("device") != "cuda" or raw.get("dtype") != "float32"
            or raw.get("model") != ALIGN_MODEL or raw.get("revision") != ALIGN_REVISION
            or raw.get("threads") != 2 or raw.get("sameContextReplayTwiceExactly") is not True
            or raw.get("diagnosticOnly") is not True or raw.get("automaticApproval") is not False):
        raise ValueError("Machine proposal lacks pinned twice-replayed CUDA FP32 evidence")
    pid, verse = raw["perekId"], raw["pasuk"]
    if not _integer(pid) or not _integer(verse) or pid <= 0 or verse <= 0:
        raise ValueError("Machine proposal has invalid canonical identity")
    plan = _checked(evidence["planPath"], evidence["planSha256"])
    targets = [item for item in plan["targets"] if (item["perekId"], item["pasuk"]) == (pid, verse)]
    if (len(targets) != 1 or targets[0].get("knownSourceDefectHold") is not False
            or targets[0].get("contextHoldReason") is not None
            or not (targets[0].get("missingBoundarySegments") or targets[0].get("invalidDurationWords"))):
        raise ValueError("Machine selection is not an eligible genuine repair target")
    target = targets[0].get("rawDiagnostic") or {}
    if (Path(target.get("path", "")).resolve() != Path(evidence["rawDiagnosticPath"]).resolve()
            or target.get("sha256") != evidence["rawDiagnosticSha256"]):
        raise ValueError("Machine diagnostic differs from the immutable selective plan")
    summary = _checked(evidence["summaryPath"], evidence["summarySha256"])
    matches = [item for item in summary["diagnostics"] if item["pasuk"] == verse]
    if (summary["perekId"] != pid or len(matches) != 1
            or matches[0].get("sha256") != evidence["rawDiagnosticSha256"]
            or Path(matches[0]["path"]).resolve() != Path(evidence["rawDiagnosticPath"]).resolve()
            or summary["sourceEvidenceHashes"] != raw["sourceEvidenceHashes"]):
        raise ValueError("Machine diagnostic differs from its completed source summary")
    expected = {f"alignments/{pid}.json", f"{pid}.review.json", f"{pid}.asr.json"}
    if set(raw["sourceEvidenceHashes"]) != expected:
        raise ValueError("Machine proposal requires exactly the original source evidence")
    source = Path(evidence["sourceRoot"])
    originals = {name: _checked(source / name, sha) for name, sha in raw["sourceEvidenceHashes"].items()}
    canonical = Path(evidence["canonicalPath"])
    words = canonical_words(canonical, evidence["canonicalSha256"], pid)
    if raw["canonicalTextSha256"] != text_hash(words):
        raise ValueError("Machine canonical chapter changed")
    recording = Path(evidence["recordingPath"])
    manifest = originals[f"alignments/{pid}.json"]
    if raw["sourceAudioSha256"] != manifest["audioSha256"]:
        raise ValueError("Machine diagnostic uses a different original recording")
    reasons = [item["reason"] for item in originals[f"{pid}.review.json"]["review"]
               if item["pasuk"] == verse]
    if raw["originalReasons"] != reasons:
        raise ValueError("Machine diagnostic changed original review reasons")
    from listening_accept import verify_original_evidence
    verify_original_evidence(manifest, originals[f"{pid}.review.json"], originals[f"{pid}.asr.json"],
                             words, recording, duration(recording))
    left = [row for row in manifest["words"] if row["pasuk"] == verse - 1][-2:]
    right = [row for row in manifest["words"] if row["pasuk"] == verse + 1][:2]
    if (not left or not right or any(not _integer(row.get(key)) for row in left + right
                                    for key in ("startMs", "endMs"))):
        raise ValueError("Machine source-edge or unavailable adjacent context remains held")
    start, end = raw["contextStartMs"], raw["contextEndMs"]
    if (not _integer(start) or not _integer(end) or not 0 <= start < end or end - start > 45000
            or (start, end) != (left[0]["startMs"], right[-1]["endMs"])):
        raise ValueError("Machine context differs from actual original adjacent anchors")
    anchors = {(row["pasuk"], row["segment"]) for row in left + right}
    selected = [{"pasuk": word.pasuk, "segment": word.segment} for word in words
                if word.pasuk == verse or (word.pasuk, word.segment) in anchors]
    if raw["contextWordIdentities"] != selected:
        raise ValueError("Machine context changed canonical word identities")
    if decoded_pcm is None:
        stat = recording.stat()
        decoded_pcm = _decoded_source(str(recording.resolve()), stat.st_size, stat.st_mtime_ns,
                                     raw["sourceAudioSha256"])
    pcm = _pcm_bytes(decoded_pcm)
    if (not _integer(raw["completeDecodedSourceFrames"])
            or len(pcm) // 4 != raw["completeDecodedSourceFrames"] or end * 16 > len(pcm) // 4
            or hashlib.sha256(pcm[start * 16 * 4:end * 16 * 4]).hexdigest() != raw["contextPcmSha256"]):
        raise ValueError("Machine context differs from complete actual decoded source PCM")
    case = {"audioSha256": raw["sourceAudioSha256"], "textSha256": raw["canonicalTextSha256"],
            "pasuk": verse, "words": raw["rawLetterRows"], "clipStartMs": start, "clipEndMs": end}
    validate_case(case, words, manifest)
    _paths(raw)


def build_machine_study(raw_path, expected_sha, summary_path, source_root, canonical, recording,
                        decoded_pcm=None, *, plan_path=None):
    """Prepare an explicit unapproved machine proposal; never change model rows."""
    if plan_path is None:
        raise ValueError("Machine preparation requires the immutable selective repair plan")
    raw_path, summary_path, canonical = map(Path, (raw_path, summary_path, canonical))
    raw = _checked(raw_path, expected_sha)
    evidence = {"rawDiagnosticPath": str(raw_path.resolve()), "rawDiagnosticSha256": expected_sha,
                "summaryPath": str(summary_path.resolve()), "summarySha256": digest_file(summary_path),
                "sourceRoot": str(Path(source_root).resolve()),
                "canonicalPath": str(canonical.resolve()), "canonicalSha256": digest_file(canonical),
                "recordingPath": str(Path(recording).resolve()),
                "planPath": str(Path(plan_path).resolve()), "planSha256": digest_file(Path(plan_path))}
    _validate(raw, evidence, decoded_pcm)
    diagnostic = {"perekId": raw["perekId"], "pasuk": raw["pasuk"],
                  "sourceAudioSha256": raw["sourceAudioSha256"],
                  "canonicalTextSha256": raw["canonicalTextSha256"],
                  "contextStartSec": raw["contextStartMs"] / 1000,
                  "contextEndSec": raw["contextEndMs"] / 1000,
                  "completeDecodedSourceFrames": raw["completeDecodedSourceFrames"],
                  "sourceSamplingRate": RATE, "contextWordIdentities": deepcopy(raw["contextWordIdentities"]),
                  "letterCandidates": deepcopy(raw["rawLetterRows"]),
                  "diagnosticCandidates": deepcopy(raw["rawLetterRows"]), "boundaryCorrections": [],
                  "originalReasons": deepcopy(raw["originalReasons"]), "boundaryMethod": MACHINE_METHOD,
                  "automaticApproval": False, "sourceInspectionPerformed": False,
                  "requiresGenuineFreshCutHearing": True, "machineEvidence": evidence}
    return {"diagnosticOnly": True, "device": "cuda", "dtype": "float32", "threads": 2,
            "model": ALIGN_MODEL, "revision": ALIGN_REVISION, "cases": [diagnostic]}


def verify_machine_proposals(diagnostic):
    """Reproduce every machine evidence check; no manual inspection is invented."""
    if (diagnostic.get("boundaryMethod") != MACHINE_METHOD
            or diagnostic.get("automaticApproval") is not False
            or diagnostic.get("sourceInspectionPerformed") is not False
            or diagnostic.get("requiresGenuineFreshCutHearing") is not True
            or diagnostic.get("boundaryCorrections") != []
            or "sourceObservation" in diagnostic
            or any(key.startswith(("feedbackEvidence", "inspectionEvidence")) for key in diagnostic)):
        raise ValueError("Machine proposal cannot claim inspection, corrections or approval")
    evidence = diagnostic["machineEvidence"]
    raw = _checked(evidence["rawDiagnosticPath"], evidence["rawDiagnosticSha256"])
    _validate(raw, evidence)
    bound = {"perekId": raw["perekId"], "pasuk": raw["pasuk"],
             "sourceAudioSha256": raw["sourceAudioSha256"],
             "canonicalTextSha256": raw["canonicalTextSha256"],
             "contextStartSec": raw["contextStartMs"] / 1000,
             "contextEndSec": raw["contextEndMs"] / 1000,
             "completeDecodedSourceFrames": raw["completeDecodedSourceFrames"], "sourceSamplingRate": RATE,
             "contextWordIdentities": raw["contextWordIdentities"], "originalReasons": raw["originalReasons"],
             "letterCandidates": raw["rawLetterRows"], "diagnosticCandidates": raw["rawLetterRows"]}
    if any(diagnostic.get(key) != value for key, value in bound.items()):
        raise ValueError("Machine proposal changed the actual original CUDA candidate")
