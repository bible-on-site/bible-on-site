# Issues and pull requests

Implementation scope: GitHub/GitLab-inspired issue and pull-request queues in the
Tanahpedia admin. Issues support unassigned, human, AWS LLM, and local LLM
assignees. Assignment, authorship, and review are separate identities.

The user extended the original 30-hour work window by 10 hours after an
interruption. The revised deadline is **2026-11-15 06:10 UTC**, or **08:10 in
Asia/Jerusalem**. This supersedes the original deadline in the active goal text.

## Decisions

- Issues describe a problem; PRs carry evidence and typed operations. The
  description and changes have separate tabs. Diffs show domain fields,
  family relationships, and coordinates rather than source files.
- Every PR requires approval from `doradsoft`, except PRs authored by
  `doradsoft`. Model-generated PRs retain a model author even when a human
  starts generation. A verified account identity determines review authority.
  Exemption follows the current revision's author: another editor changing an
  owner-authored PR cannot inherit that exemption.
- Human edits invalidate old approvals. Automatic API migrations never do,
  including conversions that remove fields or operations. Merge checks the
  current API contract, reviewed revision and target state. An issue is closed
  only after a successful merge when the PR requests it.
- New-entry proposals contain confirmed metadata and an empty body only. LLMs
  cannot propose encyclopedia prose, SQL, arbitrary API methods, or credentials.
- Durable records, comments, reviews, and applied-operation history live in
  MySQL. Local browser storage is not the issue/PR source of truth.
- Authored edits retain immutable previous proposal snapshots, including their
  evidence and operation sequence. Review and merge events also retain the
  exact proposal they approved or applied. Historical versions are available
  in the discussion as raw sequences with their original API versions.
- Queue filtering and counts run on the server before pagination. Keyset pages
  contain 100 discussions, with an explicit load-more action; newer closed
  history cannot hide older open issues or linked discussions. Assignment-only
  edits preserve approval, while changing proposal content creates a revision.
- PERSON display-name changes also update MAIN person names. Their reviewed
  values participate in conflict checks and appear in the diff, so independent
  name edits cannot be silently overwritten.
- LLM assignment does not itself execute a model or merge changes. Generation
  is explicit, and model output passes the same typed validation as human input.

