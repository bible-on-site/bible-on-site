# Aliyah boundary data — source audit (#2519)

This doc records what was checked, what was chosen, and what the curated
`web/bible-on-site/src/data/parasha/parasha-aliyot.json` covers. Regenerate
the table with `node devops/import-parasha-aliyot.mjs`; `--check` is the
drift gate.

## Candidates evaluated

| Source                                                                                                                  | Result                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sefaria** `/api/sheets/{parasha}/get_aliyot` | Correct shape — 8 refs: seven aliyot + a repeated-tail 8th (maftir). But the endpoint is **incomplete**: it 500s on `Acharei-Mot-Kedoshim`, `Nitzavim-Vayelech`, `Ki Tisa`, `Acharei Mot`, `Vayeilech`, and others (both hyphenated and underscored slugs tried). Usable only as corroboration. |
| **Hebcal** `@hebcal/leyning` [`src/aliyot.json`](https://github.com/hebcal/hebcal-leyning)                              | **Chosen.** BSD-2-Clause license, all 54 standalone parashot + all 7 joined readings (61 entries), `fullkriyah` aliyot 1–7 with explicit `M` maftir, `weekday` 3-aliyah splits on standalone readings, and inline `some sources use …` variant notes.                                           |
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

The upstream file is vendored verbatim at the pinned commit in
`devops/data-sources/hebcal-leyning-aliyot.ec5c7642e3.json` — the import
runs offline and deterministically; `--refresh` re-fetches upstream.
Provenance is also stored verbatim in the JSON's `provenance` block and
exported to SQLite (`tanah_parasha_aliyah_source`, single row `id=1`).

## Coverage matrix

| Scope               | Coverage                       | Notes                                                                                                                                                                  |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone parashot | 54/54                          | Shabbat 7 + maftir each, except וזאת הברכה (7, no maftir — read on שמחת תורה).                                                                                         |
| Joined readings     | 7/7                            | ויקהל-פקודי, תזריע-מצורע, אחרי מות-קדושים, בהר-בחוקותי, חוקת-בלק, מטות-מסעי, נצבים-וילך — each with its own seven-aliyah split (never concatenated standalone halves). |
| Schemes             | `shabbat` (7+M), `weekday` (3) | Weekday exists on all 54 standalone readings; joined readings are Shabbat-only by design.                                                                              |
| Maftir              | explicit `role=maftir`         | Plain repeated-tail reading; seasonal overrides (החדש etc.) are calendar concerns, not stored.                                                                         |
| Alternative splits  | 2 parashot                     | בראשית aliyot 5/6 and תרומה aliyot 2/3 carry the source's documented `חלוקה חלופית` notes verbatim in `note`.                                                          |
| Applicability       | 1 restricted                   | חוקת-בלק marked `חוץ לארץ בלבד` — it never joins in ארץ ישראל.                                                                                                         |
| Triennial           | none                           | Deliberately not imported (separate package, different scope).                                                                                                         |

## Editorial corrections

None required — the import applied zero corrections to source boundaries.
Any future correction lands in the curated JSON's `note` field with a
comment here; never silently edit coordinates without recording why.

## Missing-data path

Not triggered — reliable freely-licensed coverage was complete, so the
issue's `@doradsoft` handoff condition did not fire.
