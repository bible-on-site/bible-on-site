# Firebase configuration — preference sync (#1095)

The app syncs `PreferencesService` to Cloud Firestore for signed-in users
(Android/iOS). Every install establishes a Firebase Auth session — anonymous
sign-in today, a real provider can ride the same path later — and stores its
merged preferences document at `users/{uid}`.

## Required user experience

Saving preferences must remain silent and require no user consent, login screen,
account selection, or permission popup. Firebase anonymous authentication runs
in the background through `SignInAnonymouslyAsync`; it does not open a Google
sign-in flow. Local preferences are loaded first and saved immediately, without
waiting for authentication or Firestore. Network or authentication failures
leave local preferences available and must not display an error dialog.

Anonymous identities belong to individual app installations. They do not link
the same person's devices automatically. Shared-account, cross-device sync
requires a separately designed account-linking feature; it must not make saving
preferences depend on a login or consent prompt.

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

## Production configuration

Activated on November 8, 2026 in the existing Firebase project
`tanah-al-haperek` (project number `264471534749`): Anonymous sign-in is enabled,
and the Standard edition `(default)` native-mode Cloud Firestore database is
in `me-west1` (Tel Aviv), with free-tier eligibility on the no-cost Spark plan.
The old `nam5` Datastore-mode database was confirmed empty by a kindless query
before its approved replacement. Keeping the `(default)` database name preserves
the Android/iOS client configuration. The deployed rules match `firestore.rules`.

Live backend verification passed 18 checks using the existing Android and iOS
API keys: anonymous authentication, preference creation/read/update, preservation
of unrelated entries, and denial of cross-user, unauthenticated, and out-of-scope
access. Both disposable identities and their preference documents were removed
after verification. This verifies the live backend and client configuration;
native app/device smoke testing remains separate, including iOS initialization
and confirming the visible reader experience on a Firebase-enabled build.

### Setup and rules deployment

1. Enable **Anonymous** in Firebase Auth sign-in providers for project
   `tanah-al-haperek` (the existing app Firebase project).
2. For a new, empty project database, create the default native-mode database:

   ```sh
   firebase firestore:databases:create '(default)' --location me-west1 --edition standard --project tanah-al-haperek
   ```

   A database's region cannot change in place. Never delete an existing database
   containing user data to repeat this setup. After an approved deletion of an
   empty database, Google requires about five minutes before reusing its name.
3. Deploy rules from this directory, always specifying the production project:

   ```sh
   firebase deploy --only firestore:rules --project tanah-al-haperek
   ```

   Alternatively, publish the exact contents of `firestore.rules` through the
   Firebase console rules editor.

When authentication or Firestore is unavailable, the app stays local-only:
failures are logged and preferences keep working offline without a dialog.

To suspend cloud sync, publish deny-all Firestore client rules and disable the
Anonymous sign-in provider. Preserve the database and its user documents; the
app continues saving preferences locally. Restore this file's rules and the
provider to resume sync. This rollback does not change the database region.

## Test/e2e gating

Debug and e2e builds (`DISABLE_ANALYTICS`, `BIBLE_E2E` marker) never sign in
or emit to Firebase — same posture as analytics collection.
