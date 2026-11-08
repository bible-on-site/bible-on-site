# Tanahpedia Admin Editing Model

Two distinct persistence layers guard Tanahpedia edits. They are not interchangeable.

## Local drafts (browser `localStorage`)

- **What they are:** crash/accident recovery for uncommitted work — scratch state,
  not history. A draft is the editor's *current buffer*, mirrored to `localStorage`
  after a short debounce.
- **Never the server:** typing produces **zero** server requests. Nothing enters
  `tanahpedia_entry_revision` until an explicit commit.
- **Scoping:** each draft is keyed by the authenticated editor's Cognito `sub` and
  the entry (or a stable `new:` identity for unsaved entries), so editors sharing a
  machine never see each other's drafts, and a session swap cannot leak them.
- **Multi-tab:** a draft written by a different tab (detected by `sessionId`) is
  surfaced as a notice, never merged silently.
- **Recovery:** on load, a stored draft is *offered* — restore or discard, never
  applied automatically. A draft whose `baseRevisionId` no longer matches the
  server head is marked stale: restoring it keeps the base guard, so the commit
  still conflict-checks against the real head.
- **Lifecycle:** a successful commit clears the draft; adopting the server version
  (conflict reload, history restore) re-offers it; delete and revert remove it.
  Storage failures surface as a visible local-persistence warning.

## Server revisions (`tanahpedia_entry_revision`)

- **What they are:** the entry's permanent, immutable audit history. Every
  committed change produces one `APPLIED` revision row — no squashing, no
  time-window collapsing.
- **Created only by explicit action:** the **שמור עכשיו** button (admin commits),
  approve/reject/restore flows, and the external revision API.
- **Optimistic concurrency:** each commit carries `baseRevisionId`; if the head
  moved (another editor, a restore), the commit is rejected with a visible
  conflict instead of silently overwriting.
- **No-op commits:** saving unchanged content returns the current head without
  writing a revision.

## The distinction that matters

A draft protects *edits in progress*; a revision records *decisions made*.
Losing drafts loses convenience — losing revision integrity loses the record
of who changed what and why. The editor therefore never auto-commits: commits
are always deliberate, serialized (one in flight, latest queued wins), and
attributed (`admin` / `llm-assistant` source and notes are captured per
snapshot, not per keystroke).
