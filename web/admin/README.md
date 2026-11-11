# Admin Panel - תנ"ך על הפרק

The React and TanStack Start application for content editors and archive uploaders.
It runs separately from the customer website.

## Features

- Article editing with TipTap, chapter navigation and automatic saving.
- Rabbi profiles and images, Tanahpedia editing, daily bulletins and other editorial tools.
- A private archive at `/archive`, with folders, file uploads, downloads and storage quotas.

## Archive access

Open `/archive` in the Admin application. Uploaders use the username and password
provided by the site team through **כניסה לחשבון**. Administrators use
**כניסת מנהל** with their existing sign-in. Accounts are pre-created; the archive
does not offer public registration.

| Role | Application access | Directory access | Allowed actions |
| --- | --- | --- | --- |
| `admin` | All Admin sections, including `/archive-settings` | Root `/`, general folders and every author home | Create folders, upload, download and delete completed files |
| `archiver` | Archive only | Own `/authors/<author name>/` and descendants | Create folders, upload, download and cancel incomplete uploads |

Directory paths describe the archive filesystem. For example, an author's home
is `/authors/<author name>/`, while its browser URL is
`/archive/authors/<author name>`. Uploaders cannot browse another author's home
or use other Admin pages and server functions. Completed files can be deleted
only by an administrator.

Select files with the upload control; any file type is supported. Each account
defaults to **1000 decimal GB (1 TB)**. Administrators can change the default and
individual limits in `/archive-settings`. Incomplete uploads reserve their full
file size until completed or cancelled.

The archive serves authenticated downloads through the Admin service and sends
no-store and noindex headers. See the existing [private archive guide](../../docs/aws/private-archive.md)
for storage, account provisioning and deployment details.

## Local development

Use the Node.js and Bun versions in [package.json](package.json), Docker, and the
repository's Rust toolchain with `cargo-make` for database bootstrap tooling.
From `web/admin`:

```bash
bun install
bun run dev
```

`predev` starts the shared Docker services, ensures the local database exists,
and checks local image storage when configured. The app runs at
`http://localhost:3101`.

The development command loads `.dev.env`. Set local overrides in your shell or
your local `.dev.env`; do not commit credentials. `.env.example` documents the
optional settings. The server reads `DB_URL` for MySQL and defaults to
`tanah-dev` outside production when it is unset. Use `sync-from-prod` for real
local content. Database population scripts are bootstrap and test tools;
lasting production content changes belong in the database or Admin editing flow.

The public image integration uses server-side `S3_*` variables from `.env.example`.
`VITE_WEBSITE_URL` and the server-only `REVALIDATE_SECRET` configure website
cache invalidation. Keep credentials and `OPENAI_API_KEY` server-side; `VITE_*`
values can be included in browser bundles. The optional Tanahpedia assistant is
documented in [Admin LLM assistant](../../docs/tanahpedia/admin-llm-assistant.md).

`SKIP_AUTH=true` is a local development/test option. It cannot disable
authentication in a production runtime. The private archive has its own
`ARCHIVE_*` configuration, documented in the private archive guide above.

## Build and validation

```bash
bun run build
bun run start
```

`build` creates the TanStack Start/Nitro output; `start` runs
`.output/server/index.mjs` with the supplied runtime environment.

- Unit tests: `bun run test:unit`; coverage: `bun run coverage:unit`.
- MySQL integration tests: `bun run test:mysql`.
- Browser tests: `bun run test:e2e`; coverage: `bun run coverage:e2e`.
- Merge unit and browser coverage: `bun run coverage:merge`.
- Lint: `bun run lint`.

Coverage reports live under `.coverage/unit`, `.coverage/e2e` and
`.coverage/merged`. CI publishes the merged report with the Codecov `admin` flag.

## Source layout

```text
src/
├── routes/        # TanStack file routes and server-function entry points
├── components/    # Editor, layout and archive UI
├── server/        # Authentication, database access, archive and integrations
├── lib/           # Shared application types and validation
├── styles/        # Application styles
└── utils/         # Display helpers
tests/
├── unit/
├── integration/
└── e2e/
```

## Related

- [Rust API](../api) - Shared content API.
- [Customer website](../bible-on-site) - Public site managed by this application.
