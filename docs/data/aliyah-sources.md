# Aliyah boundary data — source audit (#2519)

This doc records what was checked, what was chosen, and what the curated
`web/bible-on-site/src/data/parasha/parasha-aliyot.json` covers. Regenerate
the table with `node devops/import-parasha-aliyot.mjs`; `--check` is the
drift gate.

## Candidates evaluated

| Source                                                                                                                  | Result                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sefaria** `/api/sheets/{parasha}/get_aliyot` | Correct shape — 8 refs: seven aliyot + a repeated-tail 8th (maftir). But the endpoint is **incomplete**: it 500s on `Acharei-Mot-Kedoshim`, `Nitzavim-Vayelech`, `Ki Tisa`, `Acharei Mot`, `Vayeilech`, and others (both hyphenated and underscored slugs tried). Usable only as corroboration. |
| **Hebcal** `@hebcal/leyning` [`src/aliyot.json`](https://github.com/hebcal/hebcal-leyning)                              | **Chosen as the base.** BSD-2-Clause license, all 54 standalone parashot + all 7 joined readings (61 entries), `fullkriyah` aliyot 1–7 with explicit `M` maftir, `weekday` 3-aliyah splits on standalone readings, and inline `some sources use …` variant notes (parsed into `alternatives`).   |
| **OpenTorah** [`texts/.../tanach/ot-*.xml`](https://github.com/opentorah/opentorah)                                     | **Chosen for alternatives.** Apache-2.0; per-parasha `<day>` boundaries with explicit `custom` marks (Chabad, Ashkenaz) plus an independent weekday `<aliyah>` division. Diffed against the base to emit structured per-minhag `alternatives`.                                                   |
| `@hebcal/triennial`                                                                                                     | Out of scope by the source's own design — triennial cycles moved to a separate package. Not imported; the weekly cycle is what the פרשה division serves.                                                                                                                                        |

### Cross-validation

Every parasha Sefaria actually serves was spot-compared against the Hebcal
table — **identical** on all of them (`Pinchas`, `Emor`, `Bereshit`,
`Vayakhel`, `Pekudei`, `Vayakhel-Pekudei`, `Tazria-Metzora`,
`Behar-Bechukotai`, `Chukat-Balak`, `Matot-Masei`, `Nitzavim`). Where
Sefaria 500s, the Hebcal data is the only complete option; its boundaries
still resolve cleanly against our canonical corpus.

## Pinned provenance

- **Name**: `@hebcal/leyning — src/aliyot.json`
- **Repository**: <https://github.com/hebcal/hebcal-leyning>
- **License**: BSD-2-Clause
- **Commit**: `ec5c7642e3`
- **Retrieved**: 2026-10-23
- **Alternatives source**: OpenTorah `ot-*.xml` — <https://github.com/opentorah/opentorah>, Apache-2.0, commit `7308989643`

The upstream files are vendored verbatim at the pinned commits in
`devops/data-sources/` (`hebcal-leyning-aliyot.ec5c7642e3.json` and
`opentorah-tanach-aliyot.7308989643.json`, the latter extracted per
parasha from the five book XMLs) — the import runs offline and
deterministically; `--refresh` re-fetches upstream. Provenance is also
stored verbatim in the JSON's `provenance` block and exported to
SQLite (`tanah_parasha_aliyah_source`, single row `id=1`); each
alternative row carries a `source` field naming the upstream that
records it.

## Alternative divisions

Two kinds are imported, both as structured `alternatives` ranges on
the aliyah they vary — never free-text notes:

- **Minhag variants** on the Shabbat seven. OpenTorah marks custom
  day boundaries explicitly: חב"ד (ויגש עליות 3–5, נשא 6–7, דברים 1–2)
  and אשכנז (מטות-מסעי joined 4–5, where the base uses the general
  joined split at לג:נ). OpenTorah's *Common* division differs from
  the base on תרומה (עליות 2–3 — the מנורה boundary) and מסעי (עליות
  1–3 — מסעות in עליה א); both are the documented עדות המזרח
  convention and carry that `custom` label.
- **Weekday alternatives.** OpenTorah's weekday `<aliyah>` division
  differs from the base on לך לך, שמיני, נשא, מסעי, and דברים —
  emitted as unattributed alternatives (the source assigns no minhag
  to weekday splits).

Applicability markers: חוקת-בלק joins in חוץ לארץ *and* under מנהג
תימן הבלדי (בלדים join it instead of מטות-מסעי, per דעת/מאורות
sources on the Baladi cycle); מטות-מסעי is conversely never joined by
בלדים.

## Coverage matrix

| Scope               | Coverage                       | Notes                                                                                                                                                                  |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone parashot | 54/54                          | Shabbat 7 + maftir each, except וזאת הברכה (7, no maftir — read on שמחת תורה).                                                                                         |
| Joined readings     | 7/7                            | ויקהל-פקודי, תזריע-מצורע, אחרי מות-קדושים, בהר-בחוקותי, חוקת-בלק, מטות-מסעי, נצבים-וילך — each with its own seven-aliyah split (never concatenated standalone halves). |
| Schemes             | `shabbat` (7+M), `weekday` (3) | Weekday exists on all 54 standalone readings; joined readings are Shabbat-only by design.                                                                              |
| Maftir              | explicit `role=maftir`         | Plain repeated-tail reading; seasonal overrides (החדש etc.) are calendar concerns, not stored.                                                                         |
| Alternative splits  | 24 ranges over 9 readings      | Structured `alternatives`: 16 Shabbat (hebcal notes + OpenTorah חב"ד/אשכנז/עדות המזרח variants) and 8 weekday (OpenTorah's independent division).                          |
| Applicability       | 2 restricted                   | חוקת-בלק `חוץ לארץ ומנהג תימן הבלדי`; מטות-מסעי `למעט מנהג תימן הבלדי`.                                                                                                 |
| Triennial           | none                           | Deliberately not imported (separate package, different scope).                                                                                                         |

## Editorial corrections

None required — the import applied zero corrections to source
boundaries. The only judgment applied is the עדות המזרח label on
OpenTorah-Common Shabbat variants (תרומה, מסעי), recorded above. Any
future correction lands in the curated JSON with a comment here;
never silently edit coordinates without recording why.

## Missing-data path

Not triggered — reliable freely-licensed coverage was complete, so the
issue's `@doradsoft` handoff condition did not fire.
