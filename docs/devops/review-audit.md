# Review-Finding Audit → Local Enforcement (#2114)

## Method

`devops/review-audit/collect-review-findings.mjs` inventories every PR review
thread with activity inside a UTC window (comments filtered on `createdAt`,
never PR creation date). Re-run for a fresh window:

```bash
node devops/review-audit/collect-review-findings.mjs \
  --since <YYYY-MM-DD> --until <YYYY-MM-DD> \
  --out devops/review-audit/findings-<since>_<until>.json
```

Window audited: **2026-09-23 → 2026-10-23 UTC** — 524 PRs touched, 199 with
in-window review activity, 755 threads (669 resolved/accepted).

## Distribution

| Engine | Threads |
|--------|---------|
| github-code-quality (Qodana/JetBrains) | 519 |
| devin-ai-integration (Devin Review) | 222 |
| github-advanced-security (CodeQL) | 12 |
| human | 2 |

Top accepted finding classes and their local gate:

| Accepted finding | Count | Local gate |
|------------------|-------|------------|
| Missed `readonly` | 122 | `S2933` = error (`.editorconfig`) |
| `Path.Combine` may drop earlier args | 122 | **gap — no Roslyn/Codacy-gate equivalent** |
| Generic catch clause | 97 | `S2221` = error — 89 app + 8 devops sites triaged (6 narrowed to real types, 87 annotated boundaries) |
| Missing `Dispose` on local `IDisposable` | 27 | `S2930` = error — 3 sites fixed (cancel→dispose→replace) |
| `GC.Collect()` | 24 | `S1215` = error — 9 test sites consolidated into `Support/GarbageCollection.cs` |
| Superfluous trailing args (Python) | 22 | **gap — no local equivalent** |
| `Where`/`Select` opportunities | 20 | `S3267` = error — 6 loops converted |
| Float equality | 14 | `S1244` (already enforced) |
| Constant condition / identical operands / unreachable | 22 | `S2583`, `S1764` = error |
| CodeQL sanitization | 12 | CodeQL workflow (already CI) |
| Explicit/implicit mixed returns (Python) | 5 | `RET502` (ruff) |
| `import` + `import from` (Python) | 4 | **gap — no local equivalent** |
| Unnecessarily complex boolean | 4 | `S2589`-family coverage via `S2583` |
| Empty/BaseException except (Python) | 4 | `BLE001`, `E722`, `S110` (ruff) |
| Missed `using` / missed ternary | 7 | `IDE0063`, `IDE0045` = error |
| Static field written by instance method | 2 | `S2696` = error — 1 site made instance |
| Unused locals/imports | 6 | `F401` (ruff, already); C# via existing warnings |
| Optional parameters | (S2360) | already enforced — 1 straggler in Tests.E2E converted to overloads |

## The NOSONAR trap this closes

The repo's documented convention for a *deliberate* generic catch is
`//NOSONAR` + meaningful logging — the justification the reviewers accepted.
`//NOSONAR` is honored by Codacy/SonarQube/Qodana but **not** by
`SonarAnalyzer.CSharp` on `dotnet build` — catches carrying it kept compiling
while the scanners still flagged new unannotated sites. Every annotated
boundary now carries the pair:

```csharp
#pragma warning disable S2221 // Deliberate failure boundary: <reason>
catch (Exception ex) //NOSONAR — <reason>
{
#pragma warning restore S2221
    ...
}
```

An unannotated `catch (Exception)` now fails the build locally via the
`dotnet-analyzers` pre-commit hook before it can reach Codacy.

## Narrowed vs justified

Narrowed to real types where the try body is provably bounded:
`HebrewCalendar` conversions → `ArgumentException`; `_metadata` SQLite reads →
`SQLiteException`; bundled-pasuk loads → `SQLiteException | IOException`;
package-file probe → `FileNotFoundException | IOException | NotSupportedException`;
Python `pymysql` statements → `pymysql.Error` / `ProgrammingError`.

Justified as boundaries (all already logged or probing): event-handler/UI
boundaries, service loads degrading to a user-facing error or empty fallback,
availability probes, diagnostics collectors, recitation/download lifecycle
swallows. `S2221` does not fire inside test methods — MobileE2E's
diagnose-then-`throw` catches need no annotation.

## Documented gaps (no local gate exists)

- `Path.Combine` arg-drop (JetBrains `PathCombineArguments`) — no Roslyn or
  regex-safe equivalent; remains a review-time check.
- Python "superfluous trailing arguments" and `import`/`import from` mixing —
  JetBrains inspections with no Ruff rule.
- Nullable-dereference findings (`CS8602` class) — `nullable` is on but
  warnings are not errors; flipping CS86xx to error is a larger
  behavior-surface change deferred to its own task.

## Files

- `.editorconfig` — second-wave severities: `S2221`, `S2933`, `S2930`, `S1215`,
  `S3267`, `S2583`, `S1764`, `S2696`, `IDE0045`, `IDE0063`.
- `.pre-commit-config.yaml` — `dotnet-analyzers` hook + widened `ruff-check`
  select (`F,D2,BLE001,E722,S110,RET502`).
- `devops/precommit-dotnet.mjs` — per-project `dotnet build` bucket hook.
- `devops/review-audit/` — collector, catch scanner, annotation tool.
