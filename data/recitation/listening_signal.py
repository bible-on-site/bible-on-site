"""Validate diagnostic source-inspection proposals; human listening still decides."""

import hashlib
import json
from pathlib import Path

from model_versions import ALIGN_MODEL, ALIGN_REVISION


def checked_json(path, expected):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Source-inspection evidence changed")
    return json.loads(data)


def verify_source_proposals(diagnostic):
    """Keep recorded model evidence separate from the proposed speech boundaries."""
    inspection = checked_json(diagnostic["inspectionEvidencePath"], diagnostic["inspectionEvidenceSha256"])
    feedback = checked_json(diagnostic["feedbackEvidencePath"], diagnostic["feedbackEvidenceSha256"])
    originals = diagnostic["letterCandidates"]
    candidates = diagnostic["diagnosticCandidates"]
    changes = diagnostic["boundaryCorrections"]
    identities = lambda rows: {(row["pasuk"], row["segment"]): row for row in rows}
    original, proposed, corrections = map(identities, (originals, candidates, changes))
    if (len(original) != len(originals) or len(proposed) != len(candidates)
            or len(corrections) != len(changes) or original.keys() != proposed.keys()
            or not corrections or not corrections.keys() <= original.keys()):
        raise ValueError("Duplicate, missing or unrelated source boundary")
    source = diagnostic["sourceAudioSha256"]
    if (inspection.get("sourceAudioSha256") != source or feedback.get("audioSha256") != source
            or inspection.get("perekId") != diagnostic["perekId"]
            or feedback.get("perekId") != diagnostic["perekId"]
            or inspection.get("dtype") != "float32" or inspection.get("device") != "cpu"
            or inspection.get("model") != ALIGN_MODEL or inspection.get("revision") != ALIGN_REVISION
            or inspection.get("canonicalTextSha256") != feedback.get("textSha256")
            or diagnostic.get("automaticApproval") is not False
            or not inspection.get("originalLetterRowsReproducedExactly")
            or not inspection.get("diagnosticOnly") or feedback.get("verdict") != "problem"
            or not feedback.get("savedAt") or feedback.get("candidateWords") != originals):
        raise ValueError("Source proposal lacks the actual reported defect and original acoustic evidence")
    heard = set(feedback["listenEvidenceReportedByBrowser"]["heardSegments"])
    verify_source_geometry(diagnostic, inspection, heard)


def verify_source_geometry(diagnostic, inspection, heard=None):
    """Check recorded changes without treating inspection as actual listening."""
    originals = diagnostic["letterCandidates"]
    candidates = diagnostic["diagnosticCandidates"]
    changes = diagnostic["boundaryCorrections"]
    identities = lambda rows: {(row["pasuk"], row["segment"]): row for row in rows}
    original, proposed, corrections = map(identities, (originals, candidates, changes))
    if (len(original) != len(originals) or len(proposed) != len(candidates)
            or len(corrections) != len(changes) or original.keys() != proposed.keys()
            or not corrections or not corrections.keys() <= original.keys()):
        raise ValueError("Duplicate, missing or unrelated source boundary")
    actual_rows = identities(inspection["rows"])
    actual_path = identities(inspection["pathEvidence"])
    start, end = round(diagnostic["contextStartSec"] * 1000), round(diagnostic["contextEndSec"] * 1000)
    if (inspection["contextStartMs"], inspection["contextEndMs"]) != (start, end):
        raise ValueError("Source-inspection context changed")
    previous_end = start
    for key, row in proposed.items():
        prior = original[key]
        if prior != actual_rows.get(key):
            raise ValueError("Source proposal changed original CTC evidence")
        if ({k: v for k, v in row.items() if k not in ("startMs", "endMs")} !=
                {k: v for k, v in prior.items() if k not in ("startMs", "endMs")}):
            raise ValueError("Source proposal changed canonical identity or letter acoustic score")
        first, last = row["startMs"], row["endMs"]
        if (any(not isinstance(v, int) or isinstance(v, bool) for v in (first, last))
                or not start <= previous_end <= first < last <= end
                or not 40 <= last - first <= 3000):
            raise ValueError("Source proposal violates original timing geometry")
        previous_end = last
        change = corrections.get(key)
        if change is None:
            if row != prior:
                raise ValueError("Unrecorded source boundary change")
            continue
        path = actual_path[key]
        if (row == prior or (heard is not None and row["segment"] not in heard)
                or change.get("originalStartMs") != prior["startMs"]
                or change.get("originalEndMs") != prior["endMs"]
                or change.get("proposedStartMs") != first or change.get("proposedEndMs") != last
                or not isinstance(change.get("sourceObservation"), str) or not change["sourceObservation"].strip()
                or first < path.get("precedingWordEndMs", prior["startMs"])
                or last > path.get("followingWordStartMs", prior["endMs"])):
            raise ValueError("Source proposal lacks a recorded, bounded inspection change")


def verify_initial_source_proposals(diagnostic):
    """Inspect a first candidate without inventing an earlier human complaint."""
    inspection = checked_json(diagnostic["inspectionEvidencePath"], diagnostic["inspectionEvidenceSha256"])
    if (any(key.startswith("feedbackEvidence") for key in diagnostic)
            or diagnostic.get("automaticApproval") is not False
            or inspection.get("sourceInspectionPurpose") != "initial-listening-candidate"
            or inspection.get("sourceAudioSha256") != diagnostic.get("sourceAudioSha256")
            or inspection.get("perekId") != diagnostic.get("perekId")
            or inspection.get("canonicalTextSha256") != diagnostic.get("canonicalTextSha256")
            or inspection.get("dtype") != "float32" or inspection.get("device") != "cpu"
            or inspection.get("threads") != 2
            or inspection.get("model") != ALIGN_MODEL or inspection.get("revision") != ALIGN_REVISION
            or inspection.get("originalLetterRowsReproducedExactly") is not True
            or inspection.get("diagnosticOnly") is not True):
        raise ValueError("Initial source inspection lacks pinned diagnostic evidence")
    spectrum = Path(inspection["sourceSpectrumEvidence"]).read_bytes()
    if hashlib.sha256(spectrum).hexdigest() != inspection["sourceSpectrumSha256"]:
        raise ValueError("Initial source spectrum evidence changed")
    raw = checked_json(inspection["rawDiagnosticPath"], inspection["rawDiagnosticSha256"])
    if (raw.get("diagnosticOnly") is not True or raw.get("dtype") != "float32"
            or raw.get("device") != "cpu" or raw.get("threads") != 2
            or raw.get("model") != ALIGN_MODEL or raw.get("revision") != ALIGN_REVISION):
        raise ValueError("Initial source inspection changed raw model evidence")
    matches = [case for case in raw.get("cases", [])
               if case.get("perekId") == diagnostic["perekId"]
               and case.get("sourceAudioSha256") == diagnostic["sourceAudioSha256"]
               and case.get("contextStartSec") == diagnostic["contextStartSec"]
               and case.get("contextEndSec") == diagnostic["contextEndSec"]
               and case.get("diagnosticCandidates") == diagnostic["letterCandidates"]
               and case.get("letterCandidates") == diagnostic["letterCandidates"]
               and not case.get("boundaryCorrections")]
    if len(matches) != 1:
        raise ValueError("Initial source inspection differs from original letter rows")
    verify_source_geometry(diagnostic, inspection)
