"""Diagnostic-only trailing-vowel candidates from the pinned CTC separator path."""

import numpy as np

from acoustic import ctc_spans

METHOD = "ctc-following-separator-start-v1"
END_METHOD = "ctc-following-separator-end-v1"


def separator_candidates(aligner, audio, words, start_seconds):
    """Expose actual character and separator spans; no fixed padding or clamping."""
    characters = " ".join(word.speech for word in words).replace(
        " ", aligner.processor.tokenizer.word_delimiter_token)
    inputs = aligner.processor(audio, sampling_rate=16000, return_tensors="pt")
    with aligner.torch.inference_mode():
        emissions = aligner.model(inputs.input_values.to(aligner.device)).logits[0].log_softmax(-1).cpu().numpy()
    spans = ctc_spans(emissions, [aligner.vocab[c] for c in characters], aligner.blank)
    stride = len(audio) / 16000 / len(emissions)
    rows, evidence, offset = [], [], 0

    def milliseconds(frame):
        return round((start_seconds + frame * stride) * 1000)

    for word in words:
        parts = spans[offset:offset + len(word.speech)]
        offset += len(word.speech)
        row = {"pasuk": word.pasuk, "segment": word.segment, "text": word.text,
               "startMs": milliseconds(parts[0][0]), "endMs": milliseconds(parts[-1][1]),
               "acousticScore": round(float(np.mean([p[2] for p in parts])), 4)}
        proof = {"pasuk": word.pasuk, "segment": word.segment,
                 "letterStartMs": row["startMs"], "letterEndMs": row["endMs"],
                 "letterAcousticScore": row["acousticScore"]}
        if offset < len(spans):
            separator = spans[offset]
            proof.update(separatorStartMs=milliseconds(separator[0]),
                         separatorEndMs=milliseconds(separator[1]),
                         followingWordStartMs=milliseconds(spans[offset + 1][0]))
        rows.append(row)
        evidence.append(proof)
        offset += 1
    return rows, evidence


def correct_ends(rows, evidence, identities, boundary="start"):
    """Propose only source-supported separator starts, requiring fresh listening."""
    if boundary not in ("start", "end"):
        raise ValueError("Unknown separator boundary")
    result = [dict(row) for row in rows]
    changes = []
    for row, proof in zip(result, evidence, strict=True):
        if (row["pasuk"], row["segment"]) not in identities:
            continue
        end = proof.get("separatorStartMs" if boundary == "start" else "separatorEndMs")
        if end is None or end <= row["endMs"]:
            raise ValueError("No later model separator for reported clipped ending")
        if (not row["endMs"] < end <= proof["followingWordStartMs"]
                or not 40 <= end - row["startMs"] <= 3000):
            raise ValueError("Separator candidate violates original timing geometry")
        changes.append({**proof, "originalEndMs": row["endMs"], "proposedEndMs": end})
        row["endMs"] = end
    return result, changes


def verify_corrections(diagnostic):
    """Every changed end must be the recorded pinned-path separator, never a pad."""
    if diagnostic.get("boundaryMethod") not in (METHOD, END_METHOD):
        raise ValueError("Unknown boundary correction method")
    boundary_key = "separatorStartMs" if diagnostic["boundaryMethod"] == METHOD else "separatorEndMs"
    original = {(row["pasuk"], row["segment"]): row for row in diagnostic["letterCandidates"]}
    changes = {(row["pasuk"], row["segment"]): row for row in diagnostic["boundaryCorrections"]}
    for row in diagnostic["diagnosticCandidates"]:
        key = row["pasuk"], row["segment"]
        prior = original[key]
        if {k: v for k, v in row.items() if k != "endMs"} != {
                k: v for k, v in prior.items() if k != "endMs"}:
            raise ValueError("Tail correction changed canonical identity, start or acoustic evidence")
        change = changes.get(key)
        if change is None:
            if row != prior:
                raise ValueError("Unrecorded boundary change")
        else:
            verify_boundary(row, prior, change, boundary_key)


def verify_boundary(row, prior, change, boundary_key):
    """A proposed endpoint must be the recorded separator and remain nonoverlapping."""
    if (change["originalEndMs"] != prior["endMs"]
            or row["endMs"] != change["proposedEndMs"]
            or row["endMs"] != change[boundary_key]
            or not prior["endMs"] < row["endMs"] <= change["followingWordStartMs"]
            or not 40 <= row["endMs"] - row["startMs"] <= 3000):
        raise ValueError("Tail boundary lacks the actual model separator")