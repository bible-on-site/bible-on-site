"""Turn a genuine selected source range into fresh, unapproved word-cut proposals."""

from copy import deepcopy
from datetime import datetime
from functools import lru_cache
import hashlib
import math
import os
from pathlib import Path

import numpy as np

from alignment import text_hash
from listening_audio import duration
from listening_machine import canonical_words, decode_source
from listening_review import (candidate_digest, digest_file, digest_json, load_queue, make_clip,
                              read_json, validate_case, write_json)
from model_versions import ALIGN_MODEL, ALIGN_REVISION

CONTEXT_METHOD = "human-selected-context-v1"
RATE = 16000
TASK_FIELDS = ("taskId", "kind", "perekId", "pasuk", "label", "sourceAudioPath",
               "audioSha256", "textSha256", "sourceFrames", "sourceSampleRate",
               "sourcePcmSha256", "canonicalWords", "sourceEvidence")


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("The selected source range requires a genuine saved response")
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.utcoffset() is None:
        raise ValueError("The source response needs a timezone-bound saved timestamp")


def _inputs(task, response, loader):
    """Check actual saved identities before any model is loaded or audio inferred."""
    if any(key not in task for key in TASK_FIELDS):
        raise ValueError("The source selection lacks its immutable action definition")
    definition = {key: deepcopy(value) for key, value in task.items() if key != "taskSha256"}
    if (task.get("taskSha256") != digest_json(definition)
            or task.get("kind") not in ("locate-source-range", "review-cuts")
            or response.get("kind") != "locate-source-range"
            or any(response.get(key) != task.get(key) for key in
                   ("taskId", "taskSha256", "audioSha256", "textSha256"))):
        raise ValueError("The source selection differs from its immutable action")
    body = {key: value for key, value in response.items() if key != "responseSha256"}
    if (response.get("responseSha256") != digest_json(body)
            or response.get("publicationStatus") != "held"
            or response.get("automaticApproval") is not False
            or response.get("reviewMethod") != "human-source-range-selection"
            or not isinstance(response.get("submissionId"), str) or not response["submissionId"]):
        raise ValueError("A source selection is held evidence, never an approval")
    _timestamp(response.get("savedAt"))
    start, end = response.get("startMs"), response.get("endMs")
    if (not _integer(start) or not _integer(end) or not 0 <= start < end
            or response.get("heardRange") != {"startMs": start, "endMs": end, "complete": True}
            or not _integer(task.get("sourceFrames")) or task["sourceFrames"] < 1
            or task.get("sourceSampleRate") != RATE or end * 16 > task["sourceFrames"]):
        raise ValueError("Hear the exact selected range inside the complete decoded source")
    evidence = task["sourceEvidence"]
    originals = {}
    for name in ("manifest", "report", "asr"):
        path = Path(evidence[name + "Path"])
        if not path.is_absolute() or digest_file(path) != evidence[name + "Sha256"]:
            raise ValueError("The selected source action has changed original evidence")
        originals[name] = read_json(path)
    recording = Path(task["sourceAudioPath"])
    if not recording.is_absolute() or digest_file(recording) != task["audioSha256"]:
        raise ValueError("The selected original recording changed")
    canonical_path = Path(evidence["canonicalPath"])
    if not canonical_path.is_absolute():
        raise ValueError("The original canonical source needs an absolute bound path")
    words = canonical_words(canonical_path, evidence["canonicalSha256"], task["perekId"])
    selected = [word for word in words if word.pasuk == task["pasuk"]]
    canonical = [{"pasuk": word.pasuk, "segment": word.segment, "text": word.text}
                 for word in selected]
    if (not selected or canonical != task["canonicalWords"]
            or text_hash(words) != task["textSha256"]
            or originals["manifest"].get("perekId") != task["perekId"]):
        raise ValueError("The source action differs from its exact canonical verse")
    from listening_accept import verify_original_evidence
    verify_original_evidence(originals["manifest"], originals["report"], originals["asr"],
                             words, recording, duration(recording))
    pcm = loader(recording)
    if not isinstance(pcm, bytes) or len(pcm) != task["sourceFrames"] * 4:
        raise ValueError("The source action lacks the complete float32 decoded PCM")
    if hashlib.sha256(pcm).hexdigest() != task["sourcePcmSha256"]:
        raise ValueError("The complete source PCM differs from the selected action")
    signal = pcm[start * 64:end * 64]
    return definition, originals, words, selected, signal


