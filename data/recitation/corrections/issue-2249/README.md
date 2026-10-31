# Corrected edition — perek 28 (בראשית כח), issue #2249

The original MP3 says **בַּת אַבְרָהָם** in pasuk 9 where the canonical text is
**בֶּן־אַבְרָהָם** (יִשְׁמָעֵאל is a son of אַבְרָהָם). Verified on the
hash-bound original: `28_record.mp3` SHA-256
`6fd5818b8ee6e3ea42736230982fab6a5e5ed6d4a53278dc4947ad1c03ba6e2c`.

`28_record_corrected.mp3` is a separately identified corrected edition: the
narrator's own בֶּן from pasuk 5 of the same recording (לָבָן בֶּן־בְּתוּאֵל)
spliced over the spoken בַּת. The archival original, its hash and the published
S3 object are unchanged. Full source/edit/donor provenance, verification notes
and remaining acceptance steps are in `edition.json`.

Status: third build. The first rendered בןבן (donor window ran past בֶּן into
בְּתוּאֵל's opening); the second clipped יִשְׁמָעֵאל's tail (in-joint at 91.19 s
sat inside the word's final vowel). This build splices בֶּן alone
(50.42-50.74 s, pinned by Whisper word timestamps) with the in-joint a little
after יִשְׁמָעֵאל completes, at 91.34 s — verified by direct listening and
re-transcription. Acceptance still
requires rerunning the unchanged full-quality alignment pipeline on the
edition's own source hash plus canonical/timing and packaging verification —
see `edition.json.remaining`.
