# Golden set + evaluation harness (#2516)

Curated held-out cases for the mention-decoration pipeline plus the
scoring harness that measures any generator emitting
`tanahpedia_mention_decoration` contract rows. This is the issue's
"measured evidence" deliverable: the quality bar the encoder classifier
tier (AlephBERT / DictaBERT / BEREL) is compared against — not a claim
of production quality.

## What the set is (and is not)

The cases are **deliberately adversarial**: they concentrate on the
categories the issue requires — ordinary nouns, person/place/nation
ambiguity, multi-word names (hit and miss), fused prefixes, vocalized
text, qri/ktiv, alternate spellings, quoted scripture inside articles —
so the numbers describe **gap coverage**, not unbiased corpus accuracy.
Gold labels are curator judgments (type/name can differ from what the
baseline emits — that difference is what the harness measures).

## Files

| Path | Role |
| ---- | ---- |
| `golden/pesukim.json` | 20 pasuk cases keyed by `{sefer, additional?, perek (chapter), pasuk}`; each mention pins `start`/`end` segment indexes + readable `text`, `name`, `type` (+ optional `name_alternates`/`type_alternates`) |
| `golden/articles.json` | 12 article cases with authored HTML `content`; mentions pin `surface` (+ `occurrence`), `name`, `type`, and `expected: auto\|held` |
| `golden/metrics-baseline.json` | The recorded deterministic metrics for the pinned baseline revisions — regenerated via `--write`, enforced via `--check` |
| `golden/encoder-metrics/*.json` | Recorded encoder-comparison reports (one per candidate) — documented artifact, NOT a CI gate; model weights are not fetched in CI |
| `golden_eval.py` | Loader, gold→source resolution, scorer, report + CLI |
| `encoders.py` | Encoder adapter: HF token-classification → contract rows, candidate registry with pinned revisions + licenses, `detect` and `retype` (hybrid) modes, comparison CLI |
| `publish.py` | Publish stage: lexical detection → encoder re-type → the rows JSON `devops/import-tanahpedia-mentions.mts` upserts; model load stays opt-in (`entities_fn` injection) |
| `requirements-encoders.txt` | Optional torch/transformers pins for re-running the comparison and for `--retype` publish runs |
| `test_golden_eval.py` | Scoring/resolution unit tests (no corpus needed) |
| `test_golden_set.py` | Gold-vs-source consistency + recorded-metrics drift check |
| `test_encoders.py` | Adapter unit tests via injected fake `entities_fn`s (no torch needed) |
| `test_publish.py` | Publish-stage unit tests (same fake-injection pattern; one deterministic `--no-retype` corpus run) |

## Commands

```bash
cd data/annotations
python golden_eval.py            # run both domains, print the report
python golden_eval.py --out report.json
python golden_eval.py --check    # diff vs golden/metrics-baseline.json (CI)
python golden_eval.py --write    # re-record after a deliberate pipeline change
python -m unittest discover -p 'test_*.py'

# Encoder comparison (needs torch+transformers — see requirements-encoders.txt):
python encoders.py --list                              # candidates + licenses
python encoders.py --model dictabert-ner --out golden/encoder-metrics
python encoders.py --all --out golden/encoder-metrics  # regenerate the artifact

# Publish (the measured hybrid: lexical detect + dictabert-ner re-type;
# encoder run needs the same torch+transformers install):
python publish.py --pasuk-out /tmp/mentions-pasuk.json
python publish.py --articles /tmp/articles.json --article-out /tmp/mentions-article.json
python publish.py --pasuk-out p.json --no-retype       # deterministic lexical rows
node ../../devops/import-tanahpedia-mentions.mts --decorations /tmp/mentions-pasuk.json --dry-run
```

## Metrics (per the issue's acceptance list)

| Metric | Definition |
| ------ | ---------- |
| `precision` | rendered (`auto`/`manual`) predictions exactly span-matching a gold mention / all rendered predictions |
| `recall` | exact rendered matches / gold `auto` mentions |
| `detection_recall` | adds `held` predictions on the right span (detected but suppressed; `rejected` rows are explicit non-mentions and never count as detection) |
| `type_accuracy` (+ `_strict`) | correct `entity_type` among exact matches (alternates accepted / primary only) |
| `name_accuracy` (+ `_strict`) | correct `intended_name` among exact matches |
| `span_exactness` | exact-boundary pairs / all overlapping pred-gold pairs |
| `suppression` | gold `held` surfaces emitted `held` or not emitted (an `auto` render is a precision failure) |

Counts underneath (`tp`, `fp`, `fn`, `held_hit`, `held_correct`,
`held_noise`, `rendered_suppressed`, `suppressed_ok`, `rejected`,
`partial`) are reported per case, per category and per domain —
fragments of a missed compound name land in `partial` for diagnosis and
still count `fn`/`fp` under the strict span contract. When a predictor
emits duplicate rows at one span, the rendered (`auto`/`manual`) row
pairs with the gold — it decides what the page shows — while suppressed
duplicates stay diagnostics.

