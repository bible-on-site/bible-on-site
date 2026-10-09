# Plan: JSON-LD structured data — Tanahpedia (meaty) + bible-on-site (thin)

**Status:** approved plan, not yet implemented.
**Scope:** one PR, phases 0–4 (~5 commits).
**Target module:** `web/bible-on-site` (Next.js 16.2.12, App Router, React 19, TS strict), plus one data-domain schema addition for `sameAs` (see §7).

---

## 1. Goal

Add schema.org JSON-LD to the website to improve classic SEO (rich results) and
GEO (Generative Engine Optimization — being understood and cited by AI search).
Two tiers:

- **Tanahpedia = meaty**: a real entity/knowledge graph per entry (`DefinedTerm` +
  `Person`/`Place`/`Event` + the family tree + `sameAs`).
- **bible-on-site core (929) = thin**: lightweight `Chapter`/`Article`/`Person`
  + `BreadcrumbList` + the shared site graph.

## 2. Research summary (design drivers)

- Google + Next.js both recommend JSON-LD as a plain `<script type="application/ld+json">`
  in a **server** `page.tsx`/`layout.tsx`. Fits the repo's "no client components" rule.
- Type with **`schema-dts`** (`WithContext<T>`, `Graph`) — dev-only, compile-time, zero runtime cost.
- **XSS**: serialize via a single `renderJsonLd()` that escapes `<`, `>`, `&`, `'`.
- Use a **`@graph` with stable `@id` stubs** to interlink nodes (WebPage → BreadcrumbList
  → entity → WebSite/Organization). Biggest structural win for both SEO and GEO.
- **GEO levers**: `sameAs` → Wikidata / Hebrew Wikipedia (entity disambiguation),
  `DefinedTerm`/`DefinedTermSet` (encyclopedia shape), `inLanguage: "he"`, accurate
  `about`/`description`.
- **Google rule**: structured data must reflect **visible** content — no fabricated facts.

## 3. Current baseline

| Aspect | State |
|---|---|
| JSON-LD / OpenGraph / canonical | none |
| `metadataBase` | not set — derived from Host header; fallback `xn--febl3a.co.il` |
| Root `<html lang>` | `en` (should be `he`, `dir="rtl"`) |
| Data source | direct **MySQL** via `src/lib/api-client.ts` |
| Client components | forbidden → all JSON-LD server-rendered |
| Sitemap / robots | already comprehensive |
| Prod website origin | `https://xn--febl3a.co.il` |

## 4. Shared foundation (Phase 0)

1. Add dev dep `schema-dts` to `web/bible-on-site`.
2. Set a fixed `metadataBase` (`https://xn--febl3a.co.il`, env-overridable). SSG pages
   have no Host header at build time → a stable base is required for canonical + `@id` URLs.
   Keep Host-header logic only as a dev/preview override.
3. New server-only module `src/lib/seo/jsonld.ts` (pure functions, highly unit-testable):
   - `renderJsonLd(node)` → sanitized string
   - `absUrl(path)` / `id(path, frag)` → canonical URL / stable `@id`
   - `organizationNode()`, `websiteNode()`, `breadcrumbNode(items)`, plus entity builders
   - `hasContent(html)` → strip tags+whitespace, non-empty (gates content-derived fields)
   - `sameAsFor(kind, id)` → looks up external refs (see §7); returns `undefined` when none
4. New server component `src/app/components/JsonLd.tsx` → renders the `<script>` tag.
5. Root layout: fix `lang="he"` + `dir="rtl"`; emit the site graph once —
   `Organization` (logo, social `sameAs`) + `WebSite` (+ `SearchAction` when site search exists).
   Pages reference these by `@id` instead of repeating them.

## 5. Tanahpedia — meaty graph (Phases 1–2)

**Entry page `/pedia/[uniqueName]` (SSG)** emits one `@graph`:

