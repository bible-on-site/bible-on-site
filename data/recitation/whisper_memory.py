"""Keep full FP32 Whisper timestamp decoding within GPU memory."""

from contextlib import contextmanager


def _skip_unused_encoder_maps(module, args, kwargs):
    # Word DTW reads decoder cross-attention only. Retaining encoder self-attention
    # costs 32 * 20 * 1500 * 1500 * 4 bytes (5.36 GiB) for large-v3 at FP32.
    # This changes saved outputs only; all encoder layers and attention math run.
    kwargs["output_attentions"] = False
    kwargs["output_hidden_states"] = False
    return args, kwargs


def _save_attention_on_cpu(module, args, output):
    # Attention has already produced its GPU hidden states. Move only the returned
    # diagnostic weights before Transformers' capture hook retains them.
    hidden, weights = output
    return hidden, weights.detach().cpu() if weights is not None else None


def _cache_layer(module, kwargs):
    cache = kwargs.get("past_key_values")
    if cache is None:
        return None
    cache = cache.cross_attention_cache if kwargs.get("key_value_states") is not None else cache.self_attention_cache
    if module.layer_idx >= len(cache.layers):
        return None
    return cache.layers[module.layer_idx]


def _onload_cache(module, args, kwargs):
    layer = _cache_layer(module, kwargs)
    if layer is not None and layer.is_initialized:
        device = module.q_proj.weight.device
        layer.keys = layer.keys.to(device)
        layer.values = layer.values.to(device)


def _offload_cache(module, args, kwargs, output):
    layer = _cache_layer(module, kwargs)
    if layer is not None and layer.is_initialized:
        layer.keys = layer.keys.cpu()
        layer.values = layer.values.cpu()


@contextmanager
def bounded_whisper_memory(model):
    """Offload saved attention without altering model weights, search, or audio."""
    handles = [model.model.encoder.register_forward_pre_hook(_skip_unused_encoder_maps, with_kwargs=True)]
    original_timestamps = model._extract_token_timestamps
    had_override = "_extract_token_timestamps" in model.__dict__

    def cpu_timestamps(outputs, *args, **kwargs):
        # Beam indices and attention must share a device for the unchanged upstream
        # DTW implementation. Return the small timestamp result to its original device.
        fields = {"sequences": outputs.sequences.cpu(), "cross_attentions": outputs.cross_attentions}
        if "beam_indices" in outputs:
            fields["beam_indices"] = outputs.beam_indices.cpu()
        frames = kwargs.get("num_frames")
        if hasattr(frames, "cpu"):
            kwargs["num_frames"] = frames.cpu()
        result = original_timestamps(type(outputs)(**fields), *args, **kwargs)
        return result.to(outputs.sequences.device)

    try:
        for layer in model.model.decoder.layers:
            for attention in (layer.self_attn, layer.encoder_attn):
                handles.append(attention.register_forward_pre_hook(_onload_cache, with_kwargs=True))
                handles.append(attention.register_forward_hook(_save_attention_on_cpu, prepend=True))
                handles.append(attention.register_forward_hook(_offload_cache, with_kwargs=True))
        model._extract_token_timestamps = cpu_timestamps
        yield
    finally:
        if had_override:
            model._extract_token_timestamps = original_timestamps
        else:
            del model._extract_token_timestamps
        for handle in handles:
            handle.remove()
