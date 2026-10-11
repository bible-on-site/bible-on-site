# Public rabbis and articles disappeared on 2026-10-11

## Cause and evidence

PR #2143 (`f9f3a809`) added `distributable = TRUE` to every website article read and to author enumeration. It interpreted the flag as public visibility. The existing admin label and daily bulletin documentation define it as approval for inclusion in the daily bulletin. The schema defaults it to false.

A read-only production query found 2,681 articles across 64 authors in canonical chapters, all with `distributable = 0`. Website release 0.2.489 therefore generated empty article lists and an empty rabbis listing. Production returned HTTP 200 for those empty pages and for `/api/health/ready`.

The immediate recovery registered ECS task definition `bible-on-site-website:15` with the previous image `bible-on-site:v0.2.488`, preserving the live task's other settings. After its rollout completed, the production rabbis listing again rendered 64 author links. No content or bulletin approval flags were changed in the database.

The permanent correction keeps public content independent of bulletin approval and excludes invalid chapter references with the canonical 1-929 range. The same incorrect restriction in the API's derived article search index is corrected. Daily bulletin selection retains its explicit approval requirement.

## Why validation passed

- Unit tests mocked the database and asserted that the new SQL contained the incorrect predicate. They confirmed the implementation rather than the product contract.
- Website fixtures approved every valid article. The sole false row referenced chapter 5000, conflating bulletin approval with an invalid chapter. Neither development E2E nor production-build performance tests represented a valid unapproved article.
- The author-list E2E tests checked the title, navbar, and redirects, without requiring author cards.
- The Docker packaging and deployed-site checks validated recitation and version identity, without inspecting database-backed content.
- Readiness warmed canonical scripture only. It explicitly excluded database-backed pages. Content services also converted database failures into empty results inside indefinitely cached page loaders.

## Prevention implemented

- A valid fixture article and its author's only valid article are now unapproved for the bulletin. Browser assertions require that article in chapter, author listing, author detail, article detail, and website search. The same contract runs against the production build; API search has an equivalent regression.
- Readiness checks the live public article/author corpus on every probe and returns 503 for missing content or database failure.
- Cached author and chapter-summary loaders reject database failures instead of persisting empty success results.
- Packaging compares actual rendered author and representative chapter article counts against the production database, then opens author and article details. This catches successful builds that contain empty or partial cached content.
- Deployment runs the rendered-content check after verifying the released version. Validator tests explicitly simulate HTTP 200 and healthy readiness alongside missing or partial content.
- The schema and daily bulletin documentation state that approval applies only to the bulletin.

These checks prevent the observed contract mismatch, empty content deployment, and cached database-error failure classes. They do not claim to prove the absence of every possible website defect.
