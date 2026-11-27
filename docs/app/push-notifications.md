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
   already off. A successful re-opt-in clears the marker. The client deletes
   a surviving pre-auth row through the legacy lane and the verified row
   through the authenticated lane; local topic unsubscribe is already the
   delivery opt-out even if either registry cleanup is unreachable.
5. **Startup**: `LoadingPage` re-applies the stored opt-in once per launch —
   idempotent topic re-subscription covers reinstalls and token churn. A
   system-level revocation keeps the stored intent (it records user intent,
   not live delivery state) and resubscribes silently once re-granted.

## Identity (no Advertising ID)

Per the #1097 discussion, the notification identity is *not* the Advertising
ID. Registration ownership is verified with the app's existing silent Firebase
anonymous-authentication session:

- `user_id` — the verified anonymous Firebase Auth uid of the installation.
  The server verifies the Firebase Auth ID token sent in
  `Authorization: Bearer …` and requires the token subject to equal the row's
  `userId`; it is stored redundantly as `auth_user_id` so ownership is
  explicit in the table.
- `installation_id` — the Firebase Installation ID (FID). It is rotation and
  migration metadata, **not** a credential. Firebase Installation auth tokens
  have no documented server-side verification surface, so they are not used.
- `token` — the FCM registration token. It is delivery metadata and migration
  evidence when paired with the legacy registration key, never proof by
  itself of ownership.

An anonymous auth uid is installation-local: reinstalling or wiping app data
normally creates a new uid. The durable pre-auth `push.user_id` compatibility
key is therefore not re-seeded or trusted as a credential. While the key is
retained after upgrade the client includes it as `legacyUserId`; the server
replaces that legacy row only when the unbound row
is still unbound and carries the same non-empty installation id or the same
FCM token as the verified request. This recovers the common upgrade path
without letting a caller migrate a row merely because it knows the legacy id.
After the server confirms migration the client clears the compatibility key.
Every other outcome for a supplied key is deliberately reported the same way:
the response does not distinguish a missing row, an already auth-bound row, or
an unbound row whose possession evidence did not match, because that
distinction would leak whether a caller-supplied legacy id names a
registration. The client therefore retains the key; if an unbound row does
exist, a later opt-out can still remove it through the legacy lane. Retention
is harmless and bounded — at most one legacy key is stored per device,
bearerless cleanup cannot touch auth-bound rows, and FCM topic membership, not
the registry row, is the actual delivery subscription.

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
  "userId": "verified-firebase-auth-uid",
  "installationId": "fcm-installation-id",
  "token": "fcm-registration-token",
  "platform": "android" | "ios",
  "topics": ["daily_perek"],
  "appVersion": "5.1.8",
  "legacyUserId": "optional-pre-auth-key-during-upgrade"
}
```

DELETE body: `{ "userId": "verified-firebase-auth-uid" }`; verified clients also send the same bearer token used for POST.

Semantics the backend implements (`src/lib/app-push/service.ts`):

- **Verified upsert by `userId`**: the bearer Firebase Auth ID token is
  RS256-verified against Google's securetoken certificates, with issuer and
  audience bound to `tanah-al-haperek`. The verified subject must equal
  `userId`; the row stores it as `auth_user_id`. A changed token replaces it
  (token rotation), but only for the same verified installation. A different
  installation receives 403. Rows live in `tanah_push_device`
  (`data/mysql/tanah_push_device_upgrade.sql`).
- **Topics**: sender publishes the daily perek to the FCM topic
  `daily_perek`. `topics` is stored only to reflect/debug; the source of
  truth is the device's FCM topic subscription — the sender uses the topic,
  not per-token fan-out.
- **DELETE** removes the row entirely after the same verified-owner check.
  A request without a bearer token is the supported pre-auth compatibility
  lane and can remove only rows whose `auth_user_id` is still NULL. It can
  never remove an auth-bound row. Local FCM topic unsubscribe remains the
  real delivery opt-out in every client generation.
- **Stale-token cleanup**: only a genuine dead-token verdict drops the row —
  `404 NOT_FOUND`, or `400` whose `FcmError` detail carries `UNREGISTERED`
  (the HTTP v1 mapping of legacy `NotRegistered`/`InvalidRegistration`).
  Other 400s are message-shape errors and leave the row alone.
- `POST` reports itself unconfigured (404) until the FCM service account is
  deployed. Identity verification outages answer 503 rather than accepting an
  unverified write. `DELETE` remains available without service-account
  configuration so opt-out is never blocked.
- Anonymous writes stay bounded (#3500): `POST` attempts are rate-limited
  per router-supplied client address (429, a budget shared with
  `/api/push/subscription`), and `tanah_push_device` caps new identities at
  25,000 rows — an existing `userId` always upserts past the cap, and a
  possession-matched legacy migration remains allowed because it replaces a
  row instead of increasing the final count.

A successful POST response carries `legacyMigrated` and `legacyUnresolved`.
For a supplied `legacyUserId`, `legacyUnresolved` is false only after a
possession-matched migration. It is true for every other outcome — missing,
already auth-bound, or unmatched unbound — so the response cannot be used as a
legacy-registration existence oracle. The client clears its compatibility key
only after confirmed migration; a missing outcome field on an older server is
treated conservatively as unresolved.

Registration is deduplicated client-side by a stored
`(user|installation|token|topics|legacy-key)` fingerprint — a routine launch
only re-POSTs when something actually rotated.

### Sender

`POST /api/push/device/daily` publishes the daily perek to the `daily_perek`
topic over FCM HTTP v1 — no client library; the service account JWT bearer
grant is minted in `service.ts`. It shares the `PUSH_SEND_SECRET` bearer
credential and the fail-closed body contract of `/api/push/daily`: an absent
body broadcasts to the topic, while `{ "token": "<fcm registration token>" }`
targets exactly one device for the controlled delivery check — a mistyped or
invalid key is a 400, never a broadcast. Failure also fails closed (#3499):
a send where every attempt failed answers 502 and a targeted check that
matched no live device answers 404, so `curl --fail-with-body` turns the
run red instead of passing on `{ "sent": 0 }`.
`.github/workflows/app-push-daily.yml`
calls it on the same 05:00 UTC schedule as the web-push sender, armed by the
`APP_PUSH_ENABLED` repository variable. Messages carry the same 12-hour
expiry as the web sender — `android.ttl` plus the `apns-expiration` header —
so a device that reconnects later (Shabbat, offline) never receives
yesterday's reminder on a different study day.

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
which the Messaging SDK depends on. A Debug build can exercise platform topic
delivery with `-p:DisablePush=false`; while analytics remain disabled it has
no Firebase Auth identity, so verified registration is exercised on the signed
push-enabled acceptance build instead.

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