| Node | Purpose |
|---|---|
| `WebPage` (`#webpage`) | `inLanguage: he`, `isPartOf` WebSite, `breadcrumb` ref |
| `BreadcrumbList` | Home › Tanahpedia › [Category] › [Entry] (mirrors `TanahpediaBreadcrumb`) |
| `DefinedTerm` (`#term`) | `name`=title, `inDefinedTermSet`=Tanahpedia set, `about`→entity; `description` **only when `hasContent`** |
| entity node | type per EntityType (below), `sameAs` from §7 when available |
| relation nodes | family (`Person` parent/spouse/children via `@id` refs), `Place` `geo`, `Event` participants |

**EntityType → schema.org type:**

| EntityType | Type | Meaty fields |
|---|---|---|
| PERSON | `Person` | `gender`, `parent`/`children`/`spouse` (`@id` refs), `birthPlace`→Place, `sameAs` |
| PLACE | `Place` | `geo` (GeoCoordinates), `alternateName`=modernName, `sameAs` |
| EVENT / WAR | `Event` | `startDate`/`endDate`, `location`→Place, `participant`→Person/Nation |
| ANIMAL | `Thing`+`DefinedTerm` | kind/purity as `additionalProperty` |
| NATION | `Organization`/`Place` | territories, `sameAs` |
| OBJECT / TEMPLE_TOOL | `Thing` | 3D model link if present |
| PLANT / SAYING / PROPHECY / ASTRONOMICAL_OBJECT | `Thing`+`DefinedTerm` | name + definition |

The **family graph** is the meaty payoff: each related person is a node with an `@id`,
cross-linked via `parent`/`children`/`spouse` (mirrors the data published to prod:
Avraham → Yitzhak → Yaakov …).

- **Entity-list `/tanahpedia/[entityType]`** (dynamic): `CollectionPage` + `DefinedTermSet` + `ItemList` + `BreadcrumbList`.
- **Landing `/tanahpedia`** (dynamic): `CollectionPage` for the `DefinedTermSet` root + `BreadcrumbList`.

### §6 content gating (resolved)

Placeholder `<p></p>` entries are **not** a blocker. Always emit the visible-metadata
graph (DefinedTerm name, entity node, **family tree**, place geo, citations, breadcrumb).
Gate **only** the content-derived fields (`DefinedTerm.description`, any `articleBody`/`text`)
behind `hasContent(entry)` — omit that single field when empty, never fabricate.
As entries get populated, the prose `description` lights up automatically — no code change.

## 6. bible-on-site core — thin graph (Phase 3)

| Route | JSON-LD |
|---|---|
| Root layout | `Organization` + `WebSite` (shared, once) |
| `/929/[number]/[slug]` (Perek text) | `Chapter` (`isPartOf`→`Book`=Sefer→Tanah; `position`=perek; `inLanguage: he`; `articleBody`=visible text) + `BreadcrumbList` |
| `/929/[number]/[slug]` (article) | `Article`/`ScholarlyArticle`: `headline`, `author`→`Person`, `about`→the Perek, `dateModified` + `BreadcrumbList` |
| `/929/[number]/[slug]` (perush) | commentary `Article`: `about`→Perek, `author`→Parshan `Person` (+ `sameAs`), `isPartOf` the Perush work + `BreadcrumbList` |
| `/929/authors` + author page | `Person`/`ProfilePage` (name, image, `sameAs` if public) |

Thin = one primary node + breadcrumb + `@id` refs to the shared Organization/WebSite;
no deep relation graph.

## 7. `sameAs` — external-reference table (Phase 4, DB) — **decision: Option A**

A single **polymorphic** table serves all three subject kinds, so Tanahpedia entities
**and** authors/parshanim reuse one mechanism and one admin surface.

**Subject kinds & id types:**

| Kind | Table | id type | Notes |
|---|---|---|---|
| `TANAHPEDIA_ENTITY` | `tanahpedia_entity` | char(36) UUID | persons/places/events… |
| `PARSHAN` | `parshan` | smallint | historical commentators (Rashi/Ramban…) — mostly have wiki pages |
| `TANAH_AUTHOR` | `tanah_author` | int | modern 929 essayists — **privacy-sensitive** (see below) |

