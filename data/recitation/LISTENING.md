# Verse listening queue

Use listening_review.py for a small local interface to the held verses.
It runs on loopback and does not load models, use the GPU, modify worker
artifacts, or publish timings.

Prepare from an **offline saved** alignment snapshot and source-bound acoustic
diagnostic studies, not the live worker checkpoint:

~~~sh
python listening_review.py prepare --canonical /path/to/canonical.json --snapshot /path/to/saved-snapshot --diagnostics /path/to/diagnostic-studies --held-summary /path/to/trusted-summary.json --recordings /path/to/original-mp3s --output .outputs/listening-review
python listening_review.py serve --queue .outputs/listening-review/queue.json --reviews .outputs/listening-review/reviews.json --port 8766
~~~

Open http://127.0.0.1:8766/. Play "חיתוכי המילים" to hear every proposed
word cut separately. Verse playback is optional. Clicking a word replays just that
cut. "עם הקשר" plays the diagnostic's original surrounding context.
Choose good, problem, or skip; an optional note helps locate a bad cut.
Good is enabled after every individual cut has finished. Separate verse playback is optional.
Interrupted playback never counts as a completed listen. Decisions save
automatically and resume when the page is reopened. Export downloads a backup.

The queue includes only complete canonical verses with original source/text
hashes, unchanged candidate intervals, valid ordering and durations, and
diagnostic contexts bounded to 45 seconds. Short problem lists and short verses
come first. Cases without usable diagnostic candidates need further preparation;
this is not a claim that every held verse already has a reviewable cut.

Review clips are uncompressed PCM decoded from the original MP3, on the same
16 kHz time axis used by the analysis pipeline. Decode the full stream before
sample slicing: some original MP3s change sample rate midstream and reset
FFmpeg filter counters. The browser verifies the clip hash and uses decoded
Web Audio buffers instead of approximate MP3 seeking. Original files remain
unchanged. Decoder diagnostics are retained in the queue.

Feedback is bound to one verse, the source audio, canonical text, and exact
candidate hash. The durable JSON retains decision history and only the word
identities whose playback completed. Browser-reported listening is not a claim
of independent human verification by the server. A saved good answer remains
held; it cannot mark an unheard chapter manually reviewed or bypass the
original automatic acceptance gates. Recovery must separately validate the
source, complete chapter intervals, adjacent boundaries and truthful manual
scope before an explicit publication step. Do not feed this feedback JSON to
the older whole-chapter review.py importer.

Keep the queue, clips and feedback outside disposable worktrees if they must
survive cleanup. The serve command's --check-only flag verifies the queue,
diagnostics, original audio and canonical bindings without starting a server.
The server only serves known clip IDs and requires its own origin and session
token for feedback writes.

