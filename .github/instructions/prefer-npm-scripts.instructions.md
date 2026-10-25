---
description: "Always prefer npm/cargo-make/nuke scripts over raw CLI commands"
applyTo: "**"
---

# Prefer Project Scripts Over Raw CLI

Always run the repo's task runner (npm scripts, `cargo make`, `dotnet nuke`) rather than the underlying CLI — `bun run dev`, `bun run test`, `bun run build`, not `bun x next dev -p 3001`, `bun x jest`, `bun x next build`.

Check `package.json` (or equivalent) for a matching task before running anything: scripts carry the required flags, env files (`dotenv -e .dev.env`), and ports, and bypassing them breaks subtly.
