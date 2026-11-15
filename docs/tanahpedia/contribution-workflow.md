# Issues and pull requests

Implementation scope: GitHub/GitLab-inspired issue and pull-request queues in the
Tanahpedia admin. Issues support unassigned, human, AWS LLM, and local LLM
assignees. Assignment, authorship, and review are separate identities.

The user extended the original 30-hour work window by 10 hours, then explicitly
continued the task through production verification after that window ended.

## Decisions

- Issues describe a problem; PRs carry evidence and typed operations. The
  description and changes have separate tabs. Diffs show domain fields,
  family relationships, and coordinates rather than source files.
- Every PR requires approval from `doradsoft`, except PRs authored by
  `doradsoft`. Model-generated PRs retain a model author even when a human
  starts generation. A verified account identity determines review authority.
  Exemption follows the current revision's author: another editor changing an
  owner-authored PR cannot inherit that exemption.
- Human edits and automatic content rebases require a fresh owner review. Automatic API migrations never invalidate approvals,
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
- Family relationship choices come from the existing family API contract:
  biological/adoptive/step/foster parenthood and marriage/pilegesh/
  forbidden-with-gentile/banned-incest/betrothal unions. They share one Family
  relationship category in the composer. Additional kinship categories are not
  inferred from this request.

UX references: [GitHub pull requests](https://docs.github.com/en/pull-requests/get-started/about-pull-requests),
[GitLab review workflow](https://docs.gitlab.com/user/project/merge_requests/reviews/),
and [GitLab approval settings](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/).
Local structured generation follows [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

## Supported changes

All additional category types reviewed by the user are included. The current
contract has 45 operation kinds; family choices use the nine existing API types.

| Category | Structured changes |
| --- | --- |
| Family | Biological, adoptive, step and foster parenthood; marriage, pilegesh, forbidden-with-gentile, banned-incest and betrothal unions; their roles, order, dates and source citations |
| Person | Display/MAIN name, additional names and nicknames, human/divine name giver, sex, birth/death dates, death cause, birthplace |
| Roles | Prophet and king roles, reign dates and nation |
| Places | Modern identification, paired coordinates, alternative identifications |
| Events | Locations and date ranges |
| Wars | Sides, person participants, nation participants |
| Nations | Source nations, territories and their date periods |
| Sayings | Date, location, human/nation/divine speaker, person/nation audience |
| Prophecies | Prophet, person/nation recipients, good/adverse classification |
| Animals | Kind and purity using the schema's enums |
| Plants / astronomy | Creation day |
| Books | Match to an existing canonical biblical book |
| Entry identity | Existing entry title, entry/entity links, complete alias target sets and disambiguation labels |
| Sources | Entity/verse/segment links; scripture/commentary or bibliographic references attached to existing entities, entries or structured facts |
| Assets | Existing 3D asset key, format and label; no upload or access-policy change |
| New entries | Empty entry and linked subtype for all 13 creatable entity types |

No operation edits article or saying prose. Hebrew dates use the existing
uniform month numbering, with zero for unknown components and the death-date
`-1` sentinel for not yet deceased. Forms expose year/month/day controls.
Existing prefixed record identifiers are accepted alongside UUIDs; discussion
and worker-job IDs retain strict UUID validation.

Each record operation whitelists its table, fields, enums and reference types.
References must exist when preparing and merging a proposal. Unique collisions
fail the transaction rather than update a different, unreviewed row. Deletions
refuse implicit cascades: dependent facts and source attachments require explicit
removal operations, applied before their parent. Roles and war sides retain their
owner when edited. Competing facts can share an alternative-group identifier and
carry separate evidence. Moving one source preserves other citations sharing its
old source group.

Alias changes review the complete destination set, including labels. These
operations can explicitly change public alias routing after approval and merge;
they cannot rename an existing alias in place or replace a canonical entry URL.
The feature deployment itself preserves existing public and crawled URLs.

## Configuration and operation

The queues are `/issues` and `/pull-requests` in the existing authenticated admin.
The four assignee kinds remain available even when a model is not configured.
Assigning an enabled agent queues durable work: an issue assignment implements
the issue as reviewable PRs; a PR assignment reads its current state and resolves
feedback in that same PR. Human comments, requests for changes, authored edits
and reopening automatically queue another pass. Agent responses do not trigger
themselves. Missing model configuration, disabled agents or insufficient evidence
remain visible as needing input; they do not discard the discussion.

An active assigned pass blocks merging until it finishes or the PR is unassigned.
Assignment and response-only passes preserve approval. A pass that changes the
proposal creates a model-authored revision and requires owner review. Original
comments stay immutable; responses reference their exact comment IDs and record
whether they were addressed or need input. Existing linked proposals are visible
to issue agents so completed work can be acknowledged without duplicate PRs.
Model-facing target records label existing values as `current`; proposed changes
use `after`. The prompt explains each available operation and illustrates a title
replacement. A creation at an occupied canonical address fails validation before
any proposal is saved; an already pending creation follows the content-rebase
conversion described below.

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

Run Ollama with `qwen3:8b`, sign into the existing AWS SSO profile, then run
`node devops/contribution-worker.mjs --watch`. The worker defaults to the
production admin and `AdministratorAccess-250598594267`. Use `--once` for one
job, `--issue <UUID>` to select an issue, or `--origin http://localhost:3102 --dev`
for an explicitly local preview. `--ollama` selects the local inference endpoint;
`--model` supplies the legacy generation fallback. Assignment-driven runs use
their registered model, which is changed on the Agents page. The user requested automatic startup at Windows
sign-in; its launcher lives outside the repository so archiving this worktree
does not remove it.

Assignment saves the queue request in the same transaction as the discussion
change. An explicit rerun remains available for recovery. Local workers claim
one issue or PR using a three-minute hashed lease, run inference under the
existing two-minute deadline, and submit output for server validation. AWS
assignments use the same protocol through a serial background runtime. A changed
discussion, assignment, agent configuration, API contract or read catalogue
rejects stale output. PR creation or revision, per-comment responses and the
completion receipt commit together; an identical replay returns that receipt.
A disconnected worker can be replaced after lease expiry, with three automatic
claim attempts per request. An editor can explicitly retry or cancel by closing,
editing or reassigning the issue. Background job refreshes preserve unsaved drafts.

The worker reads the existing service client's credentials in memory through
AWS SSO and requests only `admin-api/contributions`. It retains a short-lived
access token and never copies the service secret to disk. This scope only grants
claim, bundle/context reads, complete and fail endpoints; ordinary `admin-api/service` tokens and
browser cookies cannot authenticate them. Worker tokens cannot review, merge or
use the general admin API. Logs omit evidence, prompts, tokens and lease secrets.
Expired SSO requires another AWS sign-in; queued issues remain saved meanwhile.
The user chose to keep reusing AWS SSO rather than maintain a separate worker
credential; refreshing that existing session lets the watch worker resume.
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
and a disabled merge button pending owner review. The entry was not applied. A second real workstation smoke produced the new
PERSON birth-date operation under API v2; it retained model authorship, the supplied
synthetic evidence and the owner review gate, and was closed without applying it.
Smaller models can choose an incorrect relationship even with valid JSON;
structured output constrains the operation protocol, while source correctness
still requires human review. Unknown IDs and invented source citations are rejected.
An additional real v4 title-edit check exposed a `qwen3:4b` limitation: it selected
the right operation but copied the current title despite describing the requested
replacement. The server rejected this unchanged proposal, and the synthetic issue
and earlier incorrect creation proposal were closed without applying content.
Structured output does not guarantee that a small model follows the requested
edit; an editor can retry with another local model or create the PR manually.
The final workstation check restored missing bundled CUDA libraries and detected
the RTX 4070 Laptop GPU without changing its driver. `qwen3:8b` then produced the
correct v4 title edit on the same issue: approximately 7.5 seconds of inference,
with the unchanged 120-second deadline and 16K context. The visual diff showed
the requested replacement, model authorship and the mandatory owner review.
That synthetic PR and issue were closed without applying content. The worker now
defaults to this tested 8B model. `LOCAL_LLM_MODEL` sets the default for new local
registrations; existing registered model choices survive CD and are edited in admin.
Each inference request unloads the model on completion, returning its memory to the
workstation between jobs instead of retaining an idle model while other apps run.

## Agent versions and context

`/contribution-agents` registers named configurations on the existing local or AWS
runtime. Registration does not install executable packages. The provider, model
and enabled setting are persisted independently from the released instructions
and tool declarations. Default local/AWS configurations preserve the four
existing assignment choices. Configuration changes use optimistic versions;
editing a stale management screen cannot overwrite a concurrent update.

Each release builds an immutable, content-hashed instruction/tool bundle with its
own monotonically increasing version, separate from the contribution API version.
CD refreshes registered agents; registration and the admin update action select
the latest known bundle. Provider/model choices survive that refresh. Historical
bundles remain available for audit, and every queued run records its agent
configuration version and bundle hash. An older process cannot downgrade a newer
registration. Reusing one release version for different bundle content fails
closed; instruction or tool changes require a new bundle version.

Dynamic context is refreshed for each run rather than baked into that bundle.
The initial context includes the current issue/PR, evidence, operation sequence,
review and API/comparison state, linked issue and related proposal index. Read
tools provide explicit pages of complete discussion and immutable history,
related PRs, catalogue searches and exact current records. Pages expose totals
and continuation cursors instead of silently dropping older comments. The model
can retrieve all relevant dynamic context within the existing inference deadline
and context window; the complete database is not inserted into every prompt.
Completion rechecks context fingerprints and tool-read records so concurrent
changes cannot silently apply a stale result. The final transaction locks the
linked issue and its related proposals before validating that context, retaining
those locks through completion. Merging a linked PR uses the same issue-first
order. Compatibility filtering runs before candidate pagination, so older
incompatible work cannot hide a supported assignment later in the queue.

Updating a configuration or bundle replaces incompatible pending work without
changing the proposal's review revision. During a rolling deployment, a server
only claims and executes bundles/API versions it implements exactly; older
servers leave newer work intact. Protocol-1 issue generation remains available
only for legacy task records. It cannot claim assignment-driven protocol-2 jobs.
For the initial protocol-2 rollout, pause existing workstation workers before
deploying admin: pre-feature servers do not recognize the new job envelope.
Wait until the old admin tasks have drained, then upgrade and resume the worker
and verify a fresh assignment and comment pass. Retain the previous worker file.

## API evolution

The merge operation contract is currently version 4, independently of package or
release versions. Versions 1, 2 and 3 are retained in migration history. `convertApiVersion`
and its asynchronous counterpart compose explicit directed adapters through
intermediate versions. Register reverse adapters when a reverse route is needed;
no reverse transformation is inferred. Retain historical adapters for PRs that
skip releases. An adapter may drop obsolete fields or operations. The converter
does not contain approval logic.

The v1-to-v2 adapter captures MAIN-name preconditions for old person-renaming
operations under the same entity/person/name lock order as preparation and
merging. It preserves the original sequence, revision and approval. This is an
automatic API upgrade under the user's explicit policy, including its broader
name-write effect. Contextual adapters can perform authoritative lookups inside
the migration transaction; storage failures abort the CD pass rather than mark
individual PRs incompatible.

If the boot migration encounters a transient storage failure, ordinary production
requests (including health checks) re-enter its startup guard. An in-flight or
successful pass remains shared, and the comparison-recovery worker starts after
the migration succeeds; a temporary database outage does not require redeploying.

The v2-to-v3 adapter captures the structured target fact for source attachments.
Its fields and human reference labels appear in the changes view. A merge checks
that fact again before writing. Free-text evidence in the Description remains
unchanged. As with every API adapter, this automatic contract upgrade preserves
approval.

The v3-to-v4 adapter adds existing-entry title operations without changing saved
sequences or approvals. Resolving a creation to an existing entry belongs to the
content-rebase path, which creates a new revision and requires renewed review.

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

Opening or merging a PR also upgrades a legacy sequence saved by an old admin
process after a deployment scan. Merge commits compatibility and comparison checks first;
even a refused merge leaves a failed conversion gray and recoverable. It retains
the existing approval. The subsequent content transaction checks the version
again, so a concurrent authored edit or review still requires a reload.
Content merges encountered while a PR is gray retain a deferred comparison marker
without touching its raw sequence or approval. After API recovery, the comparison
is refreshed separately: intervening content changes require owner review, while
an unchanged comparison retains approval. Storage failures retain the marker for
retry. This keeps API conversion and content review as distinct policies.

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

## Refresh after content merges

Every content merge durably queues a scan of pending PR sequences in the same
transaction. The scan visits all open PRs, refreshing affected before-states,
reference labels, MAIN-name preconditions and structured cited facts. Proposed
metadata values and free-text evidence remain unchanged. Equal operations become
explicit no-ops and are not written again. Editing an existing proposal retains
these satisfied updates and deletions while rechecking current targets and
references, so evidence or remaining changes can still be edited. New proposals
continue to reject unchanged operations. Incompatible API sequences retain
their untouched raw sequence for the API migration path.

A changed comparison creates a new revision authored by the system and requires
fresh doradsoft review, including an originally owner-authored proposal. Its
previous exact proposal remains on the refresh event. An owner-authored edit can
then use the normal author exemption; an owner approval applies to the refreshed
revision. An unchanged comparison creates no extra revision. API migrations
remain distinct and preserve approval, as explicitly requested by the user.

If a target can no longer be refreshed, the proposal and prior sequence remain
available with an explanation and merging is blocked until an authored repair.
A storage interruption retains the committed merge's pending marker. Startup
and a server worker replay pending refreshes; equal comparisons prevent duplicate
revisions. The normal post-merge path drains immediately, with a 30-second
background pass for interrupted work. A refresh failure never reports an already
committed content merge as rolled back.

Entry and alias operations share the public address space. When another merge
makes a pending creation's name resolve to an existing entry, refresh rewrites it
as edits of that entry's title and compatible entity display name. Its canonical
address, alias destinations and article prose stay intact. Authoritative before
values replace the creation base, and the changed sequence requires fresh
doradsoft review. Ambiguous aliases or multiple/incompatible entity targets
remain blocked for manual repair. Any entry/alias merge refreshes pending address
proposals even when they reference different record IDs. Initial creations still
reject occupied alias addresses; an explicitly reviewed alias removal plus a
replacement creation can be applied atomically.

Existing-entry title edits append the normal immutable APPLIED revision, so an
older prose-editor save conflicts instead of reverting the reviewed title. The
server preserves the current body and canonical address exactly, including null,
empty and legacy values. Resolution locks the entry before its entity, matching
the merge path; a native concurrent-write regression checks that order.

## Deployment and rollback

`tanahpedia_contribution_upgrade.sql` adds the contribution table, two queue
indexes, an agent registry and immutable instruction/tool bundle storage.
It is idempotent and leaves all existing content, schema, and public URLs intact.
The admin also safely ensures its owned tables outside application transactions,
matching the existing proposal queue pattern. Issue/PR state and domain changes
commit atomically on merge. Evidence and reviewed before/after values are retained.

Roll back the admin image to disable the new screens while retaining these tables;
do not drop review history. A content merge is corrected using a new reviewed
inverse change based on the current state, rather than rewriting its audit record.
Rolling back across a contract change requires an explicit reverse adapter;
otherwise the older runtime fails closed and shows the raw sequence until the
upgrade/recovery path is restored. Existing public routes are preserved by the
deployment; later reviewed alias or new-entry operations have the effects shown
in their domain diffs.

For a rollback between version-aware agent releases, stop the newer workstation
worker and restore its previous executable before starting it again. Retain
registry, bundles and queued jobs. Version-aware servers skip unsupported bundles
instead of downgrading registrations or executing newer work; restore the matching
admin/worker release to resume it. Rolling back to the pre-feature admin
`0.1.195` requires keeping contribution automation and workstation workers paused
until protocol 2 is restored: that older image lacks these task gates. Do not
resume old generation or merge agent-assigned proposals on that image while new
jobs remain pending. Existing public content remains available during this pause.
This release creates no new IAM grants, Cognito clients or public content routes.

For configuration rollback, restore the prior writable Cognito client/resource
settings from the private receipt and redeploy the prior admin task definition.
After a later `latest` image publication, register its saved definition with the
saved running image digest instead of relying on the mutable tag. Stop the local
worker before removing its scope. Existing general admin service access remains
unchanged because its original scope and client settings are preserved.

Validation tasks: `bun run test:unit`, `bun run coverage:unit`,
`bun run coverage:contributions:mysql`, `bun run lint`, and `bun run build` in
`web/admin`. The MySQL suite creates and removes its own random loopback-only
database from the canonical repository schema; it never edits the local corpus.
Unit and native MySQL coverage use the same V8 provider and source coordinates,
and both are required in the published admin report. Browser coverage confirms
hits on that combined universe without adding instrumenter-specific coordinates.
Coverage targets remain unchanged.

Local browser validation uses the task-specific `tanah_e2e_4243` fixture database.
The shared `tanah_test` corpus no longer contained its required article/author
fixtures despite a previously successful population. Keeping this task's fixture
separate removes shared-database interference. Coverage and browser report
directories are excluded from Vite's watch
set: writing generated HTML must not reload an editor. The deployment-tool suite
uses four test processes to avoid Windows child-process contention; its original
process deadlines remain unchanged.
