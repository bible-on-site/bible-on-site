# Bible On Site - Repository Structure

```
bible-on-site/
├── .github/
│   └── workflows/ <-- GitHub Actions CI/CD Workflows
├── .pre-commit-config.yaml <-- git hook checks (installed via pre-commit)
├── app/ <-- Mobile/Desktop Application (.NET MAUI)
│   ├── BibleOnSite/ <-- App source
│   ├── BibleOnSite.E2eCoverage/ <-- In-app E2E coverage recorder (AltCover)
│   ├── BibleOnSite.Tests*/ <-- xUnit suites (unit, desktop E2E/FlaUI, MobileE2E/Appium)
│   ├── devops/ <-- NUKE build/test targets
│   └── mobile-e2e/ <-- Appium harness + scripts + e2e-impact.json contract
├── data/ <-- Data Generation Scripts and pipelines as code
├── devops/ <-- cross-module DevOps related scripts
│   ├── github/ci/ <-- CI tooling: determine-changes, e2e-impact selector, codecov gates
│   ├── e2e-coverage-trees/ <-- Executable-coverage tree extraction (Appium evidence)
│   ├── android-emulator/ <-- Android runner scripts
│   ├── rustfs/ <-- Local S3-compatible store for tests
│   └── deploy/ <-- Deployment related scripts
├── docs/ <-- Documentation
│   ├── aws/ <-- AWS IaC and Architecture Docs
│   ├── devops/ <-- DevOps docs (incl. e2e-test-selection.md)
│   ├── github/ <-- GitHub related Docs (workflows/ci, workflows/cd, version-verification)
│   ├── practices/ <-- Engineering practices (testing.md, implementation.md)
│   ├── tests/ <-- Test architecture + per-module coverage docs
│   ├── daily-bulletin/ <-- Daily Bulletin Service Docs
│   ├── incidents/, performance/, plans/, tanahpedia/, api/, app/, data/ <-- module docs
│   └── website/ <-- Website Architecture Docs
└── web/ <-- Services
    ├── admin/ <-- Admin Panel (React + Vite)
    ├── api/ <-- Backend API (Mostly for mobile app) Service
    │   ├── devops/ <-- DevOps related scripts
    │   ├── entities/ <-- Database Entities
    │   ├── src/
    │   │   ├── common/ <-- Common Utilities
    │   │   ├── dtos/ <-- Data Transfer Objects
    │   │   ├── providers/ <-- External Service Providers
    │   │   ├── resolvers/ <-- GraphQL Resolvers
    │   │   ├── services/ <-- Business Logic Services
    │   │   └── startup/ <-- Application Startup Code
    │   └── tests/ <-- Tests
    ├── bible-on-site/
    │   ├── public/ <-- Public Assets
    │   │   ├── icons/ <-- icons
    │   │   ├── images/ <-- general images
    │   │   │   └── logos/ <-- logo images
    │   │   └── root/ <-- root public assets
    │   ├── shared/ <-- Shared Code Between product and tests
    │   ├── src/
    │   │   ├── app/ <-- root page code and app-wide code
    │   │   │   ├── 929/ <-- 929 page
    │   │   │   ├── api/ <-- Not to be confused with the web/api service, contains minimalist API interaction for the website
    │   │   │   │   └── dev/ <-- development only API interaction code
    │   │   │   │       └── coverage/ <-- coverage related API interaction code
    │   │   │   ├── components/ <-- Shared React Components
    │   │   │   └── fonts/ <-- font files
    │   │   ├── data/ <-- data as code and DAL
    │   │   │   └── db/ <-- data as code
│   │   ├── lib/ <-- shared libraries (DB client, services)
│   │   │   ├── articles/ <-- articles data service
│   │   │   └── download/ <-- bulletin client (PDF generation via Lambda/binary)
    │   │   └── util/ <-- utilities / BL
    │   └── tests/ <-- Tests
    │       ├── e2e/ <-- End to End Tests per Page
    │       ├── perf/ <-- Performance Tests
    │       ├── unit/ <-- Unit Tests (maintain src/ structure within)
    │       └── util/ <-- Test Utilities
    │           ├── coverage/ <-- Coverage Related Utilities
    │           ├── jest/ <-- Jest (Unit) Related Utilities
    │           └── playwright/ <-- Playwright (E2E & Performance) Related Utilities
    ├── bulletin/ <-- Bulletin PDF Generator (Rust, deployed as AWS Lambda)
    │   ├── src/ <-- Source code
    │   └── tests/ <-- Tests
    └── shared/ <-- Shared Code Between web/api and web/bible-on-site
        └── tests-util/ <-- Shared Test Utilities Between web/api and web/bible-on-site
```