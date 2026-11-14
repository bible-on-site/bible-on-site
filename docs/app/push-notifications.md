# Push Notifications (#1097)

Daily-perek push notifications for Android and iOS over Firebase Cloud
Messaging (FCM). This document covers the app-side architecture, the identity
and registration contract the backend implements (deferred), and the platform
console setup required before delivery can be verified end to end.

## Scope

| Piece | Status |
|-------|--------|
| App-side push layer (this repo) | Implemented here |
| Backend `POST/DELETE /api/push/device` route + sender | Deferred — contract below |
| Firebase console topics/sender setup, APNs key, Play-console notification channel review | Operator task (see checklist) |
| Web push subscriptions (`/api/push/subscription`) | Separate implementation (#1096) — do not conflate |

## User flow

1. **Opt-in**: `Settings → על הפרק → התראות → התראה על הפרק היומי`
   (`PerekPreferencesPage` → `PerekPreferencesViewModel.DailyPerekPushEnabled`).
   The toggle is only rendered where `IPushNotificationService.IsSupported`
   (Android + iOS Release-capable builds; desktop and `DISABLE_PUSH` builds
   hide it).
2. The platform permission prompt runs lazily — Android 13+
   `POST_NOTIFICATIONS` via `Permissions.RequestAsync`, iOS
   `UNUserNotificationCenter.RequestAuthorization`. A denial shows a Hebrew
   dialog offering to open system settings; the toggle snaps back to off.
3. On success the app subscribes to the FCM topic `daily_perek`, persists the
   preference, and POSTs the device-registration row (best-effort — failures
   are log-only while the backend route is deferred).
4. **Opt-out**: same toggle off → unsubscribe topic + `DELETE` registration.
   The local preference is written first so opt-out never gets stuck behind a
   flaky network. A failed unsubscribe records `push.pending_unsubscribe`
   (FCM keeps topic membership server-side) and `ApplyEnabledPreferenceAsync`
   retries it on every launch — including launches where the preference is
   already off. A successful re-opt-in clears the marker. The `DELETE` uses
   the persisted `push.user_id` when the instance identity is not yet
   resolved, so a fresh process still unregisters the earlier row.
5. **Startup**: `LoadingPage` re-applies the stored opt-in once per launch —
   idempotent topic re-subscription covers reinstalls and token churn. A
   system-level revocation keeps the stored intent (it records user intent,
   not live delivery state) and resubscribes silently once re-granted.

## Identity (no Advertising ID)

Per the #1097 discussion, the notification identity is *not* the Advertising
ID and not the raw FID:

- `user_id` — durable notification identity, seeded from the Firebase
  Installation ID on first registration (GUID when FID is unavailable).
  Persisted in iOS Keychain (`SecureStorage`, survives reinstall) and Android
  preferences (restored by Auto Backup — `android:allowBackup` is already on).
  A reinstall that loses both stores re-seeds a new id and the backend
  re-links by `(user_id, installation_id)`.
- `installation_id` — the Firebase Installation ID (FID). Rotates on
  reinstall/data-wipe; sent on every registration so the backend can re-link
  a rotating installation to the durable `user_id`.
- `token` — the FCM registration token. Rotates on token refresh; every
  `TokenChanged` re-syncs the registration when opted in.

The FID is **not** an authentication credential — the contract treats
`user_id` + `installation_id` + `token` as an unauthenticated upsert row,
matching the web-push subscription route's model (subscription rows are
self-claimed by the device that holds them; the daily-perek payload is
non-personal public content). If a future feature needs authenticated
delivery, layer Firebase Anonymous Auth sign-in on top and send an ID token.

## Backend contract (deferred)

Route on the website API surface, mirroring `web/.../api/push/subscription`:

```
POST   /api/push/device        upsert
DELETE /api/push/device        remove  (JSON body — same convention as
                                      DELETE /api/push/subscription)
```

POST body (`PushDeviceRegistration`, camelCase, `JsonSerializerDefaults.Web`):

```json
{
  "userId": "fid-or-guid",
  "installationId": "fcm-installation-id",
  "token": "fcm-registration-token",
  "platform": "android" | "ios",
  "topics": ["daily_perek"],
  "appVersion": "5.1.8"
}
```

DELETE body: `{ "userId": "fid-or-guid" }`.

Semantics the backend must implement:

- **Upsert by `userId`**: a row carries one current `(installationId, token)`
  pair; a changed token replaces it (token rotation), a changed installation
  id replaces the stale installation (reinstall).
- **Topics**: sender publishes the daily perek to the FCM topic
  `daily_perek`. Store `topics` only to reflect/debug; the source of truth is
  the device's FCM topic subscription — send via topic, not per-token fan-out.
