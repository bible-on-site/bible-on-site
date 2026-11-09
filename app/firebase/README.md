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

Ordinary Debug and e2e builds (`DISABLE_ANALYTICS`, `BIBLE_E2E` marker) never
sign in or emit to Firebase — same posture as analytics collection. The one
deliberate exception is the emulator-gated e2e build described below
(`-p:FirebaseEmulator=true` / `FIREBASE_EMULATOR=1`), which routes Auth and
Firestore to the local Emulator Suite only; production Debug/Release builds
never compile that path and keep the real endpoints.

## Emulator Suite smoke test (#3185)

The native preference-sync path is verified end to end against the Firebase
Emulator Suite — disposable, in-memory, and rules-enforcing — so no real user
data or production project state is ever touched.

### Prerequisites

- Java 21+ (the Firestore emulator is a JVM process; the Auth emulator is Node).
- Firebase CLI: `npm install -g firebase-tools` (CI pins a version in
  `app-firebase-emulator-e2e.yml`).
- A device/simulator that can reach the host: the Android emulator uses the
  `10.0.2.2` host alias, the iOS simulator shares the host network
  (`localhost`), and a physical device needs an explicit override (see below).

### Start the suite

From `app/firebase/`:

```sh
firebase emulators:start --only auth,firestore --project tanah-al-haperek
```

`firebase.json` pins Auth to `127.0.0.1:9099` and Firestore to `127.0.0.1:8080`
and loads `firestore.rules`, so the security rules are enforced exactly as in
production. Emulator data lives only in memory — stopping the suite discards
everything; there is no export unless you pass `--export-on-exit`.

### Build the emulator-gated app

```sh
cd app
FIREBASE_EMULATOR=1 MOBILE_PLATFORM=Android dotnet run --project devops -- CompileMobileE2E
# or: MOBILE_PLATFORM=iOS for the simulator build
```

`FIREBASE_EMULATOR=1` reaches `CompileMobileE2E`, which passes
`-p:FirebaseEmulator=true`; the app then compiles `FIREBASE_EMULATOR` and calls
`UseEmulator` on Auth and Firestore before their first use. The build still
sets `DisableAnalytics=true`, so analytics and push stay off — only Auth and
Firestore talk, and only to the emulator.

### Endpoint overrides

Defaults: Android `10.0.2.2:9099`/`8080`, iOS `localhost:9099`/`8080`.
Override per run with environment variables (iOS launch environment, desktop)
or Android system properties (`adb shell setprop`, the only channel an Android
app process has):

| Setting | Environment variable | Android system property |
| --- | --- | --- |
| Host | `FIREBASE_EMULATOR_HOST` | `debug.bos.firebase.emulator.host` |
| Auth port | `FIREBASE_EMULATOR_AUTH_PORT` | `debug.bos.firebase.emulator.auth.port` |
| Firestore port | `FIREBASE_EMULATOR_FIRESTORE_PORT` | `debug.bos.firebase.emulator.firestore.port` |

Example for a physical Android device on the same LAN as the suite host
(`192.168.1.10`):

```sh
adb shell setprop debug.bos.firebase.emulator.host 192.168.1.10
```

### Run the scenarios

```sh
cd app/mobile-e2e
FIREBASE_EMULATOR=1 MOBILE_PLATFORM=Android MOBILE_UDID=emulator-5554 \
  MOBILE_APP_PATH=<apk-or-app-path> MOBILE_E2E_ARTIFACTS=<dir> \
  MOBILE_E2E_SELECTION=$PWD/firebase-emulator-selection.json bun run test
```

`FirebasePreferencesSyncTests` covers: silent anonymous sign-in and
`users/{uid}` creation with no prompts, a real adapter preference write, remote
winner applied across relaunch, offline save with later sync recovery,
preservation of unrelated document entries, and per-user security-rule
isolation. The test process reads the same `FIREBASE_EMULATOR_*` variables
(host defaults to `localhost`, where the suite runs).

### Disposable-data cleanup

The emulator holds everything in memory: `Ctrl+C` on `emulators:start` (or
letting CI's job end) discards all Auth accounts and Firestore documents. The
scenarios additionally delete the second identity and document they create.
Never point `--export-on-exit` at a shared directory for routine runs.

### Physical-iOS smoke — owner pending

This host is Windows, so the iOS leg is structured for CI's macOS/Xcode
runners (`app-firebase-emulator-e2e.yml`) but has not been executed on a
physical iPhone. A physical iOS device cannot reach `localhost`; it needs the
Mac's LAN address via `FIREBASE_EMULATOR_HOST` in the app's launch environment
— record that smoke as owner-pending until run on Apple hardware.
