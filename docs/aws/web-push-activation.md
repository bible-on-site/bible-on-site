# Web push activation runbook (#1096)

The daily perek web-push feature is merged and disabled by default. This runbook is the operator-side activation: it lists every AWS-impacting and GitHub-side change, the exact order to apply them, the verification checks and the rollback. **Nothing here is applied by the repository** — every step below is a deliberate operator action requiring Dorad's explicit authorization for live activation, in addition to approval of the specific pull request and its current AWS-impacting changes. The CloudFormation templates are reference documentation only; do not deploy them.

## What already exists

- Website code: `GET/POST/DELETE /api/push/subscription`, `POST /api/push/daily`, opt-in `PushNotificationsToggle`, service worker `public/sw.js` (push render + click routing only, no fetch handler).
- Sender: `.github/workflows/web-push-daily.yml` (cron `0 5 * * 0-5`, i.e. 07:00/08:00 Israel, Sunday-Friday; the route itself skips Shabbat/review days).
- Storage: `tanah_web_push_subscription` table deployed by the 2026-11-01 Data deployment (`data/mysql/tanah_web_push_upgrade.sql`).
- Disabled-by-default gates: `GET /api/push/subscription` returns `{"publicKey": null}` and the toggle hides itself until the website task env is configured; `POST /api/push/daily` returns 503 until configured; the workflow's scheduled runs are gated by `vars.WEB_PUSH_ENABLED == 'true'`.

## Settings map

### Website ECS task environment (`bible-on-site-website` task definition)

Documented target state in `cloudformation/ecs-services.yaml` (`WebsiteTaskDefinition`). Any unset value keeps the feature off; all four must be present together.

| Env var | Source | Notes |
| ------- | ------ | ----- |
| `VAPID_PUBLIC_KEY` | SSM SecureString `bible-on-site-vapid-public-key` | Returned to browsers by `GET /api/push/subscription`; rotate only with resubscription of every client |
| `VAPID_PRIVATE_KEY` | SSM SecureString `bible-on-site-vapid-private-key` | Secret; never logged |
| `VAPID_SUBJECT` | Plain `Environment`: `https://xn--febl3a.co.il` | VAPID contact URI (mailto: or https:); not secret |
| `PUSH_SEND_SECRET` | SSM SecureString `bible-on-site-push-send-secret` | Bearer token authorizing `POST /api/push/daily`; must equal the GitHub secret of the same name |

The task execution role's `SSMParameterReadAccess` policy must additionally allow the exact parameter ARNs for `bible-on-site-vapid-public-key`, `bible-on-site-vapid-private-key` and `bible-on-site-push-send-secret` (documented in `ecs-services.yaml`), preserving all existing resources.

### GitHub repository settings

| Name | Kind | Value |
| ---- | ---- | ----- |
| `PUSH_SEND_SECRET` | Secret | Same string as SSM `bible-on-site-push-send-secret` |
| `WEB_PUSH_ENABLED` | Variable | `true` — set LAST, only after delivery verification passes |
| `WEB_PUSH_SITE_ORIGIN` | Variable | Optional; workflow defaults to `https://xn--febl3a.co.il` |

## Activation order

