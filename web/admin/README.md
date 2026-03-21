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

### Development

Start the development server:

```bash
npm run dev
```

This will start the Vite dev server at http://localhost:3101

**מסד נתונים לפיתוח:** לפני `npm run dev`, הסקריפט `ensure-dev-db.mjs` בודק אם יש כבר נתונים ב־`parshan`. אם כן — לא מריצים `mysql-populate-dev`, כדי שלא יידרסו נתונים שהועתקו מפרוד (`devops/setup-dev-env.mts sync-from-prod`). אם המסד ריק — מתבצעת טעינת נתוני בדיקה כרגיל.

### Building

```bash
npm run build
```

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
