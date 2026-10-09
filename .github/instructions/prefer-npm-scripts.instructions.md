---
description: "Always prefer npm/cargo-make/nuke scripts over raw CLI commands"
applyTo: "**"
---

# Prefer Project Scripts Over Raw CLI

Always run the repo's task runner (npm scripts, `cargo make`, `dotnet nuke`) rather than the underlying CLI — `npm run dev`, `npm test`, `npm run build`, not `npx next dev -p 3001`, `npx jest`, `npx next build`.

Check `package.json` (or equivalent) for a matching task before running anything: scripts carry the required flags, env files (`dotenv -e .dev.env`), and ports, and bypassing them breaks subtly.