## Measured — lexical baseline `morphhb-*@3d15126f+contract1`

| Domain | precision | recall | det. recall | type acc | name acc | span exact | suppression |
| ------ | --------- | ------ | ----------- | -------- | -------- | ---------- | ----------- |
| pasuk  | 0.951 | 0.940 | 0.940 | **0.551** | 0.962 (0.936 strict) | 0.951 | n/a |
| article | 0.947 | 0.857 | 0.905 | **0.667** | 1.000 (0.944 strict) | 0.947 | 1.000 |

Runtime on a workstation: ~5 s for 20 pasuk cases, ~20 s for the article
domain (dominated by the one-time corpus gazetteer build), ≈530 MiB peak
traced allocations; the eval adds no model calls — the lexical tier is
deterministic lookup.

### Findings the encoder tier must beat

1. **Entity-type skew** (the big one): `type_accuracy` 0.55/0.67 —
   cities and lands (`בית אל`, `שכם`, `ירושלם`, `מדין`, `מואב`,
   `שנער`…) default to `PERSON`; gentilic-only `NATION` typing misses
   lands and nations-in-context (`ישראל` the nation). This is the
   measured form of the ~94% PERSON skew documented for the corpus run.
2. **Multi-word names without a lemma chain**: `אור כשדים`,
   `אלון מורה`, `בת שבע` fragment into separate predictions
   (`fn`+`fp`, `partial`) — morphhb only `+`-chains some compounds.
   `בית אל`/`באר שבע`/`מלכי צדק`/`אדני צדק` work because the chain
   exists upstream.
3. **Untagged divine names**: `אלהים` is not an Np token → `recall 0`
   on both Genesis cases (`fn` 2). Epithet/divine-name recall needs a
   lexicon tier beyond morphological tags.
4. **Name-form normalization bugs**: directive-ה survives into
   `intended_name` as `מצרימ/ה`, `חרב/ה`; a zero-width joiner inside
   `אלימלך` leaks into the name; ktiv spellings (`צביים`) become the
   intended name instead of the canonical read form (`צבוים`);
   `ירושלם` vs the entry key `ירושלים` — all visible as
   `name_accuracy_strict` < `name_accuracy` misses.
5. **Article over-holding on prefixed compounds**: `לבית־אל` is
   emitted `held` because the dominance check counts the fused
   first-word surface `לבית` against ordinary usage — the
   `detection_recall`–`recall` gap (0.905 vs 0.857) includes this
   `held_hit`.
6. **Gazetteer coverage floor**: `רשי` (rabbinic), `אור כשדים`
   (unchained compound) are out-of-vocabulary → `fn` — the pasuk-corpus
   gazetteer cannot cover names scripture never forms.
7. **What already works**: prefix stripping, vocalized quoted pesukim,
   anchor/script/style exclusion, and homograph suppression
   (`suppression` 1.000 — `מלך`/`אמר`/`שם`/`כבר`/`אכל`… held, never
   linked) all measure clean.

## Measured — encoder candidates (`encoders.py`)

The issue's next increment: plug candidate Hebrew encoders into the
same scorer and compare against the recorded baseline above. Two modes
are measured per candidate — `detect` (the encoder's NER output becomes
decoration rows end-to-end) and `retype` (morphhb detection stays the
candidate engine; the encoder only re-votes `entity_type`). Full
per-case/per-category reports live in `golden/encoder-metrics/*.json`,
recorded on torch 2.14.1+cpu + transformers 5.19.0.

### `detect` mode — encoder end-to-end

| Model | License | Domain | precision | recall | det. recall | type acc | name acc | span exact | suppression |
| ----- | ------- | ------ | --------- | ------ | ----------- | -------- | -------- | ---------- | ----------- |
| lexical baseline | — | pasuk | 0.951 | 0.940 | 0.940 | 0.551 | 0.962 | 0.951 | n/a |
| dictabert-ner (base) | CC-BY-4.0 | pasuk | 0.894 | 0.506 | 0.530 | 0.714 | 0.905 | 0.898 | n/a |
| dictabert-large-ner | CC-BY-4.0 | pasuk | 0.879 | 0.349 | 0.410 | 0.759 | 0.931 | 0.895 | n/a |
| alephbert-ner-community | **undeclared** | pasuk | 0.898 | 0.530 | 0.627 | 0.818 | 0.909 | 0.881 | n/a |
| lexical baseline | — | article | 0.947 | 0.857 | 0.905 | 0.667 | 1.000 | 0.947 | 1.000 |
| dictabert-ner (base) | CC-BY-4.0 | article | 0.895 | 0.810 | 0.857 | 0.882 | 0.941 | 0.900 | 1.000 |
| dictabert-large-ner | CC-BY-4.0 | article | 1.000 | 0.810 | 0.810 | 0.882 | 0.941 | 0.944 | 1.000 |
| alephbert-ner-community | **undeclared** | article | 1.000 | 0.571 | 0.714 | 0.917 | 0.917 | 1.000 | 1.000 |

