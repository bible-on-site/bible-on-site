# Tanahpedia noun/entity annotation pipeline — research and design (#2516)

Local NLP decoration of perakim/pesukim and articles with **intended**
Tanahpedia entry references — independent of whether the target entry
exists today. This document is the issue's research deliverable: source
and model evaluation, the selected architecture, and the data contract.
The pipeline itself lives under `data/annotations/` (to be populated by
this implementation).

## The three responsibilities (per the user's clarification)

1. **Offline expensive inference** — recognize/classify mentions, persist
   intended target names/types + exact source spans. Never gated on
   whether the entry exists in the live database.
2. **Cheap live resolution** — bulk-resolve intended keys against the
   current entry database at presentation time.
3. **Render** — dashed-underline + valid href **only** when a usable entry
   resolves; otherwise plain text, no dangling link semantics.

Creating an entry later must activate existing decorations with **zero**
model re-invocation; deleting/unpublishing must revoke them the same way.

## Source and model evaluation

| Candidate | License | Domain fit | Verdict |
| --------- | ------- | ---------- | ------- |
| **ETCBC BHSA** (`github.com/ETCBC/bhsa`, Text-Fabric) | **CC BY-NC 4.0** | The only corpus with full Biblical-Hebrew morphological annotation (POS, morphology, phrase function, qri/ktiv) | **Evaluation baseline only.** Non-commercial clause makes it unusable as a production derivation source without a license determination; its underlying text is BHS, not our Sefaria-sourced canonical text, so word-boundary alignment needs reconciliation. Text-Fabric tooling itself is MIT. Where the corpus *can* legally help: measuring baseline accuracy on Biblical Hebrew without shipping its annotations. |
| **AlephBERT** (`OnlpLab/AlephBERT`, HF `onlplab/alephbert-base`) | **Apache-2.0** | Modern Hebrew; evaluated on SPMRL/UD treebanks incl. POS, morphological segmentation, NER | **Primary neural candidate for article (rabbinic/modern) Hebrew.** Clean license, published benchmark suite, morphological-extraction head designed for Hebrew's fused prefixes — directly useful for stripping ב/ל/מ/ש/ו/ה/כ prefixes before name resolution. |
| **DictaBERT** family (`dicta-il`) | **CC BY 4.0** | Modern Hebrew; `dictabert-morph` is a dedicated morphological analyzer; **BEREL** targets Rabbinic Hebrew specifically | **Strong candidate, best domain coverage for articles** (BEREL is literally trained on rabbinic corpora). Attribution required — acceptable, same class as our other sourced data. Verify BEREL's exact model-card license before pinning. |
| **HeBERT** | Apache-2.0 (check per-variant) | Modern Hebrew, older | Superseded by DictaBERT/AlephBERT on the same benchmarks — no reason to pick it. |
| **Multilingual mBERT** | Apache-2.0 | Weak on Hebrew morphology | Baseline floor only; AlephBERT paper documents it underperforms dedicated Hebrew models. |
| **Local LLM (instruct) hybrid** | model-dependent (e.g. Gemma/Llama licenses) | Can classify ambiguous mentions with context | Reserved for the ambiguity tier **if and only if** the deterministic+encoder path misses the quality bar — per issue, evaluate dedicated classifiers first. No API calls; everything pinned and local. |
| **Deterministic lexical baseline** (our lexicon + morphology stripping) | n/a | Both domains | **Required first stage regardless** — it is the quality floor the neural approaches must beat, and it is nearly free: segment → strip prefixes → lemma candidates → type classify. |

### Domain split (per issue)

- **Scripture (Biblical Hebrew)** — vav-consecutive, archaic forms,
  taamim/niqqud present, qri/ktiv. No clean-license annotated corpus
  exists; the plan is a morphology-first pipeline (strip prefixes,
  canonicalize niqqud/taamim/maqaf for the *matching view only*) plus a
  Biblical-name lexicon built from our own Tanahpedia + canonical data —
  seeded from existing `tanahpedia_entity_tanah_source` rows (they are
  already human-curated mentions, i.e. free training/eval labels).
- **Articles (rabbinic/modern Hebrew)** — BEREL/DictaBERT-morph +
  AlephBERT NER territory; quoted verses inside articles are detected and
  routed through the scripture path.

## Pipeline architecture (mirroring `data/recitation/`)

