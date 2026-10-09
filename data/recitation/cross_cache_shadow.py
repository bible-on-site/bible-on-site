"""Opt-in reuse of an unchanged CPU cross-attention cache; no attention math changes."""

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess  # nosec B404: fixed read-only process inspection.
import sys
from unittest.mock import patch

import whisper_experiment
from whisper_memory import _cache_layer, _onload_cache, _offload_cache

PROFILE = "cross-cache-cpu-shadow-v1"
PARENT_PROFILE = "selected-heads-resident-self"


def assert_idle_processes():
    if sys.platform != "win32":
        return
    command = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python' } | "
               "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    processes = json.loads(subprocess.check_output(  # nosec B603 B607: fixed argv.
        ["powershell.exe", "-NoProfile", "-Command", command], text=True) or "[]")
    if isinstance(processes, dict):
        processes = [processes]
    for process in processes:
        if process["ProcessId"] in (os.getpid(), os.getppid()):
            continue
        text = process.get("CommandLine") or ""
        if (any(name in text for name in ("recite.py", "validated_worker.py", "shadow_worker.py",
                                          "held_controls.py", "shadow_benchmark.py"))
                or ("benchmark.py" in text and " run " in text)):
            raise RuntimeError(f"Another actual GPU worker/control exists: {process['ProcessId']}")


def tracked_version(tensor):
    try:
        return tensor._version
    except RuntimeError:
        # Inference-mode tensors cannot prove absence of in-place mutation.
        return None


def shadow_hooks(counters):
    pending = {}

    def onload(module, args, kwargs):
        layer = _cache_layer(module, kwargs)
        cache = kwargs.get("past_key_values")
        shadow = None
        if (kwargs.get("key_value_states") is not None and layer is not None
                and layer.is_initialized and cache.is_updated.get(module.layer_idx)):
            host = (layer.keys, layer.values)
            versions = tuple(tracked_version(tensor) for tensor in host)
            if all(t.device.type == "cpu" for t in host) and None not in versions:
                shadow = (host, versions)
        _onload_cache(module, args, kwargs)
        if shadow is not None:
            loaded = (layer.keys, layer.values)
            versions = tuple(tracked_version(tensor) for tensor in loaded)
            if None not in versions:
                pending[module] = (layer, shadow, loaded, versions)

    def offload(module, args, kwargs, output):
        saved = pending.pop(module, None)
        if saved is not None:
            layer, (host, host_versions), loaded, loaded_versions = saved
            current = (layer.keys, layer.values)
            if (layer is _cache_layer(module, kwargs)
                    and all(a is b for a, b in zip(current, loaded))
                    and tuple(tracked_version(t) for t in current) == loaded_versions
                    and tuple(tracked_version(t) for t in host) == host_versions):
                layer.keys, layer.values = host
                counters["reusedCrossPairs"] += 1
                counters["avoidedReturnBytes"] += sum(t.numel() * t.element_size() for t in current)
                return
        counters["baselineOffloads"] += 1
        _offload_cache(module, args, kwargs, output)

    return onload, offload


def new_counters():
    return {"reusedCrossPairs": 0, "baselineOffloads": 0, "avoidedReturnBytes": 0}


@contextmanager
def shadow_memory(model, parent_profile=PARENT_PROFILE, counters=None):
    if parent_profile != PARENT_PROFILE:
        # In particular, preserve the original baseline on OOM recovery.
        with whisper_experiment.experimental_memory(model, parent_profile):
            yield
        return
    counters = new_counters() if counters is None else counters
    onload, offload = shadow_hooks(counters)
    with patch.object(whisper_experiment, "_onload_cache", onload), \
            patch.object(whisper_experiment, "_offload_cache", offload):
        with whisper_experiment.experimental_memory(model, parent_profile):
            yield


def source_hashes():
    import benchmark
    import transformers.cache_utils
    import transformers.models.whisper.modeling_whisper
    import transformers.pipelines.base

    here = Path(__file__).resolve().parent
    names = (*benchmark.BASELINE_FILES, "benchmark.py", "whisper_experiment.py", "validated_worker.py",
             "held_controls.py", "test_validated_worker.py", "benchmarks/golden-2026-10-07.json.gz",
             "benchmarks/held-2026-10-07.json.gz", "benchmarks/resume-sample-2026-10-07.json",
             "cross_cache_shadow.py", "shadow_benchmark.py", "shadow_worker.py", "test_cross_cache_shadow.py")
    paths = {name: here / name for name in names}
    paths.update({module.__name__: Path(module.__file__) for module in
                 (transformers.cache_utils, transformers.models.whisper.modeling_whisper, transformers.pipelines.base)})
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}