### `retype` mode — morphhb detection + encoder typing (recommended)

| Model | License | Domain | precision | recall | det. recall | type acc | name acc | span exact | suppression |
| ----- | ------- | ------ | --------- | ------ | ----------- | -------- | -------- | ---------- | ----------- |
| dictabert-ner | CC-BY-4.0 | pasuk | 0.951 | 0.940 | 0.940 | **0.654** | 0.962 | 0.951 | n/a |
| dictabert-large-ner | CC-BY-4.0 | pasuk | 0.951 | 0.940 | 0.940 | 0.641 | 0.962 | 0.951 | n/a |
| alephbert-ner-community | **undeclared** | pasuk | 0.951 | 0.940 | 0.940 | **0.718** | 0.962 | 0.951 | n/a |
| dictabert-ner | CC-BY-4.0 | article | 0.947 | 0.857 | 0.905 | **0.889** | 1.000 | 0.947 | 1.000 |
| dictabert-large-ner | CC-BY-4.0 | article | 0.947 | 0.857 | 0.905 | **0.889** | 1.000 | 0.947 | 1.000 |
| alephbert-ner-community | **undeclared** | article | 0.947 | 0.857 | 0.905 | 0.833 | 1.000 | 0.947 | 1.000 |

### What the numbers say

1. **Detection is the encoder's weak side, not typing.** Raw NER recall
   is 0.35–0.53 on pesukim: modern-Hebrew models miss fused-prefix
   names, gentilics, qri/ktiv variants and the untagged divine names
   (`fn` concentrated in `ambiguity`, `gentilic`, `prefixes`,
   `qri-ktiv`, `multi-word` — the same categories the gold set weights
   by design). morphhb's recall (0.94) is effectively free and
   systematic — keep it as the candidate engine.
2. **Typing is exactly the encoder's strength.** `retype` keeps every
   baseline number identical (same spans, names, acceptance — the
   scorer confirms p/r/span/name byte-for-byte) while lifting
   `type_accuracy` from **0.551→0.654** (pasuk) and **0.667→0.889**
   (article) with the *base* DictaBERT. The large variant adds nothing
   (0.641/0.889) — base wins on size too (~110M vs ~340M params).
3. **Recommendation: ship morphhb detection + DictaBERT-NER re-typing
   (`dictabert-ner`, CC-BY-4.0 — attribution required).** The community
   AlephBERT head types pasuk better (0.718) but its repo declares **no
   license — it cannot ship**; it sets an upper bound worth chasing
   only if a licensed head appears.
4. **BEREL could not be scored**: `dicta-il/BEREL` is fill-mask only —
   no published token-classification head. Its license is clean
   (**Apache-2.0**, better than the CC-BY the design doc expected), so
   a fine-tune on labeled Tanahpedia data stays a viable future leg.
5. **What retype does NOT close** (still on record): pasuk `type_acc`
   0.65 — misses concentrate on `qri-ktiv` (1/8 — ktiv spellings
   confuse the model) and `spelling`; the `recall-gap` `אלהים` cases
   stay `fn` (the encoder votes MISC → abstains → lexical PERSON
   stands, which the gold actually accepts). Residual ambiguity is the
   documented next-tier question (LLM/fine-tune), per the issue
   phasing.

### Encoder runtimes (CPU, measured on this workstation)

| Mode | pasuk eval | article eval |
| ---- | ---------- | ------------ |
| detect | ~29 s (per-pasuk inference over 20 perakim) | ~1 s |
| retype | ~38 s (adds the lexical pass) | ~1 s |

Python-traced allocation peak ~0.8 GiB (torch native tensors are
outside tracemalloc; weights on disk: base ≈0.4 GB, large ≈1.3 GB).

## Adding a case

- Pasuk: pick the pasuk by `{sefer, additional?, perek, pasuk}`; pin
  `start`/`end` to the canonical segment indexes and set `text` to
  `normalize_name` of the joined values (the consistency test re-derives
  it). Use `name`/`type` for the curator answer and
  `*_alternates` only for genuine taxonomy/spelling ambiguity.
- Article: author minimal realistic HTML in `content`; pin `surface`
  (exact substring, `occurrence` when repeated) and `expected: held`
  for homographs that must never render.
- Every used `categories` value must be declared in the file's
  `categories` map; the tests enforce coverage and declaration.
