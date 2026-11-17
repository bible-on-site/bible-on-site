# Contributing to Bible on Site
Welcome, and thank you for your interest in contributing to Bible on Site!

There are several ways in which you can contribute, beyond writing code. The goal of this document is to provide a high-level overview of how you can get involved.

## Generalists
Please report any bugs found on a production platform (website, app, etc.).
This could be anything, from malfunctioning feature to a typo within an article.

## Technologists
There are many ways to contribute to BibleOnSite: logging bugs, submitting pull requests, reporting issues, and creating suggestions.

After cloning and building the repo, check out the [issues list](https://github.com/bible-on-site/bible-on-site/issues?utf8=%E2%9C%93&q=is%3Aopen+is%3Aissue). Issues labeled [`help wanted`](https://github.com/bible-on-site/bible-on-site/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) are good issues to submit a PR for. Issues labeled [`good first issue`](https://github.com/bible-on-site/bible-on-site/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are great candidates to pick up if you are in the code for the first time. If you are contributing significant changes please discuss with the assignee of the issue first before starting to work on the issue.

### QA Testers
Contribute test cases:
- For the website, add tests under `web/bible-on-site/tests`.
- For the API, add tests under `web/api`.

- For native app unit tests, add cases under `app/BibleOnSite.Tests`.

### Software Developers
Submit pull requests or suggest assigning yourself to any issue.

### DevOps
Suggest assigning yourself to any issue tagged with `DevOps`.

## Documentation, artifacts and evidence

Documentation describes current features, behavior and processes, or plans for the future. Historical diffs, before/after writeups and change/delivery reports belong in issues, pull requests or CI records. Include historical comparisons in repository documentation only when necessary to explain an important decision and why it was made.

Never commit or push artifacts or evidence, including **before/after pictures**, screenshots, recordings, generated reports and handoff/download bundles, without prior **explicit approval from DoradSoft** for those materials and their repository destination. This applies to all directories and branches, including `docs/evidence/`. Attach files to the issue or PR, or use CI/release artifact storage, and link to them instead of creating a repository mirror or artifact-only PR.

An ordinary implementation, validation or handoff request does not approve artifact commits. Record any explicit approval and its scope in the PR description. The important-decision documentation exception does not waive this approval requirement. See [AGENTS.md](AGENTS.md) for the repository's delivery and documentation rules.
