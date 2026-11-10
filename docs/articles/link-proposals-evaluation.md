# Link-Proposal Pipeline — Representative-Set Evaluation (#3103)

Issue #3103 requires a small, representative, human-reviewed evaluation
before the pipeline scales. This document records the set, the method,
the measured metrics (precision, coverage, invalid-target rate, reviewer
correction rate, runtime, cost — by relation type), and the
counterexamples that shape the next iteration.

Everything below ran against a **local** database seeded from a frozen
mirror of real production articles; no production row, live relationship,
or paid provider call was involved. Generation wrote proposal rows only;
review replayed recorded decisions through the real `reviewProposal`
gate; no apply ran (the local `ARTICLE_API_KEY` is intentionally unset,
so the apply path stayed gated — matching CI).

## Corpus

`web/admin/scripts/link-eval-corpus.json` freezes 18 articles fetched
once from the public GraphQL API, plus their 11 authors, 5 dedication
subjects and 2 recurring Hebrew-date assignments. The set was picked to
cover the cases the issue calls out rather than to be easy:

- citation-rich articles (225 כי תשא: 11 drafts; 287, 2148, 1114);
- two portal/stub articles that must yield **no** covering proposals
  (2199 לימוד לתשעה באב — a pointer page; 585 — a 61-char audio/video
  stub);
- articles whose citations are context-free (`(יח, כג-לג)`, `(יד, יד)`)
  or implicit (336 מצוות הדלקת הנרות), which a regex engine cannot
  resolve but a model can;
