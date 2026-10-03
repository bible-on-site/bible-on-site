# Recitation alignment

The perakim JSON is the text authority. Whisper supplies acoustic landmarks; it
never replaces, inserts, deletes, or merges the canonical words in the output.
The identity of a spoken word is the existing **1-based perek ID, pasuk, segment**.
Only `qri` segments are spoken. A `ktiv` variant points to its existing qri;
paragraph markers are not words.

## Models and matching

1. Decode each original MP3 to mono 16 kHz samples for analysis. Playback retains
   the original MP3, without another lossy encoding.
2. Transcribe with the full
   [ivrit-ai/whisper-large-v3](https://huggingface.co/ivrit-ai/whisper-large-v3)
   in FP32, Hebrew, beam search 5, native long-form decoding and word timestamps.
   The default does not use a distilled/turbo model, quantization, or skip audio.
3. Globally reconcile ASR tokens with canonical words using character edit
   similarity and dynamic programming. Unlike two greedy pointers, this can
   recover after ASR insertions, omissions, repeated words, and token splits.
   Internal 1:2/2:1 ASR matches never merge canonical output rows.
4. Force-align the **known canonical transcript** within each verse window using
   [imvladikon/wav2vec2-xls-r-300m-hebrew](https://huggingface.co/imvladikon/wav2vec2-xls-r-300m-hebrew).
   This is also the Hebrew model selected by
   [WhisperX](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py).
   CTC Viterbi decoding requires every transcript character, including a blank
   between repeated characters. Niqqud is removed only from the matching view;
   written display text stays intact. Written divine names get their spoken
   forms only in that matching view.
5. Validate completeness, identity, ordering, durations, text/audio hashes, and
   acoustic evidence. Flag questionable verses and preserve all their candidate
   rows for review. **A ready chapter must contain exactly one valid interval for
   every canonical spoken word.** Partial chapters cannot enable verse/word playback.

An embedding/semantic similarity model is inappropriate here: two different
words can mean similar things. Acoustic forced alignment and character-level
sequence matching answer the relevant question. The
[WhisperX paper](https://arxiv.org/abs/2303.00747) describes the ASR/alignment
separation; newer [FALCON results](https://mlspeech.github.io/FALCON/) also show
that even dedicated Hebrew aligners do not guarantee perfect boundaries.

Acoustic scores are uncalibrated CTC likelihoods, **not probabilities that a cut
is correct**. The Esther 10 pilot received chapter-level listening approval after
correcting browser seeking. The owner subsequently approved the same pinned
process for incremental publication of the collection. This does not imply that
each automatically accepted chapter has been listened to.

## Install and run

Python 3.12+, FFmpeg/ffprobe on PATH, and a compatible PyTorch CUDA build are
required. On the tested RTX 4070 Laptop (8 GB), CUDA 12.6 works with driver 566.07.
The full FP32 model stays on the GPU. `whisper_memory.py` bounds inference memory
without quantization, fewer beams, shorter audio, or lower alignment thresholds:

- Word timestamps use decoder cross-attention; retaining the unused encoder
  attention maps alone costs 5.36 GiB for large-v3. The encoder still runs every
  layer and attention computation, but those diagnostic maps are not retained.
- Saved decoder attention and each layer's FP32 key/value cache live in system
  RAM between uses. Word timestamp extraction uses the unchanged Transformers
  DTW implementation on CPU and returns its result to the original device.
- Explicit hooks cover cached cross-attention reads. Transformers 5.18's generic
  offloaded cache does not prefetch those direct Whisper reads after token one.
- Hooks and temporary method overrides are removed on success and failure.
  A memory exhaustion stops the batch and immediately records `failures.json`;
  it cannot trigger hundreds of subsequent retries in an exhausted CUDA process.

Transfers may take longer; processing time is not an acceptance criterion.
Native Whisper progress reports show audio already processed. CPU and CUDA
regression tests compare tokens and word timestamps with ordinary full-precision
inference, using a small random Whisper without downloading weights. Set
`RECITATION_TEST_CUDA=1` to include CUDA validation locally. CI uses CPU Torch.

From this directory in PowerShell:

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
.venv/Scripts/python.exe -m pip install -r requirements.txt
$env:HF_HOME = "$PWD/.cache/huggingface"
$env:PYTHONIOENCODING = "utf-8"
.venv/Scripts/python.exe -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name())"

# Catalog playback and all word identities, without inventing timings.
.venv/Scripts/python.exe recite.py --recordings C:/Users/Dorad/git/tanah-s3/recordings --prepare-only

# Small pilot: Esther 10, three pesukim and 46 spoken words.
.venv/Scripts/python.exe recite.py --recordings C:/Users/Dorad/git/tanah-s3/recordings --perek 829

# Full collection, after validating pilot quality.
.venv/Scripts/python.exe recite.py --recordings C:/Users/Dorad/git/tanah-s3/recordings
```

Use `--device cpu` when no compatible GPU is available; there is no silent
precision/model downgrade. `--force` reruns alignment while retaining an ASR cache
whose model, exact revision, and audio hash match. Model snapshots are pinned in
`model_versions.py`; custom models require an explicit `--asr-revision` or
`--align-revision` commit. A model update preserves human-approved alignments
unless `--force` is supplied. A changed recording or canonical text
invalidates the relevant output. A processing exception never overwrites a prior
artifact. Inspect `.outputs/failures.json` and `*.review.json`. `--shortest-first` prioritizes
short listening samples while processing every track with identical settings.
`--database PATH` checkpoints to a separate intermediate DB for a background run;
`--text PATH` can select a working copy of the canonical JSON.

Overlapping verse windows are re-aligned together as one CTC sequence within
the existing 45-second acoustic limit. The shared acoustic path determines the
transition. Unresolved overlaps remain in review and cannot be published.

### Incremental publication after process approval

`trusted.py` is an explicit publication step for the approved version 3 process.
It verifies the original MP3 hash and duration, current canonical word identities,
exact model snapshots and thresholds, matching diagnostic and ASR cache artifacts,
ASR coverage and both boundary anchors in every verse, and complete, ordered,
nonoverlapping intervals. Durations outside 40-3000 ms, missing scores, unknown
warnings, or unresolved failures hold the entire chapter. Only low, uncalibrated
acoustic-score warnings may pass; their scores and diagnostic rows are preserved.
No timestamp is padded, clamped, inferred, or changed during acceptance.

Accepted chapters have `reviewMethod: "trusted-process"` and versioned acceptance
diagnostics. They never acquire a false word-level `reviewed` flag. Previously
published chapters are preserved. Only artifacts validated in the current run
are overlaid into the durable SQLite DB; leftover staging files cannot publish
another chapter. Run this while the independent GPU batch continues:

```powershell
.venv/Scripts/python.exe trusted.py --recordings C:/Users/Dorad/git/tanah-s3/recordings
.venv/Scripts/python.exe publish.py
.venv/Scripts/python.exe audit.py
```

Commit the intermediate DB and canonical JSON together, bump the website version,
and deliver through CI/CD, which verifies every ready chapter against the running
deployment. A pending or held chapter retains full-chapter playback only.

On Windows, the batch requests system wakefulness for its lifetime and releases
that request on completion or error. It does not alter global power settings or
keep the display on. For a worker started before this support was added,
`awake.py --pid PROCESS_ID` holds the same request until that exact process exits.

## Review

```powershell
.venv/Scripts/python.exe review.py --perek 829 --output .outputs/review-829.html
.venv/Scripts/python.exe -m http.server 8765 --bind 127.0.0.1 --directory .outputs
```

Open `http://127.0.0.1:8765/review-829.html`. Play a verse, individual words, and
words with surrounding context. Correct millisecond boundaries and mark each
word reviewed. Export the reviewed JSON, then import it:

```powershell
.venv/Scripts/python.exe review.py --perek 829 --corrections PATH/829.reviewed.json --recordings C:/Users/Dorad/git/tanah-s3/recordings
```

Import rechecks the real MP3 hash, canonical text hash, every word identity,
complete coverage, and nonoverlapping in-range timestamps. It cannot approve a
partial word list or a review of different audio/text.

## Pipeline boundary and storage

`data/recitation/recitation.sqlite` is the versioned intermediate database owned
by the recitation pipeline. It stores one track record per recording and only
approved word intervals keyed by `(perek_id, pasuk, segment)`. It does not copy
Hebrew words. The canonical text SHA-256 includes word identities and vocalized
text; the audio SHA-256 identifies the exact original MP3. SQLite schema version
3 separates processing candidates from approved playback data.

The Sefaria CLI automatically reads that database **after aggregation and before
writing any output**. It adds `recitation` metadata to each recorded perek and
fills the existing qri `recordingTimeFrame.from/to` fields with
`HH:MM:SS.mmm` strings. A missing intermediate DB, changed canonical text, missing
word, overlap, or out-of-range interval aborts the export before overwriting the
previous output. `--recitation-db PATH` selects another intermediate database.
Re-running Sefaria therefore cannot silently erase the approved timings.

The recitation pipeline keeps resumable ASR results and candidate alignments in
ignored `.outputs/` files. It atomically checkpoints the intermediate DB before
starting inference and after each completed track, preserving tracks outside a partial run and existing approved timings
when a rerun is unapproved. Review imports update the same intermediate DB.
Candidates never become published word timings. Fresh checkouts can generate a
review page directly from the merged perakim DB.

The website reads `recitation` and `recordingTimeFrame` directly from its existing
perakim JSON. `GET /api/recitation/{perekId}` validates the canonical text hash and
complete word coverage, then resolves S3/RustFS playback URLs. There are no public
recitation sidecar files or copied word databases.

To merge the latest intermediate data into an existing perakim JSON without
rerunning MongoDB aggregation:

```powershell
.venv/Scripts/python.exe publish.py
```

Website CI and release packaging automatically merge and audit this database
before consuming the canonical JSON. Changes to the intermediate SQLite file
trigger website CI, version validation, packaging, and release. A repeated merge
preserves the same approved intervals; the GPU/models are never needed in CD.
Packaging boots the actual Docker image and compares all approved API word rows
and an unapproved chapter against the database. Recitation mode requests fresh
metadata when opened, so approved timings do not remain cached as chapter-only.
CD checks out the immutable
release commit, waits for its website version, then verifies those rows and each
approved MP3's public CORS download, MIME type, and SHA-256. Missing/stale timings
or unavailable/different audio fail deployment verification rather than reporting
success after only an ECR push.

The Rust Sefaria merge and this Python merge share the same schema and hash
contract. Regression tests recreate unaligned Sefaria output, restore the
approved timing data, verify repeatability, and reject changed canonical text.

The sefer reader places a small recitation-mode icon at the left of its second
header row. Enabling it lazily loads the chapter manifest and downloads, verifies,
and decodes the original MP3. A circular indicator follows received bytes; the
mode becomes active automatically after preparation finishes. Clicking an existing
pasuk letter or spoken qri word plays that interval. Entity links and ordinary
reading return when the mode is disabled. The adjacent play/pause icon and perek
heading control playback; pause retains the audio-clock position for resume.
Basic view has no playback controls. Chapter playback streams the original
MP3; pasuk and word playback reuse the prepared chapter, verified by SHA-256
against the alignment source, and schedule exact offsets and durations with
`AudioBufferSourceNode.start`. No timestamp padding or stop timer is used.
Only the active player's decoded chapter is retained. Disabling recitation mode, changing
chapter/player, hiding the document, or unmounting cancels playback and releases
its audio context. Rapid clicks cannot revive an older download/play request.

S3 uses `recordings/{perekId}_record.mp3`, `Content-Type: audio/mpeg`.
HTTP Range requests support streamed chapter playback. Decoding requires a full
MP3 download and read-only CORS; `recordings-cors.json` contains the public-read
configuration used on the existing public assets bucket. Preserve unrelated
rules if applying it to a bucket with existing CORS. RustFS uses the same public
GET/HEAD permissions alongside its existing local upload rule.
No pre-cut audio files are required. Only 496 of the 929 chapters currently have
source recordings; unavailable chapters show an availability message.

### Timing investigation

On the Esther 10 pilot, six original MP3 seeks delivered audio 67–81 ms later
than requested. A seek-index remux still started 55–69 ms late. Capturing browser
output and cross-correlating it with fully decoded audio isolated the player:
WAV seeks were exact, FLAC was within 0.313 ms, and decoded original MP3 playback
was exact for all six clips (correlation 1). The timestamps were unchanged.
The user then reported near-perfect framing in the accurate-seek review.
FLAC was useful as a control; production uses the verified decoded-MP3 path.
See [Web Audio scheduling](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start).

### Structured data

Recorded chapter pages include a linked Schema.org `AudioObject` with the original
public MP3 `contentUrl`, `audio/mpeg`, ISO 8601 duration, Hebrew language, SHA-256,
and a relation to the existing Chapter node. Its page URL opens sefer view.
Unavailable recordings are omitted. Playback candidates never become false
word-level claims in structured data. No narrator or recording date is invented.
This describes existing content; it does not promise rich results or rankings.
Google's [AI features guidance](https://developers.google.com/search/docs/appearance/ai-features)
states that no special AI schema is required.

## RustFS and checks

Start and initialize the repository's [RustFS mock](../../devops/rustfs/README.md).
Use `S3_ENDPOINT=http://localhost:4566` and the existing development/test bucket.
The API selects RustFS automatically from those settings.

From the repository root:

```powershell
node data/recitation/check_storage.mjs
node data/recitation/check_storage.mjs C:/Users/Dorad/git/tanah-s3/recordings/1_record.mp3
node --test data/sefaria/pipelines/tanah-view/tests/preprocessor.test.mjs
```

The storage test creates a uniquely named temporary bucket **only on loopback
RustFS**, verifies MP3 headers and exact HTTP 206 bytes at two offsets, then
removes its own objects and bucket. Its default MP3 fixture is a synthetic
two-second 440 Hz tone, generated with FFmpeg.

From this directory:

```powershell
.venv/Scripts/python.exe -m unittest -v
.venv/Scripts/python.exe audit.py
```

CI runs those invariants and numerical Whisper memory tests, audits the
intermediate DB against canonical JSON, and tests byte-range delivery through
real RustFS without downloading pretrained model weights.
Website tests cover invalid/stale/partial maps, storage URL selection, exact
selected intervals, playback cleanup, errors, and unpublished candidates.

Two canonical JSON defects found during the audit were repaired at the same
segment IDs: the final words of Eikhah 5:22 and Kohelet 12:14 had absorbed editorial
repetition notes and lost their first letter. The source aggregation now removes
those notes before qri-bracket parsing; regression tests preserve genuine qri.
