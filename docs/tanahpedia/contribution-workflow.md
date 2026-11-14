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
| `LOCAL_LLM_MODEL` | Enables local generation with the named Ollama model |
| `LOCAL_LLM_URL` | Ollama base URL, default `http://127.0.0.1:11434`; reachable from the admin server |
| `BEDROCK_MODEL_ID` | Enables AWS generation using Bedrock Converse |
| `BEDROCK_REGION` | Bedrock region, falling back to `AWS_REGION` and then `us-east-1` |
| `TANAHPEDIA_DORADSOFT_SUB` | Binds the reviewer to an immutable verified Cognito subject when the Cognito username differs from `doradsoft` |
| `TANAHPEDIA_DEV_ACTOR` | Optional local QA identity; honored only with non-production `SKIP_AUTH=true` |

Bedrock uses the AWS SDK's normal server credential chain and requires
`bedrock:InvokeModel` for the configured model. No IAM grants are created by the
feature. A deployed admin must reach its local inference service over its own
private network; a visitor's browser localhost is not the server's localhost.
No hosted OpenAI fallback is used for issue generation.

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

Validation tasks: `bun run test:unit`, `bun run coverage:unit`,
`bun run test:contributions:mysql`, `bun run lint`, and `bun run build` in
`web/admin`. The MySQL suite creates and removes its own random loopback-only
database from the canonical repository schema; it never edits the local corpus.