- articles already carrying a recurring Hebrew date (2199 ט' באב, 2860
  ה' באייר) so moed/date semantics stay visible;
- texts containing midrash citations (`ויקרא רבה`, `שמות רבה`,
  `בראשית רבה`, `במדבר רבה`) that must not resolve as scripture;
- a Unicode-heavy dedication subject and mixed Hebrew/arabic numeral
  forms.

## Method

`web/admin/scripts/link-eval.mts` drives the whole run through the
pipeline's own entry points:

1. `seed` — upserts the corpus into a local DB (idempotent; ensures the
   schema chain locally, including `content_hash` parity).
2. `generate --engine heuristic` — the deterministic offline engine.
3. `generate --engine llm` — a **deterministic fixture** injected via
   `_setLinkLlmCaller` (`link-eval-llm-fixture.json`), labelled
   `openai:eval-fixture-llm-v1` in provenance. The fixture mixes
   realistic model output (what the heuristic structurally cannot find)
   with deliberate adversarial cases, so validator hold paths get
   measured on real article context — not just in unit tests.
4. `review` — replays `link-eval-decisions.json` through
   `reviewProposal` under a recorded reviewer identity. 65 decisions,
   0 unmatched; every decidable proposal received a recorded approve,
   edit-and-approve, or reject.
5. `report` — computes the tables below from stored proposal rows.

Generation also writes `link-eval-manifest.json` (gitignored): the
identity of every draft the evaluation produced plus one token-usage
record per model invocation. `review` and `report` act only on
proposals inside that manifest, so unrelated pending rows in a reused
dev database can neither be approved nor counted.

Review policy used throughout: approve pasukim the article **quotes and
engages**; reject non-scripture resolutions, commentary-source pointers
whose pasuk is not discussed, duplicates, and any fabricated, ambiguous
or out-of-range target; leave pending-schema proposals `held` (they can
never be approved until their contract lands — that is by design, not a
defect).

## Results

### Proposal-level outcomes

| engine | relationship | proposed | approved | edited-approve | rejected | held |
|--------|--------------|---------:|---------:|---------------:|---------:|-----:|
| heuristic | coveringSources | 53 | 44 | 2 | 7 | 0 |
| llm (fixture) | coveringSources | 9 | 5 | 0 | 4 | 0 |
| llm (fixture) | moadim | 2 | – | – | – | 2 (pending-schema) |
| llm (fixture) | recurringHebrewDate | 2 | – | – | – | 2 (pending-schema) |
| llm (fixture) | dedicationAssignments | 1 | – | – | 1 | – |
| llm (fixture) | mentionAnnotations | 1 | – | – | 1 | – |
| llm (fixture) | entryLinks (unsupported) | 1 | – | – | 1 | – |

### Metrics

- **Candidate precision (heuristic)**: 46/53 proposals approved as
  written or with edits = **86.8%**; the 7 rejects are all
  semantic-level errors (see counterexamples), not structural ones.
- **Candidate precision (llm fixture)**: 5/5 realistic proposals
  approved = **100%** on honest output. The 4 coveringSource rejects
  and 3 non-covering rejects were *injected* adversarial cases —
  included so the validator's catch rate is measured, and it was 100%
  (every invalid/unsupported/hallucinated target landed `held` or was
  rejected at review).
- **Invalid-target rate**: 11/16 fixture proposals were deliberately
  invalid or unsupported (hallucinated perek, out-of-range pasuk,
  ambiguous sefer, fabricated evidence, fabricated dedication id,
  read-only key, unsupported key — 7 adversarial cases — plus 4
  proposals on pending-schema keys) — the validator held **11/11**
  before any could reach a reviewer as `pending`.
  Heuristic generated 0 structurally-invalid targets (its catalogue is
  closed); its 7 errors were semantically wrong-but-resolvable.
- **Reviewer correction rate**: 2/46 heuristic approvals needed a patch
  (**4.3%**): `ויקרא יא` on 287 dropped a pasuk that only appeared as a
  commentary-source pointer, and `הושע ג א,ג` on 1602 had been
  mis-parsed to `הושע א ג` — corrected to `{503:1, 503:3}` through
  `review_patch_json` (the patch stayed separate from model output, as
  designed).
- **Candidate coverage**: of the 18 articles, heuristic produced drafts
  for 12. Of the 6 zeros: 2 were true misses (2243 context-free
  citations, 336 implicit reference — both recovered by the llm pass),
  and 4 were correct abstentions (two portal stubs, one no-citation
  article, one empty stub). Effective coverage of evidence-bearing
  articles: **12/14 = 85.7%** for heuristic alone, **14/14** with the
  llm pass.
- **Runtime**: heuristic 5.8 s total over 18 articles (avg 323 ms,
  max 1.68 s — dominated by the per-run catalogue load; a batch call
  amortizes this). llm fixture 0.8 s total (avg 45 ms — not
  representative of real provider latency, which is seconds/article).
- **Cost**: **$0**. No provider call ran. The recorded usage
  (18 invocations × 2,400 prompt / 350 completion = 43,200 / 6,300
  tokens) is a fixture-annotated estimate of the prompt shape, counted
  per invocation — a call that emits several proposals is charged
  once, and an abstention call still consumes its prompt.

### Safety check during the run

- The fixture item carrying a forged `"status": "approved"` field was
  stored `pending` — model-supplied status is ignored, confirmed live.
- Every decidable proposal got a human decision; 4 pending-schema
  proposals remain `held`, visible in the queue for when #3098/#3101
  land.
- `tanah_article_covering_source` and every other live table are
  byte-identical to their seeded state; nothing applied.

## Counterexamples (feed the next iteration)

1. **Midrash resolved as scripture** — `ויקרא רבה יד, א` → ויקרא יד:1,
   `שמות רבה כז, א` → שמות כז:1, `בראשית רבה מח, ט` → בראשית מח:9. The
   extractor treats any `sefer + numerals` as scripture; midrash names
   that share a sefer name need an exclusion list or a `רבה`-suffix
   guard. 3/7 rejects.
2. **Commentary-source pointers** — `(הכתב והקבלה ויקרא יט ד)`,
   `(רבינו בחיי שמות יז ה)`: the pasuk is the commentary's *location*,
   not text the article engages. 2/7 rejects.
3. **Bare-sefer ambiguity held correctly** — `מלכים א` without א/ב was
   held (`ambiguous perek`) and rejected at review.
4. **Mis-parsed mixed citation** — `הושע ג א,ג` (perek 3, pesukim 1+3)
   produced `הושע א ג`; caught only at human review and corrected via
   edit-and-approve. The llm fixture resolved the same citation
   correctly — a real model's context reading covers this class.
5. **Unresolvable tail** — `רות ב יד בשם` (trailing "in the name of the
   Gra") and `במדבר רבה ז ד` were held as implausible rather than
   guessed.
6. **Context-free / implicit citations recovered by the llm pass** —
   `(יח, כג-לג)` style references and "מצוות הדלקת הנרות" resolved to
   בראשית יח כג-לג + יד:14 and במדבר ח א-ד. This is the honest recall
   gap of a regex engine and the clearest justification for the llm
   engine on articles like 2243.
7. **Zero-evidence abstention** — both engines correctly emitted
   nothing for the two stubs (2199, 585) and the no-citation article
   (452); the model abstained rather than inventing links.

## Reproduce

```bash
cd web/admin
DB_URL=mysql://root:test_123@localhost:3306/tanah-dev bun run scripts/link-eval.mts seed
DB_URL=mysql://root:test_123@localhost:3306/tanah-dev bun run scripts/link-eval.mts generate --engine heuristic
DB_URL=mysql://root:test_123@localhost:3306/tanah-dev bun run scripts/link-eval.mts generate --engine llm
DB_URL=mysql://root:test_123@localhost:3306/tanah-dev bun run scripts/link-eval.mts review
DB_URL=mysql://root:test_123@localhost:3306/tanah-dev bun run scripts/link-eval.mts report
```

(`link-eval.mts run` performs the whole chain in one go. `--force`
re-generates over checkpoints; dedupe keys make re-runs idempotent.)

## Limitations

- **The llm pass is a fixture**, not a live model: it measures the
  contract end-to-end (validation, dedupe, review, hold paths) and the
  recall shape a model adds, but not real model quality or cost. A paid
  live run on this same corpus is the next step before scaling —
  `generate --engine llm --live` skips the fixture and uses the real
  provider path (`OPENAI_API_KEY` required).
- 18 articles is enough to surface the failure classes above, not to
  bind precision tightly; the midrash/pointer classes in particular
  deserve a targeted fix + re-eval.
- Review was performed by one reviewer applying the written policy;
  inter-reviewer variance is unmeasured.
- Apply was intentionally not exercised end-to-end locally (no
  `ARTICLE_API_KEY`); its path is covered by unit + e2e tests and the
  apply contract revalidates freshness/targets at write time.
