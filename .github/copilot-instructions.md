# Copilot Instructions

## Documentation References

When working on this repository, please refer to the relevant documentation under the `docs/` directory:

- **Repository Structure**: For you to navigate through the code base, read `docs/repo-structure/`
- **GitHub CI/CD**: For GitHub in general, for Actions, workflows, continuous integration, or continuous deployment topics, read `docs/github/`
- **AWS**: For AWS infrastructure, architecture, or related topics, read `docs/aws/`

## Implementation Instructions

### General Instructions

- That's a Jewish Orthodox project, avoid any Christian terminology and reformist expressions
- Currently still use the Perakim division despite being a christian division and not the Parashot division.

### Terminology Instructions

When referring to religious texts in this repository, please use the following terminology consistently:

- Use the term Tanah instead of Bible
- Use the term Sefer instead of Book (Plural: Sefarim)
- Use the term Perek instead of Chapter (Plural: Perakim)
- Use the term Pasuk instead of Verse (Plural: Pesukim)
- Based on Ḥazal: שמואל, מלכים, עזרא, דברי הימים are not splitted into two books. In order to solve this mismatch, the splits are considered as a sub split under the same book. This term for this sub-split is "Additional". Usually followed by the perek name in UI.
  The addtionals for שמואל, מלכים ודברי הימים are א, ב. sometimes referred as 1, 2 in source code, and ע, נ or 70, 50 accordingly for עזרא.
- When referring to the books of the Tanah in the codebase, use their Hebrew names, and not their tanachUS names (I.E. בראשית instead of Genesis) unless there is a specific tanachUS related context.

### Implementation Instructions

When implementing features or making changes in this repository, please adhere to the following guidelines:

- **Never ignore compiler or linter errors/warnings.** Always fix issues reported by TypeScript, Rust, .NET compilers, Biome, ESLint, Clippy, or any other static analysis tool before committing code. Mainitain 0 problems in vscode (exception are currently: [{
  "resource": "<repo_root>/.github/workflows/ci.yml",
  "message": "Context access might be invalid: module_changed",
  }] and [{
  "resource": "<repo_root>/.github/workflows/ci.yml",
  "message": "Unable to find reusable workflow",
  }], and warnings for web/api until cleaned up).

### web/bible-on-site Instructions

When working on the `web/bible-on-site` project (website):

- Use playwright at http://localhost:3001 (`npm run dev` might be required if not already on)
- Use of client components is forbidden unless I explicitly ask for it
- Tests: `npm run test:unit` (unit), `npm run test:e2e` (e2e)
- Coverage: `npm run coverage:unit`, `npm run coverage:e2e`

#### Implementation Instructions

- When writing a test, and asserting non null using the framework, you can use the non null assertion operator after and decorate the usage with a linter suppression comment explaining why it's safe.
- When catching an error, log that it took place using console.warn or console.error.

### AWS Infrastructure Instructions

When working on the AWS infrastructure for this repository, please adhere to the following guidelines:

- Every accpeted change must be reflected in the infrastructure as code (IaC) templates located in the `infrastructure/` directory.
- Do not act the opposite, means, do not invoke CloudFormation based on templates located in the `infrastructure/` directory as they are currently for reference only and never really tested.
