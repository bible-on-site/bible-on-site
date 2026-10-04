`seek-reference.pcm.gz` is the independent, mono 44100 Hz signed 16-bit PCM reference for `data/recitation/fixtures/seek.mp3`. It was generated with:

```sh
ffmpeg -i data/recitation/fixtures/seek.mp3 -f s16le seek-reference.pcm
```

The app decoder browser regression compares original sample positions against this reference, including MP3 encoder priming, the first and last samples, word-sized clips, and disjoint verse selections. Small codec rounding differences are allowed; timing shifts are not.
