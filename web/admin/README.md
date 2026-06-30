# Admin Panel - תנ"ך על הפרק

A React-based admin panel for managing articles and rabbis content.

## Features

- 📝 **Article Management**: Create, edit, and delete articles with a WYSIWYG editor
- 👤 **Rabbi Management**: Manage rabbi profiles with S3 image upload
- 🔍 **Perek-based Navigation**: Navigate articles by chapter (perek)
- 💾 **Auto-save**: Changes are automatically saved after 2 seconds of inactivity
- 🔄 **Cache Invalidation**: Automatic website cache invalidation when content changes

## Getting Started

### Prerequisites

- Node.js >= 24.11.1
- MySQL database (same as web/bible-on-site)
- AWS S3 bucket for rabbi images (optional)

### Installation

```bash
cd web/admin
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Environment variables:
- `VITE_API_URL`: Admin API URL (default: http://localhost:3004)
- `VITE_WEBSITE_URL`: Main website URL for cache invalidation
- `VITE_AWS_REGION`: AWS region for S3
- `VITE_S3_BUCKET`: S3 bucket name for rabbi images
- `OPENAI_API_KEY` / `OPENAI_MODEL` (optional): Tanahpedia entry LLM assistant — server-side only; see `docs/tanahpedia/admin-llm-assistant.md`

### Development

Start the development server:

```bash
npm run dev
```

This will start the Vite dev server at http://localhost:3101

**מסד נתונים לפיתוח:** `ensure-dev-db.mjs` מריץ `mysql-populate-dev` רק אם אין עדיין `tanah_sefer` (מסד חדש). `mysql-populate-dev` **לא** טוען את `tanah_test_data.sql` (בלי «הרב לדוגמא») — מאמרים אמיתיים מ־`sync-from-prod`. אם כבר היו במסד מאמרי דמו, הם יוסרו בפתיחת dev (אלא אם `KEEP_BUNDLED_TEST_ARTICLES=1`). לדמו מלא כמו ב־CI: `npm run db:populate:dev:test-articles`.

### Building

```bash
npm run build
```

### Tests & coverage

- Unit: `npm run test:unit` / coverage: `npm run coverage:unit` (outputs `web/admin/.coverage/unit/lcov.info`)
- E2E: `npm run test:e2e`
- Merge unit (+ E2E lcov when configured): `npm run coverage:merge` → `web/admin/.coverage/merged/lcov.info`
- CI publishes the merged report to Codecov with flag **`admin`** (see root `README.md`).

## Project Structure

```
src/
├── api/           # API client functions
├── components/    # Reusable UI components
│   ├── Layout.tsx
│   ├── WysiwygEditor.tsx
│   ├── ImageUpload.tsx
│   └── AutoSaveIndicator.tsx
├── pages/         # Page components
│   ├── HomePage.tsx
│   ├── ArticlesPage.tsx
│   ├── ArticleEditPage.tsx
│   ├── PerekArticlesPage.tsx
│   ├── RabbisPage.tsx
│   └── RabbiEditPage.tsx
├── types/         # TypeScript type definitions
└── test/          # Test setup
```

## Dependencies

- React 19 with React Router
- TanStack Query for data fetching
- TipTap for WYSIWYG editing
- Tailwind CSS for styling
- Flowbite React for UI components

## Related

- [Rust API](../api) - Backend API serving data
- [Bible on Site](../bible-on-site) - Main website that this admin manages
