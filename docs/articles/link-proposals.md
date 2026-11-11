# Article Link Proposals (#3103)

The LLM article-linking pipeline: it reads article content, infers
relationship candidates and produces **evidence-backed draft proposals** for
human review. Approved changes apply only through the typed relationship
contract (#3102). The lifecycle is deliberately one-directional:

```
generate → pending/held proposal → human review/edit → approve
        → validated apply → public relationship visible
```

## Hard guarantees

Generation **never**:

- publishes relationships or any other live data;
- marks coverage verified;
- rewrites article content;
- approves its own output (confidence is advisory, never a threshold);
- executes SQL — the model sees only a bounded target catalogue and its
  output is re-validated before anything is stored.

Rejection leaves live data untouched. Stale proposals never apply. A
human-edited patch (`review_patch_json`) stays separate from the model's
original target.

## Author attribution

Every article is uploaded for an explicitly selected author. That stored
attribution is authoritative context, never an inference target. The linking
pipeline must not guess, assign or replace an author, even when the article
contains a byline or an editor would review the suggestion.

The prompt excludes author targets, and validation turns model-authored
`author` suggestions into abstentions instead of storing drafts. Existing
author proposals can be rejected, but cannot be approved, including with a
human-edited patch. Previously approved author proposals cannot be applied.
Explicit author assignment during upload and manual attribution edits remain
available through their existing editor/API workflows.

## Generation engines

- **`heuristic` (default, offline)** — `buildHeuristicDrafts` extracts
  scripture citations from the article's plain-text view
  (`extractPlainText`), resolves them against the target catalogue and
  emits covering-source drafts with the citation as evidence. No network,
  deterministic.
- **`llm`** — sends a strict prompt (system: [src/lib/article-linking/prompt.ts])
  through the shared `callOpenAiJson` server caller (`OPENAI_API_KEY`,
  `OPENAI_MODEL`, server-side only). Output is parsed as JSON and run
  through `validateModelOutput`, which re-anchors evidence quotes in the
  plain text, resolves citation/entity mentions against the same bounded
  catalogue and demotes anything unresolvable, ambiguous, out-of-range or
  pending-schema to `held` instead of guessing.
- **`both`** — runs the two engines; their checkpoints are independent.

Checkpoints (`tanah_article_link_checkpoint`, keyed by
article+generator+prompt version+content hash) make re-generation of
unchanged input a no-op; `force: true` bypasses them and `dryRun: true`
validates without persisting.

## Storage

`tanah_article_link_proposal` (DDL in
`data/mysql/tanah_article_link_proposal_upgrade.sql`, lazily ensured by
`ensureLinkSchema`) is a **draft table only** — public consumers never
read it and generation never touches the live relationship tables. Each
row carries the normalized `target_json`, `target_label`, `evidence_json`
(plain-text quotes + UTF-16 spans), rationale, confidence, conflict,
status, dedupe/decision keys, generator/model/prompt-version provenance,
`base_content_hash` + `base_snapshot_json` (the state generation saw) and
the review/apply audit columns.

Statuses: `pending` → `approved` → `applied`; `held` (needs a human
patch), `rejected`, `stale` (content changed since generation). The
`dedupe_key` (`INSERT IGNORE`) prevents duplicate drafts across reruns;
`decision_key` supports future cross-run decision reuse.

## Apply path

`planProposalApply` (src/lib/article-linking/merge.ts) maps an approved
proposal to exactly one write:

- article-owned keys (`primaryPerek`, `coveringSources`) →
  `updateArticleRelationships` via `ARTICLE_API_KEY`
  (src/server/article-relationships-api.ts), carrying
  `expectedContentHash` and `expectedCoveringSources` freshness tokens so
  the API's own lock rejects a raced write;
- `dedicationAssignments` → the dedication aggregate workflow
  (`applyArticleDedicationLink`), preserving `expiresAt` semantics;
- legacy `author` proposals, `mentionAnnotations` (read-only) and
  pending-schema keys →
  `cannot-apply`, surfaced honestly.

Apply runs under the proposal's row lock; a content-hash change flips the
row to `stale`. A completed write whose marking step was lost is detected
by `alreadySatisfied` and recorded `already-applied` — retries are
idempotent.

## Admin surface

`/link-proposals` lists the queue with status filtering, evidence quotes,
conflict/held/stale banners and provenance; cards expose approve,
edit-and-approve (JSON patch, re-validated server-side), reject and —
post-approval — apply. The article edit page links into the filtered
queue; the nav entry sits beside מאמרים. `getLinkPipelineStatus` reports
contract version, LLM/API configuration and pending-schema keys.

## Module map

| Path | Role |
| ---- | ---- |
| `src/lib/article-linking/types.ts` | Proposal/snapshot/evidence contract |
| `html-text.ts` | Safe HTML→plain-text extraction (evidence anchors) |
| `hebrew-numerals.ts` | גמטריא parsing for citations |
| `citations.ts` | Citation tokenization (`בראשית יח, ב`, `שמואל ב ה, ז-ח`, …) |
| `catalogue.ts` | Bounded perek/dedication targets; authors supply current-attribution context only |
| `heuristic.ts` | Deterministic citation→covering-source drafts |
| `prompt.ts` | LLM prompt + schema instructions |
| `validate.ts` | Strict model-output validation/normalization |
| `merge.ts` | Approved proposal → single write plan |
| `src/server/article-link-pipeline.ts` | Server-side implementation (schema ensure, loaders, generation, review, apply) |
| `src/server/article-link-proposals.ts` | Server-fn surface — only RPC stubs reach the client |
| `src/server/llm-json.ts` | Shared OpenAI JSON caller (also used by the Tanahpedia assistant) |
| `src/server/article-relationships-api.ts` | #3102 GraphQL mutation caller (`ARTICLE_API_KEY`) |
| `src/server/editor-identity.ts` | Reviewer identity (Cognito sub / dev `local`) |
