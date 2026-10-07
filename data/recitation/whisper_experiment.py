"""Opt-in memory-transfer experiments. Never imported by the production worker."""

from contextlib import contextmanager

from whisper_memory import (
    _offload_cache, _onload_cache, _save_attention_on_cpu,
    _skip_unused_encoder_maps, bounded_whisper_memory,
)

PROFILES = ("baseline", "selected-heads", "resident-self", "selected-heads-resident-self")


@contextmanager
def experimental_memory(model, profile):
    """Keep all attention math; change only retained diagnostics and cache location.

    Selected heads retain the exact FP32 values read by upstream word DTW.
    Unused layers keep a shape-only zero view. DTW still runs upstream, with its
    head indices remapped to the compact copies in the same original order.
    Resident self keeps only the self KV cache on GPU; cross KV stays offloaded.
    No automatic OOM retry, search/precision change, or publication is permitted.
    """
    if profile not in PROFILES:
        raise ValueError(f"Unknown experimental profile: {profile}")
    if profile == "baseline":
        with bounded_whisper_memory(model):
            yield
        return
    import torch

    compact = profile.startswith("selected-heads")
    resident = profile.endswith("resident-self")
    heads = [tuple(pair) for pair in model.generation_config.alignment_heads]
    if not heads:
        raise ValueError("Pinned alignment heads are required")
    selected = {}
    for layer, head in heads:
        if not (0 <= layer < len(model.model.decoder.layers)
                and 0 <= head < model.config.decoder_attention_heads):
            raise ValueError("Invalid alignment head")
        if head not in selected.setdefault(layer, []):
            selected[layer].append(head)
    remapped = [[layer, selected[layer].index(head)] for layer, head in heads]
    handles = []
    original = model._extract_token_timestamps
    had_override = "_extract_token_timestamps" in model.__dict__

    def save_selected(module, args, output):
        hidden, weights = output
        if weights is None:
            return hidden, None
        indices = selected.get(module.layer_idx, [])
        if indices:
            index = torch.tensor(indices, device=weights.device)
            saved = weights.detach().index_select(1, index).cpu()
        else:
            # No unused head can enter DTW. Preserve the layer/time dimensions
            # required by upstream concatenation without transferring its maps.
            saved = torch.zeros(1, dtype=weights.dtype).expand(
                weights.shape[0], 1, weights.shape[2], weights.shape[3])
        return hidden, saved

    def save_unused_self(module, args, output):
        hidden, weights = output
        if weights is None:
            return hidden, None
        return hidden, torch.zeros(1, dtype=weights.dtype).expand(weights.shape)

    def cpu_timestamps(outputs, alignment_heads, *args, **kwargs):
        if [tuple(pair) for pair in alignment_heads] != heads:
            raise ValueError("Alignment heads changed during the experiment")
        fields = {"sequences": outputs.sequences.cpu(), "cross_attentions": outputs.cross_attentions}
        if "beam_indices" in outputs:
            fields["beam_indices"] = outputs.beam_indices.cpu()
        frames = kwargs.get("num_frames")
        if hasattr(frames, "cpu"):
            kwargs["num_frames"] = frames.cpu()
        result = original(type(outputs)(**fields), remapped if compact else alignment_heads, *args, **kwargs)
        return result.to(outputs.sequences.device)

    try:
        handles.append(model.model.encoder.register_forward_pre_hook(_skip_unused_encoder_maps, with_kwargs=True))
        for layer in model.model.decoder.layers:
            for attention in (layer.self_attn, layer.encoder_attn):
                is_cross = attention is layer.encoder_attn
                if is_cross or not resident:
                    handles.append(attention.register_forward_pre_hook(_onload_cache, with_kwargs=True))
                    handles.append(attention.register_forward_hook(_offload_cache, with_kwargs=True))
                save = (save_selected if is_cross else save_unused_self) if compact else _save_attention_on_cpu
                handles.append(attention.register_forward_hook(save, prepend=True))
        model._extract_token_timestamps = cpu_timestamps
        yield
    finally:
        if had_override:
            model._extract_token_timestamps = original
        elif "_extract_token_timestamps" in model.__dict__:
            del model._extract_token_timestamps
        for handle in handles:
            handle.remove()