```
canonical sources (perakim JSON / article HTML + revision)
   │
   ├─ matching-view normalization (strip niqqud/taamim/maqaf,
   │  resolve qri/ktiv to spoken+written forms, map offsets back
   │  losslessly to the original span)
   │
   ├─ stage A: candidate extraction
   │    sentence/segment split → nominal filter → span candidates
   │    (lexical baseline + morphological analyzer)
   │
   ├─ stage B: mention classification
   │    candidate → EntityType | OTHER + intended name
   │    (lexicon lookup → encoder classifier → optional LLM tie-break)
   │
   ├─ gate: acceptance rules on measured confidence
   │    accepted decorations | held diagnostics | rejected
   │
   └─ publish: versioned decoration rows (contract below),
      resumable checkpoints keyed by (source hash, model revision,
      config hash) — entry creation NEVER invalidates
```

Properties carried over from the recitation pipeline (`PIPELINE.md`):

- **Pinned provenance**: model revisions, config hash and source hash on
  every artifact; caches keyed by the same triple.
- **Resumable bounded units**: one perek/article per work unit,
  checkpointed; reprocessing touches only changed sources.
- **No model calls at render time** — presentation is pure lookup.
- **Separation of candidates/accepted/held** with a publication gate —
  same shape as recitation's accept-vs-hold split.
- **Preservation**: re-runs never clobber manual accept/reject decisions
  or previously accepted rows for unchanged sources.

## Decoration contract (versioned)

The existing link contract is `tanahpedia_entity_tanah_source`
(`entity_id`, `perek_id`, `pasuk_number`, `segment_start`, `segment_end`
0-based inclusive). The pipeline needs a sibling contract keyed by
*intended name* rather than `entity_id`:

| Field | Meaning |
| ----- | ------- |
| `source_kind` | `pasuk` \| `article` |
| `perek_id`, `pasuk_number`, `segment_start`, `segment_end` | canonical coordinates for scripture mentions (same semantics as the existing table) |
| `article_id`, `content_hash`, `span_start`, `span_end` | article mentions: **UTF-16 code-unit** offsets into `tanah_article.content` at `content_hash` (the unit JavaScript string indexing uses; BMP-only content makes them equal code-point offsets) — the hash is the staleness key since the article row carries no revision column |
| `surface` | exact original mention text (no normalization of stored data) |
| `intended_name` | the entry's intended `unique_name`/resolution key — indexed, deliberately not an FK |
| `entity_type` | one of the 13 `entity_type` enum values in `tanahpedia_entity` |
| `disambiguation` | optional context key matching the synonym-disambiguation model |
| `confidence` / `acceptance` | measured score; `acceptance` ∈ `auto` \| `manual` \| `held` \| `rejected` |
| `model_revision`, `source_hash`, `contract_version` | provenance |

Landed as `tanahpedia_mention_decoration` — see
`data/mysql/tanahpedia_structure.sql` (fresh schema) and
`data/mysql/tanahpedia_alter_mention_decoration.sql` (idempotent upgrade).

