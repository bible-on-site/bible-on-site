# Website Architecture

This document describes the architecture of the Bible on Site website (`web/bible-on-site`).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client Browser                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Server (SSG)                        │
│  ┌───────────────────────────────────────────────────────┐      │
│  │                     App Router                         │      │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │      │
│  │  │   /929/*    │  │     /       │  │   /api/*    │    │      │
│  │  │  Perek Page │  │  Home Page  │  │  Dev APIs   │    │      │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘    │      │
│  └─────────┼─────────────────────────────────────────────┘      │
│            │                                                     │
│  ┌─────────▼─────────────────────────────────────────────┐      │
│  │                Data Access Layer (DAL)                  │      │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────┐  │      │
│  │  │  Static JSON  │  │ MySQL Client  │  │  Bulletin  │  │      │
│  │  │  (tanah_view) │  │ (mysql2)      │  │  Client    │  │      │
│  │  └───────────────┘  └───────┬───────┘  └──────┬─────┘  │      │
│  └─────────────────────────────┼─────────────────┼────────┘      │
└────────────────────────────────┼─────────────────┼───────────────┘
                                 │ TCP/3306        │ AWS SDK
                                 ▼                 ▼
                    ┌──────────────────┐  ┌────────────────────┐
                    │      MySQL       │  │  Lambda: bulletin  │
                    │ (tanah database) │  │  (Rust PDF gen)    │
                    └──────────────────┘  └────────────────────┘
```

## Design Decisions

### Direct Database Access

The website communicates **directly** with the MySQL database rather than going through the API layer. This architectural decision was made for:

1. **Lower Latency**: Eliminates the network hop to the API service, reducing response times by ~50-100ms per request.

2. **Reduced Billing Costs**: No API compute costs for website data fetching. Database queries are more cost-effective than API invocations.

3. **Simplified Deployment**: Website can operate independently without requiring the API service to be running.

### Data Sources

| Data Type | Source | Rationale |
|-----------|--------|-----------|
| Tanah Text (sefarim, perakim, pesukim) | Static JSON (`tanah_view.json`) | Read-only, changes infrequently, optimal for SSG |
| Articles | Direct MySQL query | Dynamic content, needs real-time updates |
| Dedications | Direct MySQL query | Dynamic content, frequently updated |
| PDF Bulletins | AWS Lambda (`bible-on-site-bulletin`) | On-demand generation, offloaded to Lambda for compute isolation |

### Browser Data Boundary

Keep the full canonical scripture JSON in server imports. The bookshelf, date
lookup and citation parser use `client-catalog.generated.json`, a small projection
of book ranges and learning dates. `scripts/generate-client-catalog.mjs` also writes
individual reader books under `public/generated/sefarim/`, named by their content
hash. Installation, builds and unit tests regenerate both outputs from the same
canonical source; generated files are ignored. Do not edit them or maintain a
second content source. After an intentional source change during development,
rerun the generator or restart `npm run dev`.

`LoadedSefer` fetches the selected book when the reader opens, with visible loading
and retry feedback. Uninitialized reader pages stay unpainted until FlipBook
has applied their dimensions, preserving geometry and preventing a layout flash.
Network requests revalidate HTTP cache entries so an older
server's cached 404 cannot prevent recovery during a rolling deployment. A missing
asset offers a full page refresh, preserving the reader route and query while
loading the current asset catalog. The browser cache retains at most four recent
books. Avoid
passing whole books through every static page: that repeats scripture in HTML/RSC
and increases server memory and deployment size. Chapter navigation within the
same book reuses its data; late requests cannot replace another selected book.
Download helpers load only when requested, so metadata requests do not initialize
the PDF generator's corpus.

The source text, reading order and recitation fields remain unchanged, including
canonical JSON precision handling in `next.config.mjs`. Tests compare every
metadata row and generated book with the canonical source. Production performance
tests reject browser scripts over 5 MiB and retain the existing memory/build limits.

### Production validation on Windows

Next.js 16.4.0-canary.61 cannot persist native Windows route-cache entries for
commentary URLs containing an ASCII quote, such as `רש"י`. The framework appends
the decoded pathname to a filesystem key; Windows rejects that filename. A
successful page response does not prove that the cache write succeeded.

Production and CI use Linux. Use Linux, Docker or WSL when validating production
cache persistence. Keep the existing commentary URLs and cache behavior. The
supported upstream fix and cross-platform checks are tracked in
[the Windows route-cache issue](https://github.com/bible-on-site/bible-on-site/issues/1999).

### SSG Compatibility

The website uses Next.js Static Site Generation (SSG) with the following patterns:

- **Static Pages**: All 929 perek pages are pre-rendered at build time
- **Dynamic Data**: Articles are fetched at request time (ISR) with caching
- **Graceful Degradation**: If database is unavailable during SSG build, pages render without articles

## Database Configuration

Environment variables for database connection (supports both formats):

### Connection URL (Recommended)

| Variable | Example | Description |
|----------|---------|-------------|
| `DB_URL` | `mysql://root:pass@localhost:3306/tanah` | Full connection URL |

### Individual Variables (Fallback)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `127.0.0.1` | MySQL server hostname |
| `DB_PORT` | `3306` | MySQL server port |
| `DB_USER` | `root` | Database user |
| `DB_PASSWORD` | (empty) | Database password |
| `DB_NAME` | `tanah` | Database name |

For local development, copy `web/api/.dev.env` to `web/bible-on-site/.env.local`.

## PDF Generation (Bulletin Integration)

The website offers a "Download" feature on each Perek page that generates a printable PDF bulletin. In development, the Rust `web/bulletin` binary is invoked as a subprocess. In production (ECS), the website invokes the `bible-on-site-bulletin` Lambda directly via the AWS SDK (`@aws-sdk/client-lambda`).

```
User clicks "Download" → Server Action (actions.ts)
  → bulletin-client.ts
    ├─ Dev:  spawn local Rust binary (execFileSync)
    └─ Prod: AWS SDK InvokeCommand → bible-on-site-bulletin Lambda
                                        → returns base64-encoded PDF
```

**Why AWS SDK instead of HTTP?** Lambda Function URLs are not supported in `il-central-1`. The ECS task role (`bible-on-site-website-task-role`) grants `lambda:InvokeFunction` permission, and the `BULLETIN_LAMBDA_NAME` environment variable tells the website which Lambda to invoke.

## Layers

### Presentation Layer
- **Next.js App Router**: File-based routing with React Server Components
- **React Components**: Server and client components for UI rendering
- **CSS Modules**: Scoped styling for components

### Data Access Layer
- **Static Data**: JSON files imported at build time (sefarim, cycles)
- **MySQL Client**: `mysql2` library for direct database queries
- **Services**: Type-safe data fetching functions (`getArticlesByPerekId`)
- **Bulletin Client**: Invokes bulletin Lambda via AWS SDK for PDF generation

## Related Documentation

- [API Architecture](../api/api.md) - Backend API for mobile app
- [App Architecture](../app/app.md) - Mobile application
- [Repository Structure](../repo-structure.md) - Overall project structure
