"""CTC Viterbi alignment to known Hebrew words, with acoustic scores."""

import numpy as np

from model_versions import ALIGN_REVISION


def ctc_spans(log_probs, tokens, blank_id):
    """
    Best CTC path including required blanks between repeated characters.

    Allows leading/trailing silence. Returns token spans in emission frames.
    Scores are acoustic likelihoods, not calibrated probabilities of correctness.
    """
    frames, _ = log_probs.shape
    if not tokens or frames < len(tokens):
        raise ValueError("Not enough audio frames for the transcript")
    labels = np.full(len(tokens) * 2 + 1, blank_id, dtype=int)
    labels[1::2] = tokens
    states = len(labels)
    skip = np.zeros(states, dtype=bool)
    skip[2:] = (labels[2:] != blank_id) & (labels[2:] != labels[:-2])
    previous = np.full(states, -np.inf)
    previous[0] = log_probs[0, blank_id]
    previous[1] = log_probs[0, tokens[0]]
    back = np.zeros((frames, states), dtype=np.uint8)
    for frame in range(1, frames):
        one = np.concatenate(([-np.inf], previous[:-1]))
        two = np.concatenate(([-np.inf, -np.inf], previous[:-2]))
        two[~skip] = -np.inf
        candidates = np.stack((previous, one, two))
        back[frame] = np.argmax(candidates, axis=0)
        previous = np.max(candidates, axis=0) + log_probs[frame, labels]
    state = states - 1 if previous[-1] > previous[-2] else states - 2
    if not np.isfinite(previous[state]):
        raise ValueError("No valid CTC path")
    path = np.empty(frames, dtype=int)
    for frame in range(frames - 1, -1, -1):
        path[frame] = state
        state -= int(back[frame, state])
    spans = []
    for index, token in enumerate(tokens):
        positions = np.flatnonzero(path == 2 * index + 1)
        if not len(positions):
            raise ValueError("CTC omitted a transcript token")
        spans.append((int(positions[0]), int(positions[-1]) + 1,
                      float(np.exp(log_probs[positions, token].mean()))))
    return spans


class HebrewAligner:
    def __init__(self, model_id, device, revision=ALIGN_REVISION):
        """Load the pinned acoustic model and its matching processor."""
        import torch
        from transformers import AutoModelForCTC, AutoProcessor

        self.torch = torch
        self.device = device
        self.processor = AutoProcessor.from_pretrained(model_id, revision=revision)
        self.model = AutoModelForCTC.from_pretrained(model_id, revision=revision).to(device).eval()
        self.vocab = self.processor.tokenizer.get_vocab()
        self.blank = self.model.config.pad_token_id

    def align(self, audio, words):
        text = " ".join(words)
        characters = text.replace(" ", self.processor.tokenizer.word_delimiter_token)
        if any(char not in self.vocab for char in characters):
            raise ValueError("Transcript contains characters outside the acoustic vocabulary")
        inputs = self.processor(audio, sampling_rate=16000, return_tensors="pt")
        with self.torch.inference_mode():
            logits = self.model(inputs.input_values.to(self.device)).logits[0]
            emissions = logits.log_softmax(-1).cpu().numpy()
        spans = ctc_spans(emissions, [self.vocab[c] for c in characters], self.blank)
        stride = len(audio) / 16000 / len(emissions)
        result, offset = [], 0
        for word in words:
            parts = spans[offset:offset + len(word)]
            result.append((parts[0][0] * stride, parts[-1][1] * stride,
                           float(np.mean([p[2] for p in parts]))))
            offset += len(word) + 1
        return result