class ContextEngine:
    """Lazily load the same pinned full-FP32 CUDA aligner for a genuine action."""

    model = ALIGN_MODEL
    revision = ALIGN_REVISION
    device = "cuda"
    dtype = "float32"
    threads = 2

    def __init__(self):
        os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        import torch
        from acoustic import HebrewAligner
        torch.set_num_threads(2)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        self.aligner = HebrewAligner(ALIGN_MODEL, "cuda", ALIGN_REVISION)
        if not all(parameter.device.type == "cuda" and parameter.dtype == torch.float32
                   for parameter in self.aligner.model.parameters()):
            raise ValueError("Source-context inference requires actual CUDA full FP32")

    def run(self, signal, words, start_seconds):
        from listening_tail import separator_candidates
        return separator_candidates(self.aligner, signal, words, start_seconds)


@lru_cache(maxsize=1)
def _engine():
    return ContextEngine()


def _rows(rows, paths, words, start, end):
    """Require every actual letter path, allowing absent outer adjacent anchors."""
    if len(rows) != len(words) or len(paths) != len(words):
        raise ValueError("The source context needs exactly one row per canonical word")
    normalized = []
    for index, (row, path, word) in enumerate(zip(rows, paths, words, strict=True)):
        if (any(row.get(key) != value for key, value in
                (("pasuk", word.pasuk), ("segment", word.segment), ("text", word.text)))
                or path.get("pasuk") != word.pasuk or path.get("segment") != word.segment
                or any(not _integer(row.get(key)) for key in ("startMs", "endMs"))
                or not start <= row["startMs"] < row["endMs"] <= end
                or not 40 <= row["endMs"] - row["startMs"] <= 3000
                or index and row["startMs"] < rows[index - 1]["endMs"]):
            raise ValueError("The selected context needs valid complete ordered word cuts")
        score = row.get("acousticScore")
        if (isinstance(score, bool) or not isinstance(score, (int, float))
                or not math.isfinite(score) or not 0 <= score <= 1
                or any(path.get(key) != value for key, value in
                       (("letterStartMs", row["startMs"]), ("letterEndMs", row["endMs"]),
                        ("letterAcousticScore", score)))):
            raise ValueError("The source context changed the actual CTC letter path")
        proof = deepcopy(path)
        if index:
            previous = paths[index - 1]
            if (path.get("precedingWordEndMs") != rows[index - 1]["endMs"]
                    or path.get("precedingSeparatorStartMs") != previous.get("separatorStartMs")
                    or path.get("precedingSeparatorEndMs") != previous.get("separatorEndMs")):
                raise ValueError("The source context changed its internal preceding path")
        elif any(path.get(key) is not None for key in
                 ("precedingWordEndMs", "precedingSeparatorStartMs", "precedingSeparatorEndMs")):
            raise ValueError("Do not invent a preceding source-edge anchor")
        if index + 1 < len(rows):
            bounds = (path.get("separatorStartMs"), path.get("separatorEndMs"),
                      path.get("followingWordStartMs"))
            if (not all(_integer(value) for value in bounds)
                    or not row["endMs"] <= bounds[0] <= bounds[1] <= bounds[2]
                    or bounds[2] != rows[index + 1]["startMs"]):
                raise ValueError("The source context changed its internal following path")
        elif any(path.get(key) is not None for key in
                 ("separatorStartMs", "separatorEndMs", "followingWordStartMs")):
            raise ValueError("Do not invent a following source-edge anchor")
        for key in ("precedingWordEndMs", "precedingSeparatorStartMs", "precedingSeparatorEndMs",
                    "separatorStartMs", "separatorEndMs", "followingWordStartMs"):
            proof.setdefault(key, None)
        normalized.append(proof)
    return normalized


def _diagnostic(task, response, originals, selected, signal, rows, paths):
    start, end = response["startMs"], response["endMs"]
    return {"perekId": task["perekId"], "pasuk": task["pasuk"],
        "sourceAudioSha256": task["audioSha256"], "canonicalTextSha256": task["textSha256"],
        "contextStartSec": start / 1000, "contextEndSec": end / 1000,
        "completeDecodedSourceFrames": task["sourceFrames"], "sourceSamplingRate": RATE,
        "contextWordIdentities": [{"pasuk": word.pasuk, "segment": word.segment} for word in selected],
        "letterCandidates": deepcopy(rows), "diagnosticCandidates": deepcopy(rows),
        "pathEvidence": deepcopy(paths), "boundaryCorrections": [],
        "originalReasons": [row["reason"] for row in originals["report"]["review"]
                            if row["pasuk"] == task["pasuk"]],
        "boundaryMethod": CONTEXT_METHOD, "automaticApproval": False,
        "sourceInspectionPerformed": False, "requiresGenuineFreshCutHearing": True,
        "sameContextReplayTwiceExactly": True,
        "contextEvidence": {"task": deepcopy(task), "response": deepcopy(response),
            "taskSha256": task["taskSha256"], "responseSha256": response["responseSha256"],
            "selectedPcmSha256": hashlib.sha256(signal).hexdigest(),
            "rawOutputSha256": digest_json({"rows": rows, "paths": paths}),
            "device": "cuda", "dtype": "float32", "threads": 2,
            "model": ALIGN_MODEL, "revision": ALIGN_REVISION}}


