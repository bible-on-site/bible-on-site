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
| `golden_eval.py` | Loader, gold→source resolution, scorer, report + CLI |
| `test_golden_eval.py` | Scoring/resolution unit tests (no corpus needed) |
| `test_golden_set.py` | Gold-vs-source consistency + recorded-metrics drift check |

## Commands

```bash
cd data/annotations
python golden_eval.py            # run both domains, print the report
python golden_eval.py --out report.json
python golden_eval.py --check    # diff vs golden/metrics-baseline.json (CI)
python golden_eval.py --write    # re-record after a deliberate pipeline change
python -m unittest discover -p 'test_*.py'
```

## Metrics (per the issue's acceptance list)

| Metric | Definition |
| ------ | ---------- |
| `precision` | `auto` predictions exactly span-matching a gold mention / all `auto` predictions |
| `recall` | exact `auto` matches / gold `auto` mentions |
| `detection_recall` | adds `held` predictions on the right span (detected but suppressed) |
| `type_accuracy` (+ `_strict`) | correct `entity_type` among exact matches (alternates accepted / primary only) |
| `name_accuracy` (+ `_strict`) | correct `intended_name` among exact matches |
| `span_exactness` | exact-boundary pairs / all overlapping pred-gold pairs |
| `suppression` | gold `held` surfaces emitted `held` or not emitted (an `auto` render is a precision failure) |

Counts underneath (`tp`, `fp`, `fn`, `held_hit`, `held_correct`,
`held_noise`, `rendered_suppressed`, `suppressed_ok`, `partial`) are
reported per case, per category and per domain — fragments of a missed
compound name land in `partial` for diagnosis and still count `fn`/`fp`
under the strict span contract.

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