1. **Preflight — confirm identity and targets.** `aws sts get-caller-identity --region il-central-1 --profile AdministratorAccess-250598594267` must report production account `250598594267`; use this region and profile for every AWS command. Confirm the live website service is `bible-on-site-website` on cluster `bible-on-site-cluster` and record the running task-definition revision and resolved image digest for rollback. Confirm `WEB_PUSH_ENABLED` is absent or not `true` before changing configuration.
2. **Generate the VAPID keypair** without printing it: `VAPID_KEYS="$(bunx web-push generate-vapid-keys --json)"`. Keep shell tracing disabled and keep the private key out of logs and source files. Generate the send secret once into a short-lived shell variable without printing it: `PUSH_SEND_SECRET="$(openssl rand -hex 32)"`. Reuse that value for both SSM and GitHub in steps 3 and 5.
3. **Create the three SSM SecureStrings** (`bible-on-site-vapid-public-key`, `bible-on-site-vapid-private-key`, `bible-on-site-push-send-secret`) — commands in the prerequisites block at the bottom of `cloudformation/ecs-services.yaml`, adding `--profile AdministratorAccess-250598594267` to each. Replace the whole quoted values `"<vapid-public-key>"` and `"<vapid-private-key>"` with `"$(printf '%s' "$VAPID_KEYS" | jq -r .publicKey)"` and `"$(printf '%s' "$VAPID_KEYS" | jq -r .privateKey)"` respectively, without printing them, then `unset VAPID_KEYS`. Verify each parameter exists with `aws ssm get-parameter --name <name> --region il-central-1 --profile AdministratorAccess-250598594267 --query 'Parameter.Name'`.
4. **Extend the execution role policy** so `ecsTaskExecutionRole` may `ssm:GetParameter(s)` on the three new parameters (per the documented `SSMParameterReadAccess` resource list).
5. **Set the GitHub secret** from the same shell variable used in step 3: `printf '%s' "$PUSH_SEND_SECRET" | gh secret set PUSH_SEND_SECRET --repo bible-on-site/bible-on-site`, then immediately `unset PUSH_SEND_SECRET`. Do not set `WEB_PUSH_ENABLED` yet.
6. **Register a new website task-definition revision** by cloning the live task-definition JSON and stripping only AWS response metadata. Add the three `Secrets:` entries and the `VAPID_SUBJECT` environment entry exactly as documented in `ecs-services.yaml`; preserve every existing field, role, resource setting, secret mapping and image reference. Update the service and wait (`aws ecs wait services-stable --cluster bible-on-site-cluster --services bible-on-site-website --region il-central-1 --profile AdministratorAccess-250598594267`). Then re-query until there is one primary deployment, desired/running counts match, pending is zero and `rolloutState` is `COMPLETED`; verify the running revision, container health, logs and public website health. Check the application version separately to confirm the merged targeted-send route is deployed before any delivery check. Stop and roll back if verification fails. A missing SSM parameter fails the task at start — order steps 3-4 before this.
7. **DB-access verification.** The website connects as the RDS user in `bible-on-site-tanah-db-url` (master `admin`, which already holds all grants on `tanah.*`; no new grant or migration is required). Confirm: `GET https://xn--febl3a.co.il/api/push/subscription` returns `{"publicKey": "<key>"}` — the same public key as step 3 — and a real opt-in in step 8 exercises INSERT/DELETE on the live table end to end.
8. **Opt in exactly one browser** (the operator's own) via the daily-notification toggle on the home page. Confirm its row exists in `tanah_web_push_subscription`; preserve any existing subscriptions rather than expecting the whole table to contain only the test browser.
9. **Controlled delivery check.** Send only to that one subscription — never broadcast. Get the test browser's endpoint URL first (DevTools console on the site: `(await (await navigator.serviceWorker.ready).pushManager.getSubscription()).endpoint`). Re-read the send secret without printing it (step 5 unset it), use that variable in the authorization header, and clear it immediately after the request. Run this subshell with tracing disabled; its exit trap clears the secret even if the read or request fails:

   ```bash
   (
     trap 'unset PUSH_SEND_SECRET' EXIT
     PUSH_SEND_SECRET="$(aws ssm get-parameter --name bible-on-site-push-send-secret --with-decryption --region il-central-1 --profile AdministratorAccess-250598594267 --query Parameter.Value --output text)" || exit
     curl --fail-with-body -X POST -H "Authorization: Bearer $PUSH_SEND_SECRET" -H "Content-Type: application/json" -d '{"endpoint": "<the browser subscription endpoint URL>"}' https://xn--febl3a.co.il/api/push/daily
   )
   ```

   Expect `{"perekId": <id>, "sent": 1, "removed": 0, "failed": 0}` on a study day (`{"skipped": ...}` on Shabbat/review days — retry on a study day). Verify the notification renders in Hebrew RTL, the click focuses/opens `/929/<perekId>`, then opt out via the toggle and confirm the row is deleted (browser `unsubscribe` + `DELETE /api/push/subscription` both run). On a `{ "sent": 0, "removed": 1 }` result the endpoint was already gone — re-opt-in and repeat.
10. **Workflow wiring check.** Manually dispatch `Web Push Daily Perek` with the `endpoint` input set to the test browser's subscription endpoint (re-opt-in first if step 9 ended in opt-out). The input is required and the dispatch POSTs `{"endpoint": ...}` — a manual run always targets exactly one subscription and can never broadcast, so it is safe while `WEB_PUSH_ENABLED` is still unset. The run must be green and its step output must show `"sent": 1` (or `{"skipped": ...}` on a non-study day — re-dispatch on a study day). A red run or `sent: 0` means `PUSH_SEND_SECRET`/`WEB_PUSH_SITE_ORIGIN` mismatch or a stale endpoint — fix before arming.
11. **Arm the schedule.** Set repository variable `WEB_PUSH_ENABLED=true` (`gh variable set WEB_PUSH_ENABLED --body true --repo bible-on-site/bible-on-site`). The next `0 5` run sends to all then-current subscribers; the feature is fully live.
12. **Post-enable verification.** After the first scheduled run, check the workflow result body (`sent`/`removed`/`failed` counts) and the website logs for delivery warnings.

## Rollback

- **Stop the schedule only**: delete variable `WEB_PUSH_ENABLED` (or set it to anything but `true`). No AWS change needed.
- **Disable the feature**: register a task-definition revision without the three `Secrets:` entries and the `VAPID_SUBJECT` entry (or the previous revision, kept from step 1) and update the service. `GET /api/push/subscription` returns `publicKey: null` again and the toggle hides itself; stored rows remain for reactivation. This is the full undo of the production-visible change.
- **Full teardown** (only if abandoning the feature): additionally delete the three SSM parameters, the GitHub secret/variables, and `DELETE FROM tanah_web_push_subscription`. Removing database rows stops sends to those subscriptions; it does not revoke the browser's subscription at its push provider.
- Never rotate VAPID keys as a "disable": a key change invalidates every stored browser subscription permanently.

## Invariants

- No PWA/installation funnel: the service worker registers only after explicit opt-in and renders pushes only; the `ios-install` state and manifest promotion were removed in #3052 and must not return.
- The route never notifies on Shabbat or review days regardless of caller timing.
- No timeout, retry, budget or concurrency setting is changed by this activation.
- `endpoint_hash` (sha256) keys the table. Raw endpoints, private keys and request bodies stay out of application and Actions logs. The operator supplies only their test browser's endpoint for the targeted workflow check; the workflow masks it before use.
