# Website Architecture

This document describes the architecture of the Bible on Site website (`web/bible-on-site`).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Browser                        │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Server (SSG)                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   App Router                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │    │
│  │  │   /929/*    │  │     /       │  │   /api/*    │  │    │
│  │  │  Perek Page │  │  Home Page  │  │  Dev APIs   │  │    │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘  │    │
│  └─────────┼───────────────────────────────────────────┘    │
│            │                                                 │
│  ┌─────────▼───────────────────────────────────────────┐    │
│  │              Data Access Layer (DAL)                 │    │
│  │  ┌─────────────────┐  ┌─────────────────────────┐   │    │
│  │  │  Static JSON    │  │  Direct MySQL Client    │   │    │
│  │  │  (tanah_view)   │  │  (mysql2 - articles)    │   │    │
│  │  └─────────────────┘  └───────────┬─────────────┘   │    │
│  └───────────────────────────────────┼─────────────────┘    │
└──────────────────────────────────────┼──────────────────────┘
                                       │ TCP/3306
                                       ▼
                          ┌─────────────────────────┐
                          │         MySQL           │
                          │    (tanah database)     │
                          └─────────────────────────┘
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

## Layers

### Presentation Layer
- **Next.js App Router**: File-based routing with React Server Components
- **React Components**: Server and client components for UI rendering
- **CSS Modules**: Scoped styling for components

### Data Access Layer
- **Static Data**: JSON files imported at build time (sefarim, cycles)
- **MySQL Client**: `mysql2` library for direct database queries
- **Services**: Type-safe data fetching functions (`getArticlesByPerekId`)

## Related Documentation

- [API Architecture](../api/api.md) - Backend API for mobile app
- [App Architecture](../app/app.md) - Mobile application
- [Repository Structure](../repo-structure.md) - Overall project structure
