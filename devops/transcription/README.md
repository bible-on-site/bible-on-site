# Local GPU transcription

Transcribe one audio/video file into an article candidate on a local NVIDIA GPU.
The input is a local file or an exact `s3://bucket/key` object in the private
archive being introduced by [#3277](https://github.com/bible-on-site/bible-on-site/pull/3277).
Each invocation exports to a new directory; it does not create or publish an article.

## Setup

Use Python 3.12 and an NVIDIA CUDA 12 installation with cuBLAS and cuDNN 9.
The backend uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper#requirements)
and PyAV, which bundles media decoding libraries. A separate FFmpeg installation
is not required. The default is the full Hebrew
[ivrit-ai/whisper-large-v3-ct2](https://huggingface.co/ivrit-ai/whisper-large-v3-ct2)
model at commit `e9ed4a4a98d761b0f617d668303de2c514236c66`, CUDA FP32, beam size 5.
The model download requires several GB of disk space and inference requires
sufficient free VRAM. CUDA availability and compute support are checked before
downloading model weights. There is no automatic CPU or smaller-model fallback.
Quality takes priority over throughput: the pipeline uses native sequential
long-form decoding with context between windows, standard temperature fallback
for uncertain/repetitive decoding, and no VAD removal of quiet sections.
FP32 is the default numerical precision. A 65-second pilot used about 7.3 GiB,
but the representative 24-minute lecture exceeded an idle 8 GiB RTX 4070 Laptop's
dedicated memory and paged into shared memory. A short successful test does not
establish sufficient VRAM for a whole lecture.

For that 8 GiB GPU, use the explicit `--compute-type float16` profile shown below.
It retains the full pinned model, beam size 5, temperature fallback, previous-text
context and all input audio. The complete lecture exported successfully with
about 5 GiB of sampled dedicated memory. FP32 remains available for a GPU with
sufficient memory; precision is never selected or downgraded automatically.
The two precisions can produce different words. No reference transcript or
word-error-rate comparison establishes an accuracy advantage for either one.
No processing-time deadline reduces the model or audio.

From the repository root in PowerShell:

```powershell
py -3.12 -m venv devops/transcription/.venv
devops/transcription/.venv/Scripts/python.exe -m pip install -r devops/transcription/requirements.txt
devops/transcription/.venv/Scripts/python.exe -m devops.transcription --help

devops/transcription/.venv/Scripts/python.exe -m devops.transcription `
  "C:/recordings/lecture.mp4" --compute-type float16 `
  --title 'כותרת השיעור' --output-dir .outputs/transcription
```

On Linux, use `python3.12 -m venv devops/transcription/.venv` and
`devops/transcription/.venv/bin/python` in place of the Windows interpreter path.
See the backend's [GPU library installation instructions](https://github.com/SYSTRAN/faster-whisper#gpu).
On Windows, CUDA/cuDNN DLL directories must be available to the process before
starting Python. The CUDA version reported by `nvidia-smi` describes driver
support; it does not establish that those libraries are installed.
The Windows CTranslate2 wheel preloads its bundled cuDNN dispatcher, so installed
NVIDIA package versions and the DLL versions observed at runtime can differ.

The optional pinned NVIDIA wheels provide the runtime without installing PyTorch:

```powershell
devops/transcription/.venv/Scripts/python.exe -m pip install -r devops/transcription/requirements-cuda.txt
$transcriptionNvidia = "$PWD/devops/transcription/.venv/Lib/site-packages/nvidia"
$env:PATH = "$transcriptionNvidia/cublas/bin;$transcriptionNvidia/cudnn/bin;$transcriptionNvidia/cuda_nvrtc/bin;$env:PATH"
```

On Linux, set `LD_LIBRARY_PATH` to the installed wheels' corresponding
`nvidia/cublas/lib`, `nvidia/cudnn/lib` and `nvidia/cuda_nvrtc/lib` directories
before starting the command, as described in the backend's GPU instructions.

Inference executes locally. The first run downloads the pinned public model
from Hugging Face; audio is never uploaded for inference. Use `--model-cache PATH`
to choose a model cache and `--offline` to require an already cached snapshot.
This flag controls model downloads only; S3 input still requires an S3 connection.
An entirely offline run uses a local input and a cached model.

Arrange an exclusive GPU window for full-precision validation. Concurrent model
allocations can force Windows to use shared GPU memory and slow a run without
an out-of-memory exception. Check all compute processes throughout the test;
a measurement that overlaps another GPU workload does not establish this
pipeline's standalone capacity or processing time.

## Private archive input

```powershell
devops/transcription/.venv/Scripts/python.exe -m devops.transcription `
  's3://YOUR-ARCHIVE-BUCKET/authors/שם המחבר/שיעורים/שיעור.mp3' `
  --aws-profile YOUR-AUTHORIZED-READ-PROFILE --output-dir .outputs/transcription
```

Pass the literal S3 key, including Hebrew, spaces and literal percent characters;
do not URL-encode it. Everything after `s3://bucket/` is the exact object key:
`?` and `#` are filename characters, without URL query/fragment semantics.
A directory/prefix, ZIP bundle or HTTP URL is not an input.
The tool reads one exact object and never lists, uploads, deletes
or changes an S3 object or its permissions. `--aws-profile` selects an existing
profile; without it, boto3 uses its standard credential chain. Credentials never
appear in the exported metadata.

**The current #3277 bucket policy permits only the admin ECS task role.** An
administrator's SSO credentials alone cannot read it, and choosing a profile
does not grant access. Use an explicitly approved read identity if one exists,
or download the recording through the admin archive and supply its local path.
This feature does not deploy a worker, assume the ECS role or broaden that policy.
Any future worker access requires its own reviewed AWS change.

Both local and S3 inputs are copied to a private temporary snapshot and hashed
with SHA-256 before recognition. S3 downloads stream with bounded buffers and
verify the returned content length. Local inference can require substantial RAM
for decoding a long recording; the download buffer limit is not an inference RAM
limit. Ensure sufficient temporary disk space for the whole input.

## Outputs and admin handoff

The command prints the completed directory and exits with status 0 only after
all three artifacts exist:

| Artifact | Purpose |
| --- | --- |
| `article.html` | UTF-8 HTML fragment of escaped paragraphs for the admin editor |
| `preview.html` | Standalone local review page, with Hebrew RTL and an editorial-review notice |
| `transcript.json` | Versioned provenance, raw segments/timestamps, model/decoding settings and article content hash |

Open `preview.html` to read the result. In admin, create an article, set its title
and editorial metadata, switch the content editor to HTML source mode, and paste
the **contents** of `article.html`. There is no file-upload endpoint in this
feature. Author, chapter/source references, rights and publication decisions
remain editorial choices; they are not inferred from an archive folder name.

Audio and video containers are decoded through PyAV. A video must contain an
audio track. A file with several audio tracks requires an explicit zero-based
`--audio-stream INDEX`; the selected track and original media properties are
recorded in the provenance. Other tracks are not mixed into the transcript.
Decoding errors stop the run instead of silently discarding corrupt frames.

The result is a transcription, without summarization or rewriting. It requires
human listening and editing, particularly for names, source references and quiet
audio. No ASR confidence is presented as an approval. The recognizer still uses
its ordinary no-speech and repetition safeguards. Model segment timestamps are
retained as ASR estimates, not
verified word alignment. Speech missed by the recognizer cannot be guaranteed
absent by these checks.

Paragraphs break on a 1.5-second pause or at segment boundaries when another
segment would exceed 900 characters. Adjust `--paragraph-pause` and
`--max-paragraph-characters` as needed; a single long segment is kept intact.
Display text normalizes authored Hebrew quotes/apostrophes/hyphens to ASCII,
collapses whitespace and removes Unicode `Bidi_Control` characters emitted by
the model. The preview's `dir` attribute supplies direction. Hebrew letters,
diacritics and joiners are preserved. `formatting.bidi_controls_removed` records
the body control count; raw recognized text remains unchanged in
`transcript.json`.
The default language is Hebrew; `--language en` or `--language auto` is explicit.
The title defaults to the source filename without its extension.

All artifacts are staged on the output filesystem and delivered by one directory
rename. A failed/interrupted run removes its private input and staging files;
completed prior runs remain intact. A process killed without cleanup may leave
temporary files. Each successful rerun has a distinct directory, so repeated
runs do not silently overwrite an edited export. An empty recognition, invalid
timestamps (nonfinite, negative or unordered starts), changed snapshot or write
error fails without publishing an export. Overlapping estimates or estimates
beyond the decoded duration are preserved and flagged in the manifest's
`transcription.warnings`; they do not discard otherwise usable recognized text.
These comparisons ignore floating-point roundoff within one microsecond, while
preserving the original timestamp values. Real overlaps and overruns remain
review warnings.
Exports contain private source names and speech; keep them in local ignored
`.outputs/` storage and apply the recording's access restrictions when sharing.

## Reproducible decoding and output comparison

The initial native random seed defaults to `0` and is recorded in model
provenance. Choose another with `--random-seed NUMBER` (0 through 4294967294).
It is set before creating CUDA/model workers: CTranslate2 caches random
generators per native thread. Resetting the global seed after workers have
already sampled does not reset those generators. Separate fresh CLI processes
reproduced the same fallback excerpt byte for byte on the tested runtime.
Repeated calls on an already-loaded library instance consume its RNG state;
the seed does not promise equality across hardware, runtimes or compute types.
It also does not establish recognition accuracy.

`--decoding-mode fallback` remains the default: beam search followed by the
standard temperature fallback when its heuristics reject a candidate.
`--decoding-mode beam` explicitly restricts decoding to temperature zero with
the selected `--beam-size`. Beam-only repeats were stable in the controlled
test, while increasing the beam changed words without establishing an accuracy
improvement. The full pinned Hebrew model, beam 5, previous-text context and
complete audio remain the defaults; no faster model or automatic precision
change was introduced. See the [RCA and measured limits](../../docs/evidence/transcription/README.md#text-disagreement-root-cause).

From `devops/`, compare two complete exports without GPU dependencies:

```powershell
bun run transcription:compare ../output/opus/transcript.json ../output/webm/transcript.json
```

The JSON report gives exact word/character Levenshtein edits, input lengths,
the edit fraction relative to the left input, a symmetric distance divided by
the longer input, and counts of bidi controls. Empty-left fractions are `null`;
two empty inputs have symmetric distance zero. Comparison ignores timestamps,
segment boundaries, punctuation/symbols, bidi controls and whitespace differences,
then applies NFKC/lowercase normalization. All Hebrew letters, including vav and
yod, diacritics and joiners remain significant. Neither output is treated as a
human reference: these are disagreement measurements, not WER or accuracy.

## Incremental diagnostic checkpoints

The checkpoint entry point runs the same CLI and flushes each ready native
segment to a private JSONL file:

```powershell
$env:TRANSCRIPTION_SEGMENT_CHECKPOINT = "$PWD/.outputs/lecture.checkpoint.jsonl"
devops/transcription/.venv/Scripts/python.exe -m devops.transcription.checkpoint `
  "C:/recordings/lecture.webm" --output-dir .outputs/transcription
```

Use a new checkpoint filename for every run; existing files are never overwritten.
The process-local wrapper forwards the original model arguments, iterator items
and info unchanged, and restores the native method on exit. It preserves raw
segment text/timestamps and native diagnostics, including tokens, temperature,
log probability, compression ratio and no-speech score. These are uncalibrated
model diagnostics, not correctness probabilities.
In faster-whisper 1.2.1, reported fallback temperature can be the final tried
temperature even when a lower-temperature candidate is selected. It is not
proof that the saved text came from that temperature.

Events are `started`, `recognition_started`, `segment` and `finished`.
`pipeline_elapsed_seconds` starts at wrapper entry and includes setup, source
retrieval, decoding, model loading and export. `recognition_elapsed_seconds`
starts immediately before the native transcription call, excluding earlier
setup; it includes that call's feature preparation and generation. Use pipeline
time when calculating track minutes per complete runtime minute.

Only `finished` with `complete: true` and `exit_code: 0` denotes a successful
ordinary command. Exceptions, interruption, a nonzero exit or a missing terminal
event leave a partial diagnostic checkpoint. Abrupt termination can leave an
unfinished final JSONL line. Complete checkpoints link to the ordinary command
through its printed export directory and request metadata; `transcript.json`
remains the source-hash authority. Checkpoints do not implement automatic resume
and are not partial articles for admin import. The normal three-file export
remains atomic. Keep checkpoints in ignored local storage: they contain private
source names and recognized speech and are created with mode 0600 where supported.

## Pipeline design and future drafts

`sources.materialize_source` owns input retrieval and provenance.
`model.LocalTranscriber` owns pinned CUDA inference. `pipeline.build_article`
produces an `ArticleCandidate(title, content)` independently of the destination.
`pipeline.run` orchestrates those stages and returns `ExportResult(directory,
article)`. Only the filesystem export is connected today.

When article drafts exist, a separate authenticated draft sink can consume the
candidate and its versioned provenance after the same validation. That work will
need explicit author/chapter mapping, idempotency and draft permissions. The
current pipeline neither writes application content to bootstrap scripts nor
reserves speculative database fields or article status values.

For a different compatible multilingual CT2 model, specify both `--model
owner/model` and `--model-revision EXACT_40_CHARACTER_COMMIT`. Precision and
device selection are explicit through `--compute-type` and `--device-index`.
The selected device must support the requested precision; failures stop the run.

## Validation

The CPU-only contract tests mock model inference and exercise real filesystem
snapshots/exports. SDK integration tests use actual boto3 transport against an
isolated loopback server, with a guard prohibiting non-loopback connections.
Media integration tests generate real WAV, video and multi-track fixtures,
then exercise the actual PyAV decoder without an external FFmpeg executable.
They do not download weights, access production AWS or require CUDA:

```powershell
python -m unittest discover -s devops/transcription -p 'test_*.py'
python -m pip install -r devops/transcription/requirements-ci.txt
$env:TRANSCRIPTION_TEST_S3 = '1'
$env:TRANSCRIPTION_TEST_MEDIA = '1'
python -m coverage run --rcfile=devops/transcription/.coveragerc -m unittest discover -s devops/transcription -p 'test_*.py'
python -m coverage report --rcfile=devops/transcription/.coveragerc
```

Plain stdlib discovery skips the two SDK integration tests unless
`TRANSCRIPTION_TEST_S3=1` and boto3 is installed; it skips the seven media integration
tests unless `TRANSCRIPTION_TEST_MEDIA=1` and PyAV/NumPy are installed. CI runs both.
CI enforces at least 95% branch-aware coverage and contributes the LCOV report to
the repository's combined quality report. Actual GPU and actual authorized S3
smoke runs are separate checks; mocked tests do not establish recognition quality
or production archive accessibility.

### Representative lecture measurements

The owner's complete lecture contains 1462.112 seconds (24.37 minutes) of audio.
An exclusive-GPU run with the pinned full model, explicit FP16 and otherwise
unchanged decoding settings completed its three-file export:

| Input | Complete pipeline runtime | Track minutes / runtime minute | Sampled peak dedicated GPU memory |
| --- | ---: | ---: | ---: |
| Opus audio | 906.469 s (15.11 min) | 1.61 | 5167 MiB |
| WebM video with Opus audio | 750.407 s (12.51 min) | 1.95 | 5071 MiB |

These timings include local retrieval, decoding, cached model loading, recognition
and export. They exclude downloading weights. No foreign compute process was
observed. The Opus result has 423 segments, 3472 words and 29 paragraphs; its last
estimated segment ends at 1461.24 seconds. Its HTML and source hashes were retained
in the private local provenance. These are completed-run measurements, without
a processing-time projection for other recordings.

The WebM result has 481 segments, 3448 words and 29 paragraphs, with the same last
estimated segment end. Both inputs were processed completely, and their source
and article hashes were independently verified. Their decoded audio has small
sample differences, and native temperature fallback can sample different text;
the two exports are not expected to be identical.

The observed `445.50000000000006`/`445.5` boundary exposed a floating-point-only
overlap warning. Its regression also verifies a real 20 ms overlap is still
reported. Re-exporting the saved complete recognition with the corrected
validator preserves all raw segments and the article content hash; it does not
repeat inference or change the runtime measurement above.

The Opus prefix comparison found 9 identical text windows among 11 shared decoding
windows, with 14 word edits across 675 FP32 words. This measures disagreement
between outputs, not correctness or WER. The completed output has no adjacent
identical segments of at least eight words; it still needs human listening and
editing. Native diagnostics and mechanical repetition checks are not an accuracy
assessment. The lecture's content, original paths and exports remain local.

Full-length FP32 validation remains limited by the 8 GiB hardware. Two exclusive
runs emitted segments through 312 seconds before sustained shared-memory paging.
They were stopped after 886.234 seconds with the default allocator and 1103.391
seconds with an experimental allocator. Those partial snapshots represent 0.35
and 0.28 track minutes per runtime minute; neither is completed-pipeline throughput
or full-lecture quality evidence. No experimental allocator or backend change was
promoted, and the default precision is unchanged.
