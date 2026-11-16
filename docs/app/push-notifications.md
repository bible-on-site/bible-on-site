# Push Notifications (#1097)

Daily-perek push notifications for Android and iOS over Firebase Cloud
Messaging (FCM). This document covers the app-side architecture, the identity
and registration contract the backend implements, and the remaining operator
steps before delivery can be verified end to end.

## Scope

| Piece | Status |
|-------|--------|
| App-side push layer (this repo) | Implemented (#3188) |
| Backend `POST/DELETE /api/push/device` route + sender | Implemented here (`web/bible-on-site/src/app/api/push/device`, `src/lib/app-push`) |
| Production Apple/Firebase console setup | Done (November 11, 2026 — Push capability on `com.tanah.daily929`, APNs key `ZHG8KWF7FZ` in the Firebase production APNs slot, distribution profile regenerated with `aps-environment=production`, CI profile secrets refreshed) |
| FCM sender credential deployment + schedule arming + device acceptance | Remaining operator steps (see checklist) |
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
   are log-only so a backend outage never blocks the opt-in).
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

## Backend contract

Routes on the website API surface, mirroring `web/.../api/push/subscription`:

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

Semantics the backend implements (`src/lib/app-push/service.ts`):

- **Upsert by `userId`**: a row carries one current `(installationId, token)`
  pair; a changed token replaces it (token rotation), a changed installation
  id replaces the stale installation (reinstall). Rows live in
  `tanah_push_device` (`data/mysql/tanah_push_device_upgrade.sql`).
- **Topics**: sender publishes the daily perek to the FCM topic
  `daily_perek`. `topics` is stored only to reflect/debug; the source of
  truth is the device's FCM topic subscription — the sender uses the topic,
  not per-token fan-out.
- **DELETE** removes the row entirely (opt-out).
- **Stale-token cleanup**: on FCM send errors to a targeted token
  (`INVALID_ARGUMENT`/`NOT_FOUND` — the HTTP v1 mapping of legacy
  `NotRegistered`/`InvalidRegistration`) the sender drops the token's row.
- No authentication is required (public daily-perek content), matching the
  self-claimed-row model of `/api/push/subscription`. `POST` reports itself
  unconfigured (404) until the FCM service account is deployed; `DELETE`
  always works so opt-out is never blocked.

Registration is deduplicated client-side by a stored
`(user|installation|token|topics)` fingerprint — a routine launch only re-POSTs
when something actually rotated.

### Sender

`POST /api/push/device/daily` publishes the daily perek to the `daily_perek`
topic over FCM HTTP v1 — no client library; the service account JWT bearer
grant is minted in `service.ts`. It shares the `PUSH_SEND_SECRET` bearer
credential and the fail-closed body contract of `/api/push/daily`: an absent
body broadcasts to the topic, while `{ "token": "<fcm registration token>" }`
targets exactly one device for the controlled delivery check — a mistyped or
invalid key is a 400, never a broadcast. `.github/workflows/app-push-daily.yml`
calls it on the same 05:00 UTC schedule as the web-push sender, armed by the
`APP_PUSH_ENABLED` repository variable.

Configuration: the `FCM_SERVICE_ACCOUNT_JSON` environment value is the Google
service account JSON (`project_id`, `client_email`, `private_key`) for a
service account with `firebase.messaging` send scope on `tanah-al-haperek`;
the website task injects it from the SSM SecureString
`bible-on-site-fcm-service-account-json` (commented wiring in
`docs/aws/cloudformation/ecs-services.yaml`, mirroring the VAPID block).

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
| `aps-environment` | `Entitlements.App.plist` (Debug) / `Entitlements.Dist.plist` (Release) | Signed value must literally match the profile: `development` vs `production`. `IosPushProvisioned` defaults to `true` (capability enabled and production profile regenerated on November 11, 2026), so `_SetIosCodesignEntitlements`, `ios_signing_requirements.py` and signed packaging all resolve the same plist. A device build whose profile does not authorize `aps-environment` (e.g. an unregenerated local development profile) passes `-p:IosPushProvisioned=false` to keep `Entitlements.Base.plist` (app groups only) |
| `UIBackgroundModes → remote-notification` | `Info.plist` | Data/background delivery |
| `google-services.json` / `GoogleService-Info.plist` | checked in | Same `tanah-al-haperek` project as analytics |
| `AD_ID` removed | `AndroidManifest.xml` | `tools:node="remove"` — push adds **no** advertising-id usage |

`DISABLE_PUSH` builds (Debug/e2e — `DisablePush` defaults to
`DisableAnalytics`) compile the service down to a no-op and skip iOS Firebase
init, because `DISABLE_ANALYTICS` builds never call `CrossFirebase.Initialize`
which the Messaging SDK depends on. A Debug build can opt in with
`-p:DisablePush=false`.

## Operator checklist (before first real delivery)

Done November 11, 2026 (see the issue status): the App ID's Push
Notifications capability, the production APNs key uploaded to Firebase, and
the regenerated distribution profile (`aps-environment=production`) with
refreshed CI profile secrets. Historical notes claiming this setup was still
unavailable are superseded.

Remaining:

1. **FCM sender credential**: create a Google service account on
   `tanah-al-haperek` allowed to send Firebase Cloud Messaging, download its
   JSON key, and store it as the SSM SecureString
   `bible-on-site-fcm-service-account-json`; add it to the website task
   definition's `Secrets` as `FCM_SERVICE_ACCOUNT_JSON` (commented wiring in
   `docs/aws/cloudformation/ecs-services.yaml`) and roll the service. Until
   then `POST /api/push/device` answers 404 and the app logs a best-effort
   registration failure — no user-visible change. `PUSH_SEND_SECRET` already
   exists and is shared with the web-push sender.
2. **Controlled delivery check**: on a push-enabled signed build, opt in,
   read the device's FCM registration token, and manually dispatch the
   `App Push Daily Perek` workflow with that `token` input. A
   `{"skipped": ...}` response means a non-study day — re-dispatch on a
   study day. The direct-token check proves delivery but bypasses
   `daily_perek` topic membership, so it cannot alone prove topic opt-out.
3. **Arm the schedule**: set the `APP_PUSH_ENABLED` repository variable to
   `true` — scheduled runs then broadcast to the `daily_perek` topic. Do
   not broadcast to production subscribers before acceptance.
4. **Verify on device**: opt-in prompt → topic subscription → receive in
   background → tap opens today's perek; opt-out stops delivery (topic
   unsubscribe is the real opt-out check, distinct from the token test).
