# Bible On Site - Repository Structure

```
bible-on-site/
├── .github/
│   └── workflows/ <-- GitHub Actions CI/CD Workflows
├── .husky/ <-- cross-module pre-commit hooks for git
├── app/ <-- Mobile Application
├── data/ <-- Data Generation Scripts and pipelines as code
├── devops/ <-- cross-module DevOps related scripts
│   ├── coverage/ <-- Coverage related scripts
│   └── deploy/ <-- Deployment related scripts
├── docs/ <-- Documentation
│   ├── aws/ <-- AWS IaC and Architecture Docs
│   │   ├── architecture/ <-- Architecture Docs
│   │   └── cloudformation/ <-- CloudFormation IaC Docs
│   ├── github/ <-- GitHub related Docs
│   └── repo-structure/ <-- This Documentation
└── web/ <-- Services
    ├── api/ <-- Backend API (Mostly for mobile app) Service
    │   ├── .husky/ <-- pre-commit hooks for git
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
    │   ├── .husky/ <-- pre-commit hooks for git
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
    │   │   └── util/ <-- utilities / BL
    │   └── tests/ <-- Tests
    │       ├── e2e/ <-- End to End Tests per Page
    │       ├── perf/ <-- Performance Tests
    │       ├── unit/ <-- Unit Tests (maintain src/ structure within)
    │       └── util/ <-- Test Utilities
    │           ├── coverage/ <-- Coverage Related Utilities
    │           ├── jest/ <-- Jest (Unit) Related Utilities
    │           └── playwright/ <-- Playwright (E2E & Performance) Related Utilities
    └── shared/ <-- Shared Code Between web/api and web/bible-on-site
        └── tests-util/ <-- Shared Test Utilities Between web/api and web/bible-on-site
```