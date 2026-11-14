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

## Emulator regression path (#3185)

Routine device verification runs entirely against the local Firebase Emulator
Suite — never production:

- `firebase.json` pins Auth `9099` and Firestore `8080`; `package.json` carries
  `firebase-tools` and `bun run emulators:start` boots just those two services
  against project `tanah-al-haperek` (matching `firestore.rules`).
- `CompileMobileE2E` builds pass `-p:FirebaseEmulator=true` → `FIREBASE_EMULATOR`.
  That build may only reach the Emulator Suite: it resolves
  `BIBLE_FIREBASE_EMULATOR` (`host` or `host:authPort:firestorePort`) at launch
  and stays local-only when it is absent or malformed — it can never fall
  through to production. Plugin.Firebase has no emulator surface, so
  `FirebaseEmulatorRedirect` calls the native SDKs' `useEmulator` on the same
  singletons the plugin wraps.
- iOS receives the value through the launch environment; Android cannot carry
  process environment, so the suite sends it as an intent extra and
  `MainActivity` persists it to `files/firebase-emulator` — the marker file is
  what later `activateApp` relaunches (which drop extras) resolve.
- `FirebaseEmulatorSyncTests` (mobile-e2e) opts in only when the run provides
  `MOBILE_FIREBASE_EMULATOR`. The Android CI leg installs `app/firebase`,
  starts the suite and exports that variable; other legs leave it unset and
  the scenarios skip. `FirebaseEmulatorBackend` verifies committed
  Auth/Firestore state over the emulator's REST surface (the `Bearer owner`
  admin token is test-only), so the assertions observe the same data the
  app's native adapters produced.
- Covered behavior: silent anonymous sign-in with no dialog, `users/{uid}`
  persistence matching the codec schema, persistence of a pre-existing local
  preference across the first merge, relaunch keeping the same installation
  identity, unknown-entry carry-through, per-user rules isolation, offline
  saves staying local (dead endpoint) and converging after recovery.

### Owner-side iOS smoke (physical device / simulator)

The shared-Appium leg is Android-only for now, so iOS verification is an
owner-side smoke against the same Emulator Suite:

1. `cd app/firebase && bun install && bun run emulators:start`
   (physical iPhone: `firebase emulators:start --project tanah-al-haperek
   --only auth,firestore --host 0.0.0.0` so the device can reach it; keep the
   emulator and the device on one LAN).
2. Build the Firebase-emulator Debug app:
   `dotnet build app/BibleOnSite -f net10.0-ios -c Debug -p:FirebaseEmulator=true`
   (the e2e CI artifact already carries the flag).
3. Launch with the endpoint —
   simulator: `SIMCTL_CHILD_BIBLE_FIREBASE_EMULATOR=127.0.0.1:9099:8080 xcrun simctl launch booted com.tanah.daily929`;
   device: `xcrun devicectl device process launch --device <udid> --environment-variables '{"BIBLE_FIREBASE_EMULATOR":"<mac-lan-ip>:9099:8080"}' com.tanah.daily929`
   (or the equivalent Xcode scheme environment variable).
4. Expected: the reader appears with **no** login sheet, consent screen,
   account picker, or error dialog. Within ~30s the emulator shows one
   anonymous account (`/v1/projects/tanah-al-haperek/accounts:batchGet`,
   `Bearer owner`) and one `users/{uid}` document under Firestore REST.
5. Toggle a display preference, then force-quit and relaunch with the same
   env: the same `uid` document gains the new entry — the installation
   identity and cloud value persist across relaunch.
6. Offline/recovery: relaunch with a dead port
   (`<host>:19099:18081`) — preference changes save locally with no dialog;
   relaunching with the live endpoint converges the same `uid` document.
7. Isolation: a second emulator sign-in (REST `accounts:signUp`) cannot read
   `users/{uid}` (`403`), matching `firestore.rules`.
8. Cleanup: delete the app's `users/{uid}` document and account through the
   emulator REST surface and sign off in the tracking issue.
