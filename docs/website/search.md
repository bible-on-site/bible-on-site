# Website Internal Search

Implementation of [issue #2040](https://github.com/bible-on-site/bible-on-site/issues/2040):
an internal search experience for the website, using the native app's
floating-search work (PR #2032) as the functional reference.

## Scope and result contract

Result types mirror the app's `SearchFilter` (`Author`, `Pasuk`, `Perush`,
`Perek`) plus articles. The shared contract lives in
`src/lib/search/types.ts`:

| Type     | Hebrew label | Corpus                          | Result link                              |
| -------- | ------------ | ------------------------------- | ---------------------------------------- |
| `perek`  | פרקים        | Bundled sefarim JSON (in-memory) | `/929/{perekId}`                          |
| `pasuk`  | פסוקים       | Bundled sefarim JSON (in-memory) | `/929/{perekId}#pasuk-{n}`                |
| `perush` | פירושים      | MySQL `note` + `perush`          | `/929/{perekId}/{perushName}?pasuk={n}`   |
| `author` | רבנים        | MySQL `tanah_author`             | `/929/authors/{slug}`                     |
| `article`| מאמרים       | MySQL `tanah_article`            | `/929/{perekId}/{articleId}`              |

Every result is `{ type, title, snippetHtml, href, score }`. `snippetHtml`
is built server-side with all source bytes HTML-escaped and only `<mark>`
highlight tags emitted, so clients can render it via
`dangerouslySetInnerHTML` with no XSS surface (`src/lib/search/snippet.ts`).
`title` uses the site's plain-letter source convention (`רש"י בראשית א א`).

Tanahpedia (`/pedia`) entries are intentionally out of the initial scope —
the issue's contract lists chapters, verses, commentary, authors and
articles. Per-sefer filtering is also deferred: results already carry
`perekId`, so a future `sefer` URL param maps cleanly onto the same
contract.

## Matching approach

The matching core (`normalize.ts`, `score.ts`) is a deliberate TypeScript
port of the app's `Helpers/SearchText.cs`, keeping cross-platform behavior
identical:

- **Normalization** — NFD decomposition strips Hebrew niqqud/taamim
  (Unicode mark categories), plus geresh/gershayim and other quote-like
  characters; punctuation collapses to spaces; letters/digits are kept and
  lowercased. `בְּרֵאשִׁית` ≡ `בראשית`.
- **Scoring** — whole-text equality 110; whole-word phrase containment 100;
  otherwise every query term must match some word: exact 90, prefix 80,
  fuzzy 60. Fuzzy matching is the app's conservative bounded edit distance
  (0 edits under 4 chars, 1 under 8, 2 above), which catches common Hebrew
  spelling slips (e.g. `בראשים` → `בראשית`) without flooding results.
- **Reference resolution** — numeric words in the query are rewritten as
  Hebrew letters before matching perek sources, so `בראשית 1` finds
  `בראשית א` (same trick as the app).

### Why no hosted search engine

Alternatives assessed: Algolia/Typesense/Elasticsearch (managed or hosted),
and MySQL `FULLTEXT`. The corpus is small (~23k pesukim already held in
server memory, ~hundreds of articles/authors, a bounded commentary corpus),
so a hosted engine's cost and ops surface buy nothing a few index scans
don't deliver. MySQL FULLTEXT would require a schema change on a shared,
DB-owned table and its default 4-char minimum word length hurts short
Hebrew terms; it also still can't do niqqud-insensitive matching without a
normalized shadow column. The ported normalizer + bounded `LIKE` candidate
selection covers the requirement now and leaves the seam described below
for the shared semantic backend.

## Architecture

```
/search (page, force-dynamic)
   ├─ SSR: searchSite() directly for the URL's ?q=&type= → first paint
   └─ <SearchExperience> (client)
        typing ──debounce 300ms──▶ history.pushState (native) + fetch /api/search
        filters/submit ─────────▶ settled history entries
        Back/Forward ───────────▶ useSearchParams → client cache / refetch

GET /api/search?q=&type=&limit=
   └─ searchSite() → providers:
        perakim/pesukim — in-memory corpus built once per process from the
                          bundled tanah_view JSON (globalThis cache)
        perushim        — MySQL LIKE candidate pull (AND-ed terms,
                          LIMIT 250, MAX_EXECUTION_TIME 3000) then
                          normalize+score in JS
        authors         — MySQL LIKE on name/details
        articles        — MySQL LIKE on name/abstract/content (lexical;
                          see #2039 seam below)
```

Providers degrade independently: a MySQL failure removes only its result
type and adds an availability notice (`availability[]`) instead of failing
the search.

### URL-driven state and history

Query and filters live in the URL: `/search?q=<phrase>&type=<csv>`
(`type` omitted = all types). While typing, each *settled* query (300 ms
debounce) becomes its own history entry via native `history.pushState` —
keystrokes never spam history, and no RSC round-trip is needed. Because
`useSearchParams` does not observe native `history.pushState`, the
component owns its URL state explicitly: `settle()` pushes history and
updates React state atomically, and a `popstate` listener adopts
external Back/Forward navigations. Filter toggles, submit, and Escape
settle immediately. Back/Forward therefore walks meaningful states;
results are restored from a small client cache (~30 entries) or
refetched, and the browser's own scroll restoration preserves list
position. Result links are plain `<Link>`s — ordinary crawlable anchors —
so opening them in a new tab works normally. The form is a real
`GET /search` form, so a no-JS submit lands on the SSR'd results page.

### Fetch discipline

Queries are debounced (300 ms), raced with `AbortController`, and stale
responses are dropped by a resolved-key guard — same "obsolete responses
must not overwrite newer ones" rule as the app. `/api/search` answers
`Cache-Control: no-store`: queries are user input and must not sit in
shared caches. No query log is persisted — the only record is the
transient request log (privacy choice documented per the issue).

### #2039 article-content seam

The website can already lexically search `tanah_article`
name/abstract/content, so it does not *depend* on the Rust semantic-search
API from issue #2039. When that endpoint lands, the intent is for a remote
provider to replace `searchArticles` (`src/lib/search/db-content.ts`) — the
only call site — returning the same `Scored<ArticleHit>[]` shape
(`id`, `perekId`, `name`, `authorName`, plain-text `plain` for snippet
building). The expected contract is: `GET {API}/articles/search?q=<phrase>&limit=<n>`
→ `[{ articleId, perekId, title, authorName, score, excerptPlain }]`. The
swap is isolated to one file; no caller or DTO changes needed.

## Accessibility and RTL

- A `<search>` landmark wraps the form; labelled `type="search"` input
  (implicit `searchbox` role) plus a visible submit button.
- A polite `aria-live` status region announces מחפש… / נמצאו N תוצאות /
  לא נמצאו תוצאות / שגיאה בחיפוש; provider degradations are announced in a
  separate status line.
- Keyboard: `ArrowDown` from the input focuses the first result link;
  `ArrowUp`/`ArrowDown` cycle focus across results (wrapping); `ArrowUp`
  on the first result and `Escape` return to the input; `Escape` in the
  input clears the query.
- Result groups are `<section>`s with labelled `<h2>`s and count badges —
  a predictable fixed order (פרקים, פסוקים, פירושים, רבנים, מאמרים) rather
  than order-by-score, which is less disorienting for screen readers.
- RTL: `dir="rtl"` is inherited; styles use logical properties
  (`margin-block`, `padding-inline`) where direction matters. The
  `<mark>` highlights inherit color and use underline+weight so they read
  in dark mode too.
- Entry point: a persistent search button beside the hamburger on every
  page plus a "חיפוש" item at the top of the main menu.

## SEO policy (researched and deliberate)

Sources:

- Google Search Central, *Control what you share* and robots-meta docs —
  `noindex`/`X-Robots-Tag` are page-level directives; robots.txt only
  controls *crawling*, and a disallowed page's `noindex` is never seen.
- John Mueller (Search Off the Record, 2025): internal search-result pages
  are no longer named in Search Essentials, but Google still recommends
  keeping them out of the index — they are an unbounded, automatically
  generated space that wastes crawl budget, can surface soft-404s, and can
  get a site flagged as hacked if arbitrary off-topic queries get indexed.
- Google deprecated the **sitelinks search box** on 2024-11-21 — the
  `WebSite.potentialAction`/`SearchAction` markup no longer triggers any
  feature (docs archived). We verified status instead of assuming; we do
  *not* add it.
- Google's faceted-URL guidance: avoid indexing filter/sort combinations;
  keep the sitemap to canonical content.

Chosen policy:

- `/search` renders `<meta name="robots" content="noindex, follow">`
  (Next `robots` metadata). `noindex` keeps every query URL out of the
  index; `follow` lets crawlers reach the canonical content pages the
  results link to. We deliberately do **not** `Disallow` `/search` in
  robots.txt — that would hide the `noindex` from crawlers and forgo the
  link discovery value.
- No canonical is emitted for search URLs (they're not indexable
  candidates anyway), and `/search` is kept out of `sitemap.ts` —
  the sitemap stays limited to canonical content pages.
- `/api/search` is already under the existing `Disallow: /api/` rule.
- Underlying content pages (`/929/*`, `/929/authors/*`, `/pedia/*`) keep
  their stable canonical URLs/metadata untouched — search discovery is
  additive, on top of normal crawlable navigation.
- Every result link points at a canonical content URL (with `#pasuk-` /
  `?pasuk=` fragments where relevant), so search supplements rather than
  duplicates crawlable paths.

## Caching and query logging

- `/api/search`: `Cache-Control: no-store` — user queries are never cached
  by browsers or shared infrastructure.
- Corpus index: built lazily per server process over the bundled JSON
  (same `globalThis` cache pattern as `sefarim.ts`); perakim/pesukim
  results are deterministic until the bundled text changes (deploys only).
- DB providers run live queries; `MAX_EXECUTION_TIME(3000)` bounds the
  worst case and `LIMIT 250` bounds transferred candidates.
- Queries are not persisted anywhere. Privacy note: query terms appear in
  URLs by design (shareable search URLs are a requirement), so they may
  appear in ordinary access logs — documented and accepted.

## Testing

- `tests/unit/lib/search-*.test.ts` — normalization, scoring, snippet
  safety, corpus search, DB providers (mocked `query`), orchestrator
  degradation/limits.
- `tests/unit/app/api/search-route.test.ts` — validation, error paths,
  `no-store`.
- `tests/unit/app/search-page.test.tsx` — SSR results, metadata, states.
- `tests/unit/components/SearchExperience.test.tsx` — debounce, settle-to-
  URL, Back-restore via cache, filters, error state, arrow-key focus.
- `tests/e2e/search.test.ts` — entry points, SSR results, shareable URLs,
  Back restoration, filters, keyboard nav, `noindex`, sitemap hygiene,
  API contract.
