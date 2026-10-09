# Read-only cross-attention cache transfers

The selected Whisper profile keeps self-attention caches on the GPU and moves
cross-attention caches to RAM. After the first token, Whisper reads the existing
cross-attention keys and values without updating them. Returning those same
values from the GPU after each token duplicates the copy already held in RAM.

`cross_cache_shadow.py` preserves that RAM copy during attention and restores it
afterwards only when both GPU and RAM tensor identities and mutation versions
prove it is unchanged. First-token initialization, replacement, mutation and
untracked inference-mode tensors retain the original copy behavior. Beam-cache
reordering remains upstream and operates on the restored RAM tensors.

All attention calculations, FP32 weights, five beams, whole-track inference,
timestamp heads, Hebrew CTC and canonical-word acceptance gates stay unchanged.
The original eight fallback files and the sixteen delivered selected-profile
source and fixture files are not edited. The original worker remains available.

The owner explicitly authorized a one-golden-chapter sanity comparison on
2026-10-09. `shadow_benchmark.py` performs fresh current/candidate inference on
Isaiah 4 (338, 89 words), compares every ASR and canonical boundary against the
stored golden and contemporaneous current result, and retains acoustic scores.
There must be exact contemporaneous ASR, at most 5 ms boundary drift and 0.001
score drift, unchanged acceptance gates, observed cache reuse and a measured
inference-time improvement. This is a one-chapter qualification, not a claim
that the full 51-chapter reference collection was replayed.

`shadow_worker.py` recomputes these comparisons, checks hashes of the new source
and installed cache/Whisper implementation, and requires the existing selected
profile's 17-chapter qualification, fresh controls and identical runtime before
starting. Its provenance identifies the additional cache-transfer profile and
records actual reuse counters. A changed proof or runtime rejects activation.
The selected worker's original FP32 OOM fallback remains unchanged.

GPU controls run exclusively after the active collection chapter's manifest is
saved. `checkpoint_handoff.py` observes the flushed completion message instead
of opening live SQLite files, which can block atomic replacement on Windows.
After the bound worker exits, rebuild and verify its existing checkpoint from
saved manifests, preserving unpublished candidates outside the approved table.
If any sanity or performance check fails, resume the
existing selected profile on that same checkpoint. Do not replace the reference
fixtures, reuse stale benchmark files, reduce inference quality or publish held
word intervals. Timing batch pushes remain postponed until after Shabbat.