UX references: [GitHub pull requests](https://docs.github.com/en/pull-requests/get-started/about-pull-requests),
[GitLab review workflow](https://docs.gitlab.com/user/project/merge_requests/reviews/),
and [GitLab approval settings](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/).
Local structured generation follows [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

## Configuration and operation

The queues are `/issues` and `/pull-requests` in the existing authenticated admin.
The four assignee kinds remain available even when a model is not configured.
Assignment never spends inference tokens. The explicit generation button uses
the issue's saved assignee, evidence, discussion and matching catalogue records.

Server-only environment variables:

| Variable | Purpose |
| --- | --- |
| `BEDROCK_MODEL_ID` | Enables AWS generation using Bedrock Converse |
| `BEDROCK_REGION` | Bedrock region, falling back to `AWS_REGION` and then `us-east-1` |
| `TANAHPEDIA_DORADSOFT_SUB` | Binds the reviewer to an immutable verified Cognito subject when the Cognito username differs from `doradsoft` |
| `TANAHPEDIA_DEV_ACTOR` | Optional local QA identity; honored only with non-production `SKIP_AUTH=true` |

Bedrock uses the AWS SDK's normal server credential chain and requires
`bedrock:InvokeModel` for the configured model. No IAM grants are created by the
feature. Local inference runs on the workstation, through an outbound worker;
the deployed admin does not connect to workstation localhost. No hosted OpenAI
fallback is used for issue generation.

Run Ollama with `qwen3:4b`, sign into the existing AWS SSO profile, then run
`node devops/contribution-worker.mjs --watch`. The worker defaults to the
production admin and `AdministratorAccess-250598594267`. Use `--once` for one
job, `--issue <UUID>` to select an issue, or `--origin http://localhost:3102 --dev`
for an explicitly local preview. `--model` and `--ollama` select another local
model or inference endpoint. The user requested automatic startup at Windows
sign-in; its launcher lives outside the repository so archiving this worktree
does not remove it.

The explicit local generation button saves a durable queue request. Workers
claim one issue using a three-minute hashed lease, run inference under the
existing two-minute deadline, and submit output for server validation. A changed
issue, assignment, API contract or catalogue rejects the result. PR creation and
completion receipt commit together; an identical replay returns that receipt.
A disconnected worker can be replaced after lease expiry, with three automatic
claim attempts per request. An editor can explicitly retry or cancel by closing,
editing or reassigning the issue. Background job refreshes preserve unsaved drafts.

The worker reads the existing service client's credentials in memory through
AWS SSO and requests only `admin-api/contributions`. It retains a short-lived
access token and never copies the service secret to disk. This scope only grants
claim, complete and fail endpoints; ordinary `admin-api/service` tokens and
browser cookies cannot authenticate them. Worker tokens cannot review, merge or
use the general admin API. Logs omit evidence, prompts, tokens and lease secrets.
Expired SSO requires another AWS sign-in; queued issues remain saved meanwhile.
Watch mode resumes after transport outages under the existing abortable poll
interval; one-shot failures remain observable. The Windows launcher additionally
restarts an exited process and keeps the model service bound to loopback.

`devops/contribution-config.mjs --reviewer-sub <verified-sub> --receipt <private-file>`
plans the configuration. Add `--apply` to append the scope to the existing
Cognito resource/client and bind the reviewer in a cloned admin task definition.
It verifies account, pool, enabled subject and stable service, preserves all
current writable settings, refuses unknown AWS fields and saves a private
rollback receipt, including the running image digest, before writes. No additional
Cognito client or IAM grant is created. The CloudFormation files document the
settings and are not applied as a replacement stack.

The local smoke used Ollama 0.40.16 with `qwen3:4b` on CPU: an issue produced a
metadata-only PERSON entry proposal with its supplied evidence, a visual diff,
and a disabled merge button pending owner review. The entry was not applied.
Smaller models can choose an incorrect relationship even with valid JSON;
structured output constrains the operation protocol, while source correctness
still requires human review. Unknown IDs and invented source citations are rejected.

## API evolution

The merge operation contract starts at version 1, independently of package or
release versions. `convertApiVersion` composes explicit directed adapters through
intermediate versions. Register reverse adapters when a reverse route is needed;
no reverse transformation is inferred. Retain historical adapters for PRs that
skip releases. An adapter may drop obsolete fields or operations. The converter
does not contain approval logic.

Every successful public API CD calls `/api/contributions/migrate`. A separate
production admin boot pass handles the other deployment order, because these
typed domain merge operations run in the admin service's transaction. Breaking
changes to that operation contract must bump `CONTRIBUTION_API_VERSION` and ship
the corresponding adapters in the same release. The reusable converter is
independent of issues, PRs and storage.

The deployment endpoint accepts only a signed GitHub OIDC token for this
repository's `cd-aws.yml` on master, with a dedicated audience and immutable
repository ID. It does not accept browser sessions or ordinary service tokens.
The [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc)
provide these deployment identity restrictions without a new stored secret or IAM grant.

The keyset scan visits all open PRs rather than the UI's initial result limit.
Each PR migrates in its own locked transaction. Successful conversions update
the active sequence without changing its revision or approval events. The input
sequence and adapter path are retained. A conversion/validation failure leaves
the PR open and gray with **couldn't migrate to latest API**, blocks merging,
hides the visual diff, and displays the plain original sequence. Other PRs still
migrate. Infrastructure failures fail the CD hook so it can be rerun.

A later adapter can recover a gray PR automatically with its approval intact.
Editors can also repair its raw sequence in the same PR. Manual repair refreshes
base values and labels from the database and creates an authored revision under
the usual review rules; the previous failed sequence remains in history.
If all obsolete operations are removed by a successful migration, merging is an
explicit no-op that retains the audit record.

Other options considered: retain version-specific executors until every old PR
finishes (larger permanent support surface); store high-level intentions and
compile an operation sequence at merge time (less exact review predictability);
or convert lazily on read/merge (leaves dormant PR failures undiscovered until
used). Deployment-time upgrades with explicit adapters provide an early audit
and a recoverable raw sequence, as requested.

## Deployment and rollback

`tanahpedia_contribution_upgrade.sql` adds one InnoDB table and two queue indexes.
It is idempotent and leaves all existing content, schema, and public URLs intact.
The admin also safely ensures its owned table outside application transactions,
matching the existing proposal queue pattern. Issue/PR state and domain changes
commit atomically on merge. Evidence and reviewed before/after values are retained.

Roll back the admin image to disable the new screens while retaining this table;
do not drop review history. A content merge is corrected using a new reviewed
inverse change based on the current state, rather than rewriting its audit record.
Rolling back across a contract change requires an explicit reverse adapter;
otherwise the older runtime fails closed and shows the raw sequence until the
upgrade/recovery path is restored. No public or crawled URLs change.

For configuration rollback, restore the prior writable Cognito client/resource
settings from the private receipt and redeploy the prior admin task definition.
After a later `latest` image publication, register its saved definition with the
saved running image digest instead of relying on the mutable tag. Stop the local
worker before removing its scope. Existing general admin service access remains
unchanged because its original scope and client settings are preserved.

Validation tasks: `bun run test:unit`, `bun run coverage:unit`,
`bun run test:contributions:mysql`, `bun run lint`, and `bun run build` in
`web/admin`. The MySQL suite creates and removes its own random loopback-only
database from the canonical repository schema; it never edits the local corpus.

Local browser validation uses the task-specific `tanah_e2e_4243` fixture database.
The shared `tanah_test` corpus no longer contained its required article/author
fixtures despite a previously successful population. Keeping this task's fixture
separate removes shared-database interference. Coverage and browser report
directories are excluded from Vite's watch
set: writing generated HTML must not reload an editor. The deployment-tool suite
uses four test processes to avoid Windows child-process contention; its original
process deadlines remain unchanged.
