# Compression codec coverage and measured headroom (issue #2992)

Read-only measurement round, 2026-11-04/05. Re-verifies the 2026-11-03
research recorded in issue #2992 and extends the corpus to payloads it did
not measure (SQLite packs, canonical JSON, sitemap, larger API responses,
media). **No production setting or client requirement was changed.**

## Current coverage (verified live and in source)

| Surface | Path | State today |
| --- | --- | --- |
| Website text (HTML/RSC/JS/CSS/sitemap) | nginx router → Next.js standalone (`compress` default) | **gzip only** — `br`/`zstd` advertised → still `Content-Encoding: gzip` |
| API JSON (GraphQL) | actix-web `Compress::default()`, `web/api/Cargo.toml` | **brotli only** (`compress-brotli` feature); `br;q=0, gzip;q=1` → identity |
| App API calls | `BaseGraphQLService` → `GraphQLHttpClient`, default handler, `app/BibleOnSite/Services/BaseGraphQLService.cs` | **identity** — no `AutomaticDecompression` configured, so no `Accept-Encoding` is sent at all |
| Asset CDN (`bible-on-site-assets`, E1WMX9UV9D2726) | `docs/aws/cloudformation/cloudfront-assets.yaml` | `Compress: false`, caching disabled — corpus is mp3/mp4/jpg, correct |
| Canonical tanah_view JSON (server-side read) | `web/bible-on-site/scripts/compress-canonical-data.mjs` | build-time `.br` quality 9 (41.2 MB → 3.9 MB), not HTTP |
| Perushim notes pack | `note_blob` PNB1 zlib records, `app/BibleOnSite/Helpers/PerushNoteBlob.cs` | in-blob zlib (schema v2); pack delivered as **raw 104.8 MB `.sqlite`** |
| Release payload packs | `PadDeliveryService.ReleasePayload*` | raw `.sqlite`/`.zip` on GitHub releases; release assets get no content-encoding |
| Docker image archives / OCI layers | `shared-dockerize`, `docker save \| gzip` | tar.gz (layers already gzip'd — outer codec choice is near-neutral) |
| Repo-tracked notes artifact | `perushim_notes/*.sqlite.gz` | 85.9 MB gz → 104.8 MB, `gunzip`'d at build (`DecompressPerushimNotes`) |

## Measured headroom (Node 24 `node:zlib`, Windows 11, median of 3 iters / 1 iter >20 MB, round-trip verified)

### Website/API text (identity bytes fetched live 2026-11-04)

| Payload | Bytes | gzip-6 (today) | br-5 | br-9 | br-11 | zstd-3 | zstd-19 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/929/307` HTML | 325,037 | 37,409 | 28,006 (−25%) | 26,484 | 23,610 | 33,071 | 26,441 (−29%) |
| `/` HTML | 57,684 | 11,255 | 10,580 | 10,034 | 9,302 | 12,125 (+8%) | 10,448 |
| `/1/1` HTML | 22,722 | 5,437 | 5,025 | 4,967 | 4,496 | 5,794 (+7%) | 5,211 |
| `sitemap.xml` | 3,113,081 | 83,862 | 51,862 | 43,756 (−48%) | 33,012 (−61%) | 63,595 | 42,327 (−50%) |
| largest JS chunk | 228,775 | 71,664 | 67,623 | 66,110 | 61,279 (−14%) | 73,758 (+3%) | 64,533 (−10%) |
| CSS (19.2 KB) | 19,222 | 4,165 | 3,928 | 3,827 | 3,597 | 4,729 (+14%) | 4,011 |
| API article JSON | 71,935 | 21,759 | 21,000 | 20,190 | 18,851 | 22,961 (+6%) | 19,805 |
| API sefarim JSON | 1,916 | 597 | 565 | 551 | 505 | 628 (+5%) | 596 |
| API perakim JSON | 6,165 | 1,708 | 1,517 | — | — | 1,728 | — |
| **9-file aggregate** | **3,846,537** | **237,856** | **190,106 (−20.1%)** | **175,919 (−25.5%)¹** | **154,652 (−34.5%)¹** | **218,389 (−8.2%)** | **173,372 (−26.6%)¹** |

¹ The round measured thirteen live payloads; the four not listed above
(259,815 identity bytes) are excluded from this aggregate, which therefore
covers exactly the nine published rows. br-9, br-11 and zstd-19 were also not
measured for API perakim (`—` in its row), so those columns aggregate the
other eight files against their gzip-6 total (236,148 bytes).

Pattern: brotli wins on every text type at every size; zstd-3 is *worse than
gzip* below ~100 KB and only wins on large repetitive payloads (sitemap,
perek HTML); zstd-19 ≈ br-9 on aggregate but at ~30–100× the zstd-3 encode
cost — precompression territory, not per-request.

### Data packs / canonical data (local files)

| Payload | Bytes | gzip-6 | br-9 | br-11 | zstd-3 | zstd-9 | zstd-19 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perushim_notes `.sqlite` v2 (delivered raw) | 104,816,640 | 85,390,937 (−18.5%) | 83,715,396 | (skipped) | 85,412,613 | 84,632,625 | 83,537,143 (−20.3%) |
| tanah_view `.sqlite` (bundled in app) | 36,270,080 | 9,767,363 | 6,163,939 | 4,614,030 (−53%) | 8,101,786 | 7,235,876 | 5,159,882 (−47%) |
| recitation `.sqlite` (pipeline artifact) | 16,601,088 | 4,936,527 | 3,035,974 | 2,444,436 | 4,059,580 | 3,619,331 | 2,931,458 (−41%) |
| tanah_view `.json` (canonical dump) | 43,166,263 | 5,779,454 | 3,884,542 (current choice) | 3,081,773 | 4,895,328 | 4,111,290 | 3,323,263 (−14% vs br-9) |
| author photo JPEG | 19,489 | 19,344 | 19,315 | — | 19,499 | — | — |
| speech MP3 fixture | 221,309 | 188,909 | 186,726 | — | 188,512 | — | — |

Decode of the 41.2 MB canonical JSON (5 iters median): gzip 95 ms, br-9 82 ms,
br-11 79 ms, zstd-9 76 ms, zstd-19 79 ms — no meaningful decoder-speed reason
to switch the server-side `.br` to zstd; br-9 stays.

Notes:

- **v2 notes pack**: whole-file recompression recovers only ~18–20% —
  the note *content* is already zlib blobs; the residual is indexes, free
  pages and metadata. The big win already shipped: the v1 row-per-note
  layout was ~285 MB; v2 is 104.8 MB (−63%) before any transport codec.
- **Store-packaged payloads** (AAB/PAD, Apple `.aar`, IPA/MSIX) ride their
  own compressed container/transport — the raw `.sqlite` size is installed
  size, not necessarily wire size. The channel that ships truly raw bytes
  is the **GitHub release payload fallback**.
- **Media**: JPEG ≈ 0%, MP3 ~0–15% (speech fixture best case) — confirms
  `Compress: false` on the asset CDN and `ZIP_STORED` audio archives.

## Findings vs. headroom

1. **Largest measured gap — app and non-browser API clients get identity.**
   No `AutomaticDecompression` is configured anywhere in `app/`, so
   `HttpClient`/`GraphQLHttpClient` send no `Accept-Encoding`; and the API
   couldn't serve gzip anyway (`compress-brotli` only). Measured effect of
   the two-sided fix on real responses: article JSON 71.9 KB → 21.8 KB
   (−70%), perakim list 6.2 KB → 1.7 KB (−72%), sefarim 1.9 KB → 0.6 KB
   (−69%). Every curl/monitoring/native call today transfers ~3–4× the bytes.
2. **Website brotli headroom**: −20% (dynamic, br-5) to −26–35% (precompressed
   br-9/11) on the nine published payloads vs. the current gzip baseline;
   −25% on the largest perek page; −48% on sitemap. Negotiated — gzip-only
   and identity clients unaffected.
3. **zstd**: aggregate ≈ br-9 at level 19, worse than gzip at level 3 on
   small text. Useful only as an optional negotiated third encoding or for
   controlled build/data consumers — matches the Baseline-Newly-Available
   verdict in the issue. `.NET 10` has no zstd decoder (DecompressionMethods
   = GZip/Deflate/Brotli), so it cannot serve app clients.
4. **Packs**: at most ~20% more compression available on the notes pack, and
   only on channels that ship raw bytes (release fallback). A versioned
   `.sqlite.gz` payload + in-app `GZipStream` decode is the feasible shape
   (no new .NET dependency); store transports manage their own compression.
5. **Bundled tanah_view.sqlite**: −47–53% achievable if shipped compressed,
   but the app container already deflates it (~9.8 MB wire-equivalent) — real
   prize is ~30 MB installed storage, traded against first-run decompression.

## Recommendations (implementation follows normal commit/PR flow)

1. **API**: enable `compress-gzip` (and optionally `compress-zstd`) alongside
   `compress-brotli`; extend `web/api/tests/e2e/features/compression.test.ts`
   to gzip + q-value negotiation. **App**: configure
   `AutomaticDecompression = DecompressionMethods.All` (GZip|Deflate|Brotli —
   no zstd on .NET 10) on the handler behind `GraphQLHttpClient` and the
   payload `HttpClient`s. Highest value per line changed.
2. **Website**: serve negotiated brotli — precompress immutable
   `_next/static` text at build (br-11 acceptable offline) and use a
   moderate dynamic level (br-5-ish) for HTML/RSC/sitemap, at whichever
   layer is cheapest (nginx `ngx_brotli`, custom server hook, or edge) after
   a Fargate CPU/TTFB check. Keep gzip+identity fallbacks; do not compress
   at two layers.
3. **zstd**: optional-only, never sole format; not a reason to touch client
   minimums or the app runtime.
4. **Packs/CDN**: leave PAD/Apple/CDN contracts as-is. If the release-fallback
   download size ever justifies it, ship a versioned `.sqlite.gz` payload with
   in-app decode — separate proposal, old-client handling included.
5. **Out of scope / no action**: recompressing media; switching the
   server-side canonical `.br`; `docker save | gzip` outer codec (layers are
   already gzip); OCI layer codecs are a separate lazy-pull (SOCI vs
   zstd:chunked) investigation.

Reproduction: `node:zlib` (`gzipSync`, `brotliCompressSync`,
`zstdCompressSync`) on the identity bodies above; live bodies fetched with
`curl -H "Accept-Encoding: identity"` on 2026-11-04/05; v2 sqlite obtained by
`git show origin/master:...sqlite.gz | gunzip`.
