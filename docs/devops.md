# DevOps

This document describes the DevOps tools and practices used in the Bible on Site project.

## Toolset Overview

### 📋 PLAN

| Tool | Purpose | Module |
|------|---------|--------|
| [![GitHub Issues](https://img.shields.io/badge/GitHub%20Issues-181717?logo=github&logoColor=fff&style=for-the-badge)](https://github.com/features/issues) | Issue tracking and task management | * |
| [![GitHub Projects](https://img.shields.io/badge/GitHub%20Projects-181717?logo=github&logoColor=fff&style=for-the-badge)](https://github.com/features/issues) | Project boards and roadmap planning | * |
| [![Renovate](https://img.shields.io/badge/Renovate-1A1F6C?logo=renovatebot&logoColor=fff&style=for-the-badge)](https://github.com/renovatebot/renovate) | Automated dependency updates | * |
| [![Dependabot](https://img.shields.io/badge/Dependabot-2088FF?logo=dependabot&logoColor=fff&style=for-the-badge)](https://github.com/dependabot) | Security vulnerability updates | * |
| [![Markdown](https://img.shields.io/badge/Markdown-%23000000.svg?logo=markdown&logoColor=white&style=for-the-badge)](#) | Documentation and planning | * |

### 💻 CODE

| Tool | Purpose | Module |
|------|---------|--------|
| [![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=fff&style=for-the-badge)](https://github.com/) | SCM | * |
| [![Git](https://img.shields.io/badge/Git-F05032?logo=git&logoColor=fff&style=for-the-badge)](#) | Version control | * |
| [![Visual Studio Code](https://custom-icon-badges.demolab.com/badge/Visual%20Studio%20Code-0078d7.svg?logo=vsc&logoColor=white&style=for-the-badge)](https://code.visualstudio.com/) | Primary IDE | * |
| [![GitHub Copilot](https://img.shields.io/badge/GitHub%20Copilot-000?logo=githubcopilot&logoColor=fff&style=for-the-badge)](#) | AI-assisted coding | * |
| [![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) | Website language | website, api (tests) |
| [![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/) | Website framework | website |
| [![React](https://img.shields.io/badge/React-%2320232a.svg?logo=react&logoColor=%2361DAFB&style=for-the-badge)](https://reactjs.org/) | Website library | website |
| [![CSS](https://img.shields.io/badge/CSS-639?logo=css&logoColor=fff&style=for-the-badge)](#) | Website styling | website |
| [![.NET MAUI](https://img.shields.io/badge/.NET%20MAUI-512BD4?logo=dotnet&logoColor=fff&style=for-the-badge)](https://dotnet.microsoft.com/en-us/apps/maui) | App framework | app |
| [![C#](https://custom-icon-badges.demolab.com/badge/C%23-%23239120.svg?logo=cshrp&logoColor=white&style=for-the-badge)](https://learn.microsoft.com/en-us/dotnet/csharp/) | App language | app |
| [![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/) | API language | api |
| [![Actix Web](https://img.shields.io/badge/Actix%20Web-800080?style=for-the-badge&logo=actix)](https://actix.rs/) | API framework | api |
| [![GraphQl](https://img.shields.io/badge/GraphQl-E10098?style=for-the-badge&logo=graphql&logoColor=white)](https://graphql.org) | API query language | api |
| [![SeaORM](https://custom-icon-badges.demolab.com/badge/SeaORM-000000.svg?logo=sea-orm&style=for-the-badge)](https://www.sea-ql.org/SeaORM/) | ORM | api |
| [![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?logo=mongodb&logoColor=white&style=for-the-badge)](https://www.mongodb.com/) | Data pipeline | * |
| [![Biome](https://img.shields.io/badge/Biome-60a5fa?style=for-the-badge&logo=biome&logoColor=white)](https://biomejs.dev/) | Linter & Formatter | website |
| [![Clippy](https://img.shields.io/badge/Clippy-000?style=for-the-badge&logo=rust&logoColor=white)](https://doc.rust-lang.org/clippy/) | Linter & Formatter | api |
| [![SonarQube](https://img.shields.io/badge/SonarQube-126ED3?logo=sonarqubecloud&logoColor=fff&style=for-the-badge)](https://www.sonarsource.com/products/sonarcloud/) | Linter | app |
| [![Husky](https://custom-icon-badges.demolab.com/badge/Husky-000000.svg?logo=husky&style=for-the-badge)](https://typicode.github.io/husky/) | Git hooks for pre-commit checks | * |

### 🔨 BUILD

| Tool | Purpose | Module |
|------|---------|--------|
| [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=fff&style=for-the-badge)](https://www.npmjs.com/) | Node.js package manager | website |
| [![NuGet](https://img.shields.io/badge/NuGet-004880?logo=nuget&logoColor=fff&style=for-the-badge)](https://www.nuget.org/) | .NET package manager | app |
| [![Cargo](https://img.shields.io/badge/Cargo-000?style=for-the-badge&logo=rust&logoColor=white)](https://doc.rust-lang.org/cargo/) | Rust package manager | api |
| [![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/) | Production website build | website |
| [![cargo-make](https://img.shields.io/badge/cargo--make-000?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/sagiegurari/cargo-make) | Rust task automation | api |
| [![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/features/actions) | CI/CD workflow automation | * |

### 🧪 TEST

| Tool | Purpose | Module |
|------|---------|--------|
| [![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io) | Unit testing | website |
| [![Playwright](https://custom-icon-badges.demolab.com/badge/Playwright-2EAD33?logo=playwright&logoColor=fff&style=for-the-badge)](https://playwright.dev) | E2E and performance testing | website, api |
| [![cargo-llvm-cov](https://img.shields.io/badge/cargo--llvm--cov-000?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/taiki-e/cargo-llvm-cov) | Rust code coverage | api |
| [![lcov](https://img.shields.io/badge/lcov-000?style=for-the-badge&logo=linux&logoColor=white)](https://github.com/linux-test-project/lcov) | Coverage report merging | * |
| [![monocart-coverage-reports](https://custom-icon-badges.demolab.com/badge/monocart--coverage--reports-000?logo=monocart-coverage-reports&style=for-the-badge)](https://github.com/cenfun/monocart-coverage-reports) | Typescript code coverage reporting | website |
| [![web-vitals](https://img.shields.io/badge/web--vitals-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://github.com/GoogleChrome/web-vitals) | performance measuring | website |
| [![SWC-coverage-instrument](https://img.shields.io/badge/SWC--coverage--instrument-000?style=for-the-badge&logo=next.js&logoColor=white)](https://github.com/kwonoj/swc-plugin-coverage-instrument) | istanbuljs coverage instrumentation for nextjs | website |

### 📦 RELEASE

| Tool | Purpose | Module |
|------|---------|--------|
| [![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/features/actions) | Automated release workflow | * |
| [![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/) | Container image building | website, api |
| [![semver-bump](https://img.shields.io/badge/semver--bump-000?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/pksunkara/semver-bump) | Semantic version bumping | api |
| [![tomato-toml](https://img.shields.io/badge/tomato--toml-000?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/Amanieu/tomato-toml) | TOML file manipulation (Cargo.toml) | api |
| [![Git Tags](https://img.shields.io/badge/Git%20Tags-F05032?style=for-the-badge&logo=git&logoColor=white)](https://git-scm.com/book/en/v2/Git-Basics-Tagging) | Version tagging | * |

### 🚀 DEPLOY

| Tool | Purpose | Module |
|------|---------|--------|
| [![AWS ECR](https://custom-icon-badges.demolab.com/badge/AWS%20ECR-000000.svg?logo=ecr&style=for-the-badge)](https://aws.amazon.com/ecr/) | Container registry | website, api |
| [![EventBridge](https://custom-icon-badges.demolab.com/badge/EventBridge-000000.svg?logo=eventbridge&style=for-the-badge)](https://aws.amazon.com/eventbridge/) | Update ECS on ECR latest push | website, api |
| [![crane](https://custom-icon-badges.demolab.com/badge/crane-000000.svg?logo=crane&style=for-the-badge)](https://github.com/google/go-containerregistry/tree/main/cmd/crane) | deploy docker to ECR | website, api |
| [![OIDC](https://img.shields.io/badge/OIDC-000?style=for-the-badge&logo=openid&logoColor=white)](https://openid.net/connect/) | Github-actions-to-AWS auth | website, api |

### ⚙️ OPERATE

| Tool | Purpose | Module |
|------|---------|--------|
| [![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/) | runtime | website |
| [![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=fff&style=for-the-badge)](https://nodejs.org/) | runtime | website |
| [![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=fff&style=for-the-badge)](https://www.mysql.com/) | Database | website, api |
| [![AWS ECS](https://custom-icon-badges.demolab.com/badge/AWS%20ECS-000000.svg?logo=ecs&style=for-the-badge)](https://aws.amazon.com/ecs/) | Container orchestration | website, api |
| [![AWS Fargate](https://custom-icon-badges.demolab.com/badge/AWS%20ECS%20Fargate-000000.svg?logo=fargate&style=for-the-badge)](https://aws.amazon.com/fargate/) | Serverless container runtime | website, api |
| [![Route 53](https://custom-icon-badges.demolab.com/badge/Route%2053-000000.svg?logo=route53&style=for-the-badge)](https://aws.amazon.com/route53/) | DNS management | website, api |
| [![EC2](https://custom-icon-badges.demolab.com/badge/EC2-000000.svg?logo=ec2&style=for-the-badge)](https://aws.amazon.com/ec2/) | Reverse proxy (Nginx) | website, api |

<!-- [![CloudFront](https://custom-icon-badges.demolab.com/badge/CloudFront-000000.svg?logo=cloudfront&style=for-the-badge)](https://aws.amazon.com/cloudfront/) CDN and edge caching -->

### 📊 MONITOR

| Tool | Purpose | Module |
|------|---------|--------|
| [![Codecov](https://img.shields.io/badge/Codecov-F01F7A?logo=codecov&logoColor=fff&style=for-the-badge)](https://about.codecov.io/) | Code coverage reporting | * |
| [![Codacy](https://img.shields.io/badge/Codacy-222F29?logo=codacy&logoColor=fff&style=for-the-badge)](https://www.codacy.com/) | Code quality analysis | * |
| [![CloudWatch](https://custom-icon-badges.demolab.com/badge/CloudWatch-000000.svg?logo=cloudwatch&style=for-the-badge)](https://aws.amazon.com/cloudwatch/) | scale the ECS in / out | website, api |

## Workflows
- [CI](docs/github/workflows/ci.md)
- [CD](docs/github/workflows/cd.md)