def build_context_study(task, response, *, engine=None, loader=None):
    """Infer only a genuine saved range; context hearing grants no word approval."""
    definition, originals, words, selected, signal = _inputs(task, response, loader or decode_source)
    task = {**definition, "taskSha256": task["taskSha256"]}
    engine = engine or _engine()
    if any(getattr(engine, key, None) != value for key, value in
           (("device", "cuda"), ("dtype", "float32"), ("threads", 2),
            ("model", ALIGN_MODEL), ("revision", ALIGN_REVISION))):
        raise ValueError("Source context requires the unchanged pinned CUDA FP32 engine")
    audio = np.frombuffer(signal, dtype="<f4").copy()
    first = engine.run(audio, selected, response["startMs"] / 1000)
    second = engine.run(audio, selected, response["startMs"] / 1000)
    if first != second:
        raise ValueError("The selected context did not replay twice exactly")
    rows, paths = first
    paths = _rows(rows, paths, selected, response["startMs"], response["endMs"])
    case = {"pasuk": task["pasuk"], "audioSha256": task["audioSha256"],
            "textSha256": task["textSha256"], "words": rows,
            "preparationKind": CONTEXT_METHOD,
            "requiresFreshHumanCutReview": True, "manualSourceInspection": False,
            "clipStartMs": response["startMs"], "clipEndMs": response["endMs"]}
    validate_case(case, words, originals["manifest"])
    diagnostic = _diagnostic(task, response, originals, selected, signal, rows, paths)
    return {"diagnosticOnly": True, "device": "cuda", "dtype": "float32", "threads": 2,
            "model": ALIGN_MODEL, "revision": ALIGN_REVISION, "cases": [diagnostic]}


def verify_context_proposals(diagnostic, *, loader=None):
    """Verify immutable response/source/PCM/path bindings without repeating inference."""
    evidence = diagnostic["contextEvidence"]
    task, response = evidence["task"], evidence["response"]
    _, originals, _, selected, signal = _inputs(task, response, loader or decode_source)
    rows = diagnostic["letterCandidates"]
    paths = _rows(rows, diagnostic["pathEvidence"], selected, response["startMs"], response["endMs"])
    expected = _diagnostic(task, response, originals, selected, signal, rows, paths)
    if diagnostic != expected:
        raise ValueError("The human-selected context proposal changed its exact bound evidence")


def write_context_queue(study, output, label):
    """Freeze the unapproved diagnostic and exact original-source WAV in one packet."""
    diagnostic = study["cases"][0]
    verify_context_proposals(diagnostic)
    task, response = (diagnostic["contextEvidence"][key] for key in ("task", "response"))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    diagnostic_path = output / "diagnostic.json"
    write_json(diagnostic_path, study)
    case = {"id": f"{task['perekId']}-{task['pasuk']}", "perekId": task["perekId"],
        "pasuk": task["pasuk"], "label": label, "audioSha256": task["audioSha256"],
        "textSha256": task["textSha256"], "audioPath": task["sourceAudioPath"],
        "manifestPath": task["sourceEvidence"]["manifestPath"],
        "diagnosticPath": str(diagnostic_path.resolve()), "diagnosticSha256": digest_file(diagnostic_path),
        "clipStartMs": response["startMs"], "clipEndMs": response["endMs"],
        "words": deepcopy(diagnostic["diagnosticCandidates"]), "reviewKind": "missing",
        "preparationKind": CONTEXT_METHOD, "manualSourceInspection": False,
        "publicationStatus": "held", "requiresFreshHumanCutReview": True}
    case["candidateSha256"] = candidate_digest(case)
    clip = output / "source-context.wav"
    case["decoderDiagnostics"] = make_clip(Path(case["audioPath"]), clip,
                                          case["clipStartMs"], case["clipEndMs"])
    case.update(clipPath=str(clip.resolve()), clipSha256=digest_file(clip))
    queue = {"version": 1, "canonicalPath": task["sourceEvidence"]["canonicalPath"],
             "cases": [case], "excluded": [], "archivedQueues": [],
             "publicationStatus": "held", "queueSha256": digest_json([case])}
    path = output / "queue.json"
    write_json(path, queue)
    load_queue(path)
    return path
