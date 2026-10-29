# Source-defect verification — perek 136 (במדבר יט), issue #2223

No corrected edition is proposed here: the defect is a missing ~9-word clause
that cannot be repaired from available donor speech (see below). This file
records exactly what was verified and what remains.

## Verified on the hash-bound original

`136_record.mp3` SHA-256 `987691f1d8f4bed574fc610bd6efe142e698c42cc93ba8bb4010d623e5a4d0a7`
(the published object at
`https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/136_record.mp3`
matches this hash).

- Pasuk 10's canonical clause
  `וְכִבֶּס הָאֹסֵף אֶת־אֵפֶר הַפָּרָה אֶת־בְּגָדָיו וְטָמֵא עַד־הָעָרֶב`
  is not spoken in the recording.
- In its place, at ~96.5-101.6 s (issue-pinned span 97.42-101.64 s), the
  narrator recites the Esther 1:14 name list
  `תַּרְשִׁישׁ מֶרֶס מַרְסְנָה מְמוּכָן`.
  Direct listening of the region (95.5-104.0 s extract) confirms the foreign
  names and the absence of the canonical clause — matching the human report
  and the source-hash-bound Whisper transcript in the issue.

## Why no splice repair is possible

A corrected edition would need the narrator's own speech for the missing
clause. Within this same chapter the only matching words are scattered
fragments — `אֵפֶר הַפָּרָה` (19:9), `בְּגָדָיו` (19:7/8), `וְטָמֵא עַד־הָעָרֶב`
(19:7/8/21) — while the participle `הָאֹסֵף` does not exist in the chapter at
all (19:9's `וְאָסַף` carries different stress), and `וְכִבֶּס`/`אֶת־` in this
context have no suitable donors. Stitching ten words across six seams would
fabricate content, which the correction rules forbid. The existing Esther 1
track is already ruled out as a byte-level donor by the issue's PCM comparison
(max normalized correlation 0.1166).

## What remains

- A correct recording of the clause `הָאֹסֵף אֶת־אֵפֶר הַפָּרָה אֶת־בְּגָדָיו
  וְטָמֵא עַד־הָעָרֶב` (or the complete pasuk 10), re-recorded by the source
  authority (the narrator / recording maintainer).
- Once obtained: register it as an explicit new edition with its own source
  hash (same contract as `corrections/issue-2249/edition.json`), then rerun
  the unchanged full-quality alignment pipeline and the normal
  canonical/timing + packaging verification before publication.
- The archival MP3 and its hash stay preserved; perek 136 stays held
  (`alignment_status = 'pending'`, no word rows) until the edition exists.
