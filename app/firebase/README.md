# Firebase configuration — preference sync (#1095)

The app syncs `PreferencesService` to Cloud Firestore for signed-in users
(Android/iOS). Every install establishes a Firebase Auth session — anonymous
sign-in today, a real provider can ride the same path later — and stores its
merged preferences document at `users/{uid}`.

## Document schema (`users/{uid}`)

```jsonc
{
  "schemaVersion": 1,
  "deviceId": "<last writer>",
  "entries": {
    "<preference-key>": { "value": <bool|number|string>, "updatedAt": <unix-ms>, "deviceId": "<writer>" },
    "<removed-key>":    { "tombstone": true,            "updatedAt": <unix-ms>, "deviceId": "<writer>" }
  }
}
```

Merge is per-key last-writer-wins on `updatedAt` (ties keep the remote
entry). Keys unknown to the running app pass through untouched.
`inAppBackButton` is deliberately device-local and never synced. Local
write stamps are floored at `max remote updatedAt + 1`, so an entry dated
in the future by a skewed device clock cannot defeat edits made after it
was observed. Saves use `SetOptions.merge()` — only the merged fields are
written, so a concurrent device's keys are never overwritten by a stale
snapshot.

## Console setup (deferred — Codex per issue triage)

1. Enable **Anonymous** in Firebase Auth sign-in providers for project
   `tanah-al-haperek` (the existing app Firebase project).
2. Create a Cloud Firestore database in the project.
3. Deploy rules: `firebase deploy --only firestore:rules` from this directory
   (or paste `firestore.rules` into the console rules editor).

Until those steps land, the app stays local-only: sign-in/store failures are
logged and preferences keep working offline — no user-facing change.

## Test/e2e gating

Debug and e2e builds (`DISABLE_ANALYTICS`, `BIBLE_E2E` marker) never sign in
or emit to Firebase — same posture as analytics collection.
