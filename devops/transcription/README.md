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
model at commit `e9ed4a4a98d761b0f617d668303de2c514236c66`, CUDA FP16, beam size 5.
The model download requires several GB of disk space and inference requires
sufficient free VRAM. CUDA availability and compute support are checked before
downloading model weights. There is no automatic CPU or smaller-model fallback.
Quality takes priority over throughput: the pipeline uses native sequential
long-form decoding with context between windows, standard temperature fallback
for uncertain/repetitive decoding, and no VAD removal of quiet sections.
FP16 is the explicit non-quantized default; `--compute-type float32` requires
substantially more free GPU memory. A larger precision value is not a guarantee
of better recognition. No processing-time deadline reduces the model or audio.

From the repository root in PowerShell:

```powershell
py -3.12 -m venv devops/transcription/.venv
devops/transcription/.venv/Scripts/python.exe -m pip install -r devops/transcription/requirements.txt
devops/transcription/.venv/Scripts/python.exe -m devops.transcription --help

devops/transcription/.venv/Scripts/python.exe -m devops.transcription `
  "C:/recordings/lecture.mp4" --title 'כותרת השיעור' --output-dir .outputs/transcription
```

On Linux, use `python3.12 -m venv devops/transcription/.venv` and
`devops/transcription/.venv/bin/python` in place of the Windows interpreter path.
See the backend's [GPU library installation instructions](https://github.com/SYSTRAN/faster-whisper#gpu).
On Windows, CUDA/cuDNN DLL directories must be available to the process before
starting Python. The CUDA version reported by `nvidia-smi` describes driver
support; it does not establish that those libraries are installed.

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
Display text normalizes authored Hebrew quotes/apostrophes/hyphens to ASCII and
collapses whitespace. Raw recognized text remains unchanged in `transcript.json`.
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
Exports contain private source names and speech; keep them in local ignored
`.outputs/` storage and apply the recording's access restrictions when sharing.

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