- **DELETE** removes the row entirely (opt-out).
- **Stale-token cleanup**: on FCM send errors (`NotRegistered`,
  `InvalidRegistration`) drop the token/installation row.
- No authentication is required (public daily-perek content), but rate-limit
  the route the same way `/api/push/subscription` is handled.

Registration is deduplicated client-side by a stored
`(user|installation|token|topics)` fingerprint — a routine launch only re-POSTs
when something actually rotated.

## Notification payload

Send a *data* payload (plus the platform `notification` block for
system-tray rendering):

```json
{
  "notification": { "title": "הפרק היומי", "body": "יחזקאל ל" },
  "data": { "url": "/929/{perekId}" }
}
```

- `url` — site-relative (`/929/{perekId}` or `/929/{perekId}/{articleId}`) or
  an absolute website URL on `xn--febl3a.co.il` / `xn--febl3a.com`.
- Tap routing: `PushNotificationService.ResolveTarget` resolves `url` through
  `AppLinkHelper.TryResolveSiteUrl` (host allowlist) then
  `AppLinkHelper.TryParse` (path contract 1–929, positive article id) and
  feeds `AppLinkHelper.Request` — the same channel Android app links and
  in-content links already use (`PendingTarget` cold-start +
  `TargetRequested` warm). Other hosts, non-web schemes and malformed paths
  are ignored — a notification can never push the app to an arbitrary page.
- Android: system-tray deliveries arrive on the `daily_perek` notification
  channel (manifest default channel + `default_notification_icon` =
  `@mipmap/appicon`); foreground receipts are reposted by
  Plugin.Firebase.CloudMessaging on the same channel and tapped intents
  dispatch through `FirebaseCloudMessagingImplementation.OnNewIntent` in
  `MainActivity` (`OnCreate` cold start + `OnNewIntent` singleTop).
- iOS: `FirebaseCloudMessagingImplementation.Initialize()` installs the
  UNUserNotificationCenter/FIRMessaging delegates in `WillFinishLaunching`;
  the plugin queues a cold-start tap and replays it when the service
  subscribes during opt-in application.

## Platform configuration

| Item | Where | Notes |
|------|-------|-------|
| `POST_NOTIFICATIONS` permission | `AndroidManifest.xml` | Runtime-asked on opt-in (Android 13+) |
| Default channel/icon meta-data | `AndroidManifest.xml` | `daily_perek`, `@mipmap/appicon` |
| `aps-environment` | `Entitlements.App.plist` (Debug) / `Entitlements.Dist.plist` (Release) | Signed value must literally match the profile: `development` vs `production`. Gated on `-p:IosPushProvisioned=true` in `_SetIosCodesignEntitlements` — until the App ID's Push capability is enabled and the profiles regenerated (operator step 1), builds sign with `Entitlements.Base.plist` (app groups only) because no profile authorizes `aps-environment` yet |
| `UIBackgroundModes → remote-notification` | `Info.plist` | Data/background delivery |
| `google-services.json` / `GoogleService-Info.plist` | checked in | Same `tanah-al-haperek` project as analytics |
| `AD_ID` removed | `AndroidManifest.xml` | `tools:node="remove"` — push adds **no** advertising-id usage |

`DISABLE_PUSH` builds (Debug/e2e — `DisablePush` defaults to
`DisableAnalytics`) compile the service down to a no-op and skip iOS Firebase
init, because `DISABLE_ANALYTICS` builds never call `CrossFirebase.Initialize`
which the Messaging SDK depends on. A Debug build can opt in with
`-p:DisablePush=false`.

## Operator checklist (before first real delivery)

1. **Apple Developer**: enable the *Push Notifications* capability on the App
   ID `com.tanah.daily929`; regenerate the distribution profile (it gains
   `aps-environment=production`) and refresh the CI profile secrets.
   Afterwards pass `-p:IosPushProvisioned=true` to iOS builds so
   `_SetIosCodesignEntitlements` selects the `aps-environment` plists
   (`Entitlements.App.plist` Debug / `Entitlements.Dist.plist` Release)
   instead of `Entitlements.Base.plist`.
2. **Firebase console** (`tanah-al-haperek`): upload the APNs authentication
   key (Cloud Messaging → APNs Authentication Key). No server key needed in
   the app — sending uses the topic via the Admin SDK/HTTP v1 backend-side.
3. **Backend**: implement `POST/DELETE /api/push/device` per the contract
   above plus the daily-perek topic sender (schedule mirrors the web-push
   sender's timing), then verify with a controlled test send on a device that
   opted in.
4. Verify on device: opt-in prompt → topic subscription → receive in
   background → tap opens today's perek; opt-out removes delivery.
