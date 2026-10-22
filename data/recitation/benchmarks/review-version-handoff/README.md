# Review candidate version handoff

Real in-app-browser captures of the review HTML using read-only synthetic data, not real recordings, review notes, session credentials or publication data. The same fixture provides 28 current candidates, one superseded active candidate, five current saved answers and one historical saved problem answer. No review POST is accepted by the fixture.

- `before.jpg`: the superseded candidate is prepended, producing 29 cases and six answers. Its old hearing and note look current.
- `after.jpg`: only the 28 current candidates and five current answers are counted. Revised cuts require fresh hearing; the old note is read-only and the new answer starts empty.
- `preserved-old-draft.jpg`: the old candidate and note remain accessible separately and are explicitly labeled. The update button returns to current cuts without losing the old draft.

Frontend regressions also cover polling during audio playback and its inter-word gap, focused editing, old-version saves, draft restoration and deliberate historical navigation.