Deliberately **no `entity_id`/`entry_id` FK** — the decoration must
survive the target not existing (the issue's core requirement). The live
resolver maps `intended_name` → `tanahpedia_entry.unique_name` (plus
synonym aliases and disambiguation labels) at presentation time and only
then derives the link target.

### Live resolver sketch

- Bulk indexed lookup per rendered unit: collect all `intended_name`s on
  the page → one `IN (...)` query over entry+synonym names → resolve to
  entry IDs → apply existing visibility/draft rules → emit the same
  `PerekEntityReference` shape `getEntityReferencesForPerek` already
  returns, so the verse renderer needs no new affordance.
- Invalidation hooks on entry create/rename/publish/unpublish/delete —
  piggyback on the existing content lifecycle rather than a static bake.
- Missing/other-targeted mentions render as plain text (requirement 3).

## Golden set and metrics (acceptance mapping)

- **Golden cases**: ordinary non-entry nouns, genuine OTHER, person/place
  ambiguity (e.g. בן-גבריו-style name collisions), multi-word names,
  morphological prefixes, vocalized vs unvocalized, qri/ktiv, mixed
  article text with quoted scripture.
- **Metrics per the issue**: runtime, RAM/VRAM, throughput,
  precision/recall, type accuracy, span accuracy, target-name accuracy —
  all measured on held-out perakim/articles and recorded with the pinned
  model revision.
- **Lifecycle regression (mandatory)**: infer+publish mention → absent
  entry → plain render → create entry → dashed link appears → unpublish →
  plain again. Model invocation count constant throughout.
- **Storage measured on the lexical baseline** (full corpus, pasuk
  domain): 35,176 decorations across 929 perakim, 3,155 distinct
  `intended_name`s, ≈ 400 B/row as JSON → ≈ 14 MB payload, ≈ 7 MB
  estimated as normalized table rows. At this scale per-perek
  `IN (...)` resolution stays trivially indexed; no storage-driven
  format compromise is needed.
- **Baseline runtime**: 2.4 s for the entire corpus on a workstation —
  the lexical tier is effectively free; it costs zero model calls.
- **Measured baseline limitation**: 94 % of decorations classify
  `PERSON` (33,045 / 35,176; `NATION` 1,802, `PLACE` 329) — place names
  like מצרים and ירושלם default to `PERSON`, and genuine
  person/nation ambiguities (ישראל, יהודה) collapse onto one type.
  This is the quantified gap the encoder/LLM tier must beat on the
  golden set; do not ship the lexical tier's type accuracy as-is.

## Open decisions recorded for implementation

1. **BEREL license confirmation** on its exact model card (CC-BY
   expected; pin only after verifying).
2. **BHSA legal position** — keep it strictly out of shipped artifacts
   (eval-only) unless a license determination says otherwise.
3. **Encoder vs LLM tier for ambiguity** — decided by the measured
   golden-set gap after the lexical+encoder baseline lands, not before.
4. **`segment_*` vs character offsets for articles** — articles have no
   canonical segmentation; `span_start/span_end` are character offsets
   into the stored content with the revision hash as the staleness key.

## Status

Shipped increments on `feat/2516-tanahpedia-annotation`:

- Decoration contract: `tanahpedia_mention_decoration` (migration +
  canonical structure SQL).
- Pinned morphhb extractor (`extract_morphhb.py`) + compact gzipped
  derived artifact (`morphhb-proper-nouns.json.gz`, 35,898 tagged
  tokens, digest-pinned `--check`/`--refresh`).
- Deterministic lexical baseline (`baseline.py`) emitting contract
  decoration rows — full-corpus numbers above.
- Idempotent importer (`devops/import-tanahpedia-mentions.mts`)
  keyed on `dedupe_key` — re-runs never duplicate or clobber manual
  decisions.
- Live resolver (`getMentionReferencesForPerek` in the Tanahpedia
  service) + merged refs + `tanahpedia-mention-refs` cache tag wired
  into entry-lifecycle invalidation; unit-tested including the
  create-entry-makes-link-appear lifecycle regression.
- Article-domain spans: `devops/export-tanahpedia-articles.mts` emits
  raw article HTML; `baseline_articles.py` matches the pasuk-derived
  gazetteer inside HTML text runs (longest match, fused-prefix
  stripping, `<a>`/`<script>`/`<style>` interiors excluded, ordinary-
  word-dominated homographs emitted as `held`) and stamps each row with
  the `content_hash` staleness key.
- Article live resolution: `getMentionReferencesForArticle` joins on
  `content_hash` so edited articles degrade to plain text;
  `decorateArticleContent` + `decorateArticleHtml` inject resolved
  anchors into stored HTML before DOMPurify on both render paths
  (standalone `/929/[perek]/[slug]` and the in-book `ArticleFullView`),
  integrity-checking `surface` against the stored bytes and refusing
  spans inside existing anchors. Covered by unit tests plus e2e
  fixtures (`tanah_mention_test_data.sql`, loaded after the Tanahpedia
  seed chain) proving resolved→link and unresolved→plain.
- Golden-set harness (`data/annotations/golden_eval.py` +
  `golden/`): 20 curated pasuk cases + 12 authored article cases
  covering every category the issue lists, scored for precision,
  recall, detection recall, type/name/span accuracy and `held`
  suppression, with per-category breakdowns and a deterministic
  metrics record (`golden/metrics-baseline.json`) enforced by
  `--check`. The scorer is predictor-agnostic — the encoder tier
  plugs in via the same contract row shape. Measured results and the
  concrete findings (type-skew 0.55/0.67, unchained multi-word
  fragmentation, untagged divine-name recall, name-form
  normalization bugs, gazetteer coverage floor, prefixed-compound
  over-holding) are documented in `data/annotations/GOLDEN.md` —
  they are the bar the encoder comparison must beat.

Remaining sequence: encoder classifier comparison (BEREL license
check first) against the golden-set bar → production import of the
published pasuk + article baseline rows.
