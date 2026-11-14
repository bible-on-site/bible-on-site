# Security model

Threat model used to triage Devin security scans. Scan findings are ranked against it, so keep it current when the deployment or trust boundaries change.

Vulnerability reporting is in [SECURITY.md](SECURITY.md).

## Decisions
- All attacker profiles below are in scope; none ruled out.
- No asset is singled out as more critical than its scanner rating.
- Nothing is out of scope or accepted risk.
- Scan scope excludes `data/` content/populator and `pr-*/`; a repository-root `evidence/` path cannot exist — the Root evidence guard CI job rejects it.

## Components
| Component | Code | Trust boundary |
|---|---|---|
| **Website** | `web/bible-on-site/`, `web/shared/` | Anonymous internet -> Next.js |
| **API** | `web/api/` (Rust Actix + async-graphql) | Website/app/internet -> GraphQL -> MySQL |
| **Admin Panel** | `web/admin/` | Cognito/AWS-SSO editors -> admin server functions -> MySQL, S3, SES, WhatsApp, LLM |
| **Mobile App** | `app/` (.NET MAUI, PAD/iOS asset packs) | Device -> API / bundled SQLite |
| **BOS Infra & CI** | `web/bulletin/` (Typst Lambda), `devops/`, `.github/workflows/`, `docs/aws/` | GitHub Actions + AWS (ECS Fargate behind nginx on EC2, Lambda, ECR, S3, RDS MySQL, il-central-1) |

**Overview.** Public Tanah study site. AWS il-central-1: nginx on EC2 -> ECS Fargate (website, API, admin) via Cloud Map; RDS MySQL; S3 assets; Lambdas (db-populator, ecr-to-ecs-deploy, bulletin PDF); SES/WhatsApp/Telegram bulletin delivery. CI/CD via GitHub Actions deploying to ECR/ECS.

**Entry points.**
- Website (anonymous): Next.js pages + `src/app/api/*` (search, tanah, tanahpedia, calendar-pdf, recitation, store-metadata, response-time, health, `revalidate` with `REVALIDATE_SECRET` header or `?secret=`, `dev/*` gated on `NODE_ENV`).
- API (anonymous reads): GraphQL queries; mutations (dedications, tanahpedia aliases/family/revisions) gated by Bearer keys (`DEDICATION_API_KEY`, `TANAHPEDIA_REVISION_API_KEY`, `common/auth.rs`); search engine endpoints.
- Admin Panel: Cognito OAuth (AWS SSO IdP) cookie session + optional client-credentials service token (`server/auth.ts`); `SKIP_AUTH=true` dev bypass (`server.tsx`); server functions writing MySQL, S3 uploads, SES, WhatsApp, LLM assistant.
- Mobile App: talks to API, downloads asset packs.
- CI: workflows incl. `auto-create-pr.yml`, PR-triggered jobs, self-hosted/mac runners, AWS credentials in secrets.

**Assets.** AWS account and IAM roles used by CI; RDS data (articles, dedications incl. donor info, tanahpedia); S3 objects; Cognito client secret; API keys; SES/WhatsApp sender reputation; site integrity (defacement, Divine Name masking); app-store signing keys.

**Attackers.** Anonymous internet (XSS, SSRF, injection, DoS on search/PDF, secret-in-URL); compromised or malicious admin editor; leaked API bearer keys; fork PRs / supply chain in CI (pwn-request, script injection from PR titles/branches); dependency CVEs.

**Controls.** Bearer keys on mutations; Cognito JWT verification via JWKS (`jose`); revalidate secret checked before side effects; CodeQL, Codacy, dependency review, Renovate; Biome lint bans `innerHTML`/`dangerouslySetInnerHTML`.

## Deployment facts
- bible-on-site admin `SKIP_AUTH`/`MEASURE_COV` are dev/test-only flags, ignored when `NODE_ENV=production` so a stray deployment flag fails closed (`web/admin/src/server/environment.server.ts`). The former anonymous `/api/bulletin-documents/` route was removed (#3069): every admin path requires an authorized Cognito session or scoped service token.
- bible-on-site CI: fork PRs get no secrets (no `pull_request_target`/self-hosted secret exposure to forks).