**Proposed schema** (`data/mysql/external_reference_structure.sql`, populated by the Rust `db-populator`):

```sql
CREATE TABLE `external_reference` (
  `id` char(36) NOT NULL,
  `subject_kind` enum('TANAHPEDIA_ENTITY','PARSHAN','TANAH_AUTHOR') NOT NULL,
  `subject_id` varchar(36) NOT NULL,          -- holds UUID or numeric id as text
  `source` enum('WIKIDATA','WIKIPEDIA_HE','WIKIPEDIA_EN','SEFARIA','OFFICIAL') NOT NULL,
  `url` varchar(1024) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subject_source` (`subject_kind`,`subject_id`,`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- JSON-LD builder: one lookup by `(kind, subject_id)` → `sameAs: [urls]`; omitted when none.
- **Polymorphic tradeoff**: DRY + single lookup + one admin surface; cost = no cross-table
  FK (enforced at app layer) and it spans data domains (tanahpedia + perushim + tanah core),
  so it gets its own structure file and is owned by the data populator.
- Alternative (rejected): per-domain side tables → duplication + 3 lookups.
- **Accuracy rule**: every QID/URL must be **verified** during curation — a wrong `sameAs`
  is worse than none. Seed historical figures first (family-tree entities + top parshanim).
- **Privacy**: `TANAH_AUTHOR` are living people → add a ref only for public figures with a
  genuine public page; default none.
- **Deploy note (tanahpedia-practices: schema class change)**: new table → migration +
  `db-populator` support + curated seed + prod RDS data-deploy. This is the one piece that
  touches prod data infrastructure.

## 8. Constraints & gotchas

- SSG + canonical base → fixed `metadataBase` (Phase 0).
- All output through the single sanitizing `renderJsonLd()`.
- Content gating (§6) — never fabricate; gate the field, not the `<script>`.
- `dateModified` (not `datePublished`) for scripture/entries — we don't "publish" scripture.
- Hebrew event dates → ISO where possible, else `Text`.
- No client components — fully server-side.

## 9. Commit plan (~5)

1. **Phase 0 — foundation**: `schema-dts`, `metadataBase`, `lang="he"`/`dir="rtl"`,
   `jsonld.ts` + `<JsonLd>`, Organization + WebSite in root layout.
2. **Phase 1 — Tanahpedia entry (meaty)**: DefinedTerm + Person/Place/Event + family graph
   + BreadcrumbList on `/pedia/[uniqueName]`; `sameAs` wired conditionally (no data yet).
3. **Phase 2 — Tanahpedia list + landing**: CollectionPage/DefinedTermSet/ItemList + breadcrumbs.
4. **Phase 3 — bible-on-site thin**: 929 Perek/Chapter, article, perush, authors + parshanim.
5. **Phase 4 — `sameAs` data + tests**: `external_reference` table + populator + curated seed
   (family-tree entities + top parshanim), wire `sameAsFor()`; unit tests (builders) + e2e
   (assert one valid `ld+json` per route) + Rich Results / schema.org validation.

## 10. Testing (repo practice: prefer unit tests)

- **Unit** `tests/unit/lib/seo/jsonld.test.ts`: builders are pure → assert node shape,
  `@id` linking, sanitization (`<` escaped), EntityType→type mapping, `hasContent` gating,
  `sameAsFor` include/omit. Target 100% patch coverage on the new module.
- **E2E** `tests/e2e`: on sample `/pedia/*`, `/929/*`, root — exactly one
  `<script type="application/ld+json">` per node-set, `JSON.parse` succeeds,
  `@context`/`@type` present. Reuse the sitemap e2e pattern.

## 11. Open items / fast-follows

- Admin UI for editing `external_reference` (after the table lands).
- OpenGraph/Twitter cards + per-entry `image` (separate enhancement).
- Site `SearchAction` once on-site search exists.
