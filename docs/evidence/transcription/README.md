# Transcription validation - 2026-11-11

These are real browser captures of the input and exported output for the same
36.8849-second Esther 10 recording. `before.jpg` shows the original recording
in a minimal local browser media harness. `after.jpg` shows the unmodified
`preview.html` produced by the ordinary CLI with the full pinned Hebrew model
and its default CUDA FP32 settings. The recording's SHA-256 is
`05b1c171298dca95d3f7a69d8c82fd0f815f53c4f6194c04854e20505a73894a`.

![Original recording in the local media harness](before.jpg)

![Actual full-model HTML preview](after.jpg)

The export remains marked for editorial review. The capture establishes the
rendering and pipeline behavior; it does not establish perfect transcription.
The HTML is recognized speech, with only the documented typography and paragraph
formatting applied. The raw transcript and model timestamps remain in JSON.

## Hardware and runtime

Windows, NVIDIA RTX 4070 Laptop GPU (8188 MiB), driver 566.07, Python 3.12.
The final validation uses the exact task-local runtime pins:
faster-whisper 1.2.1, CTranslate2 4.9.0, PyAV 19.0.2, NumPy 2.5.4,
Hugging Face Hub 2.4.0, boto3 1.44.0, Windows cuBLAS 12.9.2.10,
cuDNN 9.28.1.4 and NVRTC 12.9.86. `pip check` passed.

The model is `ivrit-ai/whisper-large-v3-ct2` at
`e9ed4a4a98d761b0f617d668303de2c514236c66`. Its downloaded model file was
verified against the published SHA-256
`765965efd777190f76e8b337520056f00d68e48bb99b2f95d28670b2364a02ce`.
All final runs used cached weights with `--offline`, the full model, beam 5,
native long-form decoding, previous-text context, standard temperature fallback,
and no VAD trimming or precision/model fallback.

| Input | Default precision | Elapsed | Measured peak GPU usage |
| --- | --- | --- | --- |
| 36.8849-second original MP3 | FP32 | 28.140 s | 7113 MiB |
| 65-second WAV | FP32 | 33.141 s | 7465 MiB |
| 65-second MP4 with AAC audio | FP32 | 30.859 s | 7433 MiB |

Each run exited 0 and exported all three artifacts. The MP3 run used a Hebrew
output directory with the default Windows pipe encoding, verifying the UTF-8
console repair without environment overrides. GPU usage was sampled with
`nvidia-smi` during otherwise idle-device validation. Elapsed times include
local model loading and export, exclude the initial model download, and are
functional smoke measurements rather than performance gates.

An earlier explicit FP16/FP32 comparison on the same short recording produced
byte-identical `article.html`. No word-error-rate improvement is claimed from
changing precision. FP32 prioritizes arithmetic precision and requires most of
this 8 GiB GPU to be free. Different recordings can require more memory.

## Automated checks

All 83 tests pass with the real S3 SDK and media integrations enabled, with
99% branch-aware coverage and every production source line covered. Tests
generate their own WAV/video/multi-track/corrupt-media fixtures. Real boto3
transport is constrained to a loopback-only server; no production AWS identity,
endpoint, bucket or archive file is used. Existing CI routing tests also pass
(190 cases), including local-tool deployment isolation.

See [the pipeline guide](../../../devops/transcription/README.md) for commands,
the archive access constraint, artifact schema and future draft handoff.
