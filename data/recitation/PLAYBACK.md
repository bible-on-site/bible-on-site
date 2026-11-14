# Playback compression

The alignment worker always reads the original `*_record.mp3` recordings. Its models, precision, beam search, caches, source hashes and canonical word timings do not depend on playback compression.

```mermaid
flowchart LR
    MP3[Original MP3 archive] --> GPU[Unchanged FP32 ASR + Hebrew CTC]
    GPU --> Timings[Approved canonical word timings]
    MP3 --> CPU[CPU FFmpeg / libopus\n24 kbps VBR · 48 kHz · 20 ms frames]
    CPU --> OGG[Immutable Ogg Opus copies on S3]
    OGG --> Web[Website: pinned WASM Opus decoder]
    OGG --> PAD[Android: per-book Play Asset Delivery]
    OGG --> ODR[iOS: per-book Apple ODR]
    PAD --> App[Offline native playback + exact PCM clips]
    ODR --> App
    Timings --> Web
    Timings --> App
    MP3 --> WIN[Windows MP3 packages]
```

`playback.py` converts at most two recordings concurrently, using CPU encoders with one thread each. It never trims silence, normalizes volume, changes playback speed, writes to the source directory or opens the worker checkpoint. It checks the original MP3 hash before and after conversion, and requires an identical decoded frame count at 48 kHz. Ogg pre-skip and end trimming preserve the recording time origin.

```powershell
python data/recitation/playback.py C:/Users/Dorad/git/tanah-s3/recordings
aws s3 sync .cache/recitation-opus s3://bible-on-site-assets/recordings/opus-24k/ --exclude '*' --include '*.ogg' --exclude '*.download.ogg' --content-type audio/ogg --cache-control 'public,max-age=31536000,immutable'
```

Before committing the generated inventory, verify every uploaded asset's full SHA-256, MIME type, CORS and byte-range response. The inventory is `web/bible-on-site/src/data/recitation/opus-playback.json`; each entry binds the original source hash to a separate playback hash. S3 names use playback hashes. A changed MP3 cannot silently use an old derivative. Native CI fetches those exact bytes and packages them without re-encoding; native runtime never downloads from S3.

Android's bundled catalog keeps the original `audioSha256`, URL, duration, words and approved intervals, with a separate `playback` descriptor. The book archive and installed file are verified against the compressed hash. Old MP3 installations remain valid only for releases whose catalog selects MP3; a new Opus catalog prompts installation of the current book pack. Once replacement audio is verified, obsolete MP3 copies in the app download directory are removed; files still referenced by the catalog or a failed upgrade are preserved.

The website and Android clip bridge use locked `ogg-opus-decoder` 1.7.5 / `opus-decoder` 0.7.12. Complete-file decoding applies pre-skip and final-page trimming before selecting the original millisecond ranges. No ML speech enhancement is enabled. The committed two-second fixture checks sample count, sample origin and exact clips against FFmpeg's libopus PCM reference, and the existing MP3 tests remain.

iOS ODR packages carry the same source-bound derivatives. AVPlayer has no Ogg demuxer, so the app decodes complete chapters through the identical bundled WASM bridge into PCM WAV under its cache; word and verse clips already flowed through that bridge. The decoded output is keyed by playback hash and regenerated whenever the selected source changes. Opus at 24 kbps is lossy playback compression, not a replacement for archival MP3s. The pipeline remains unchanged. Windows packages retain MP3 in this delivery.
