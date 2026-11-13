# Independent provisional validation set

These labels were frozen on 2026-11-11 before inspecting classifier or LLM
outputs for these cases. They are **agent-curated and have not received
human editorial review**. They support reproducible comparisons and expose
scope gaps; they do not establish unbiased corpus accuracy or production
readiness.

- `pesukim.json`: 20 canonical verses, with no coordinate overlap with the
  original development cases. Labels cover multiple books, people,
  territories/nations, repeated mentions, alternative spellings, qri/ktiv
  context, a snake mention and an ordinary-prose negative case. The file
  records the canonical source digest; segment labels are verified against
  the stored source bytes.
- `articles.json`: 12 independently authored HTML fragments. They cover
  the full 13-type supported entity taxonomy, non-biblical names, compound mentions,
  prefixes, homographs, excluded existing anchors/scripts/styles, astral
  Unicode and ordinary prose. Explicit identified concepts such as the
  menorah (`TEMPLE_TOOL`), the creation event and a named prophecy are positive targets;
  an unspecified utensil or table is ordinary prose.

Divine names use `PERSON` to preserve the existing benchmark convention.
Spelling and nation/territory alternatives are explicit. A target name is
an intended encyclopedia key, independent of whether an entry exists.
Labels that require editorial taxonomy or naming decisions remain
provisional; review them before drawing a production conclusion.
The menorah's initial generic `OBJECT` label was corrected to the existing
`TEMPLE_TOOL` taxonomy before inspecting inference outputs.

Select models using **`link_precision`, `link_recall` and `link_f1`**: exact
span, correct entity type and correct intended name must match together.
The older `precision`/`recall` metrics measure detection only and can be
high even when links target the wrong entity. Strict joint metrics are
also recorded to show the effect of accepted alternatives.

```bash
python data/annotations/golden_eval.py \
  --gold-dir data/annotations/golden/validation --out validation-baseline.json
```

Keep this set separate from the original development cases. Once outputs
have been inspected, treat it as a regression/validation set and collect a
new human-reviewed holdout for the next independent generalization claim.
Do not silently relabel cases to favor a model.
