# Delivery Rule

For repository change, build, or fix tasks, local-only work is not a completed delivery. Commit and push the finished, validated changes at minimum. When authorization and repository policy permit, carry the pull request through CI and merge it. Stop short only when the user explicitly requests review before publication or a hard blocker prevents pushing or merging; report that blocker and the exact remaining action.

Take responsibility for the overall quality of this project and every flaw encountered while working on it. Investigate and fix flaws whether they are related to the current request, predate the task, appear in another module, or are found by tests, CI, review, or direct inspection. Do not leave a known flaw merely because it does not block the pull request or was caused elsewhere. Validate and deliver each fix through the repository's normal commit, push, CI, and merge process. Stop with a known flaw unresolved only if the user explicitly defers it or a hard blocker prevents a fix; report the evidence and exact remaining action.

For changes limited to README files, local test suites and CI are not required for validation. Commit and push, then request merge without waiting for optional checks. If repository policy requires CI or a merge queue, let those checks run and verify the final merge result.

# Task Permissions

For a task the user assigns, you may grant the local tool, Docker file-sharing, and workspace access permissions needed to complete and validate that task. Keep each grant scoped to the task and follow platform security prompts and repository policy. Do not ask the user to repeat this authorization.

# Worktree Isolation

Use a dedicated Git worktree for every task unless the entire task can be completed using API calls alone. Create or reuse a worktree belonging to the current task before changing repository files or running builds. Do not switch branches or modify files in another task's checkout. After delivery, archive the task's managed worktree or remove its unmanaged worktree.

# Data Ownership

Application content belongs in the database. Treat the Rust db-populator and local population scripts as temporary bootstrap and test tooling, not as a source of production content. Populate the local database from production with `sync-from-prod`; make lasting content changes through the database deployment or admin editing path. Do not add production place or article content to the Rust populator just to make it appear locally.

# Hebrew Text and Source Formatting

Use plain Hebrew letters in source references, separated by spaces, with no commas, geresh, or gershayim: `יהושע י א`, `יהושע כג א`, `שמואל ב ה ו`. Use the regular ASCII hyphen `-` for source ranges, such as `בראשית ל ו-ח`. Apply this consistently across the website, admin, native app, previews, and exports.

Use the regular ASCII double quote `"` in Hebrew UI text and abbreviations, such as `תנ"ך`, rather than typographic quotes or Hebrew gershayim `״`. Use the regular ASCII apostrophe `'` when an apostrophe is needed. Use the regular ASCII hyphen `-` rather than Hebrew maqaf `־` or typographic dashes in authored text. Preserve the biblical maqaf `־` in canonical scripture with taamim, and preserve database content at rest; accept legacy punctuation when parsing existing references and normalize their display.

# Dependency Upgrade Rule

For a dependency upgrade task, refresh every dependency kind within the user's requested scope: direct packages, transitive packages and lockfiles, toolchains, build images, CI actions, and related configuration. Make the code and test changes needed to work with current releases. Defer an upgrade only when a concrete, substantial incompatibility in the current open-source ecosystem makes alignment impractical. For each deferral, create a follow-up issue and link it beside the pin and in the corresponding Renovate rule. Do not defer merely because the upgrade requires repository code changes.

# Pull Request Branch Sync

Sync a pull request branch with its base only when both conditions hold: the current head has no green CI result, and there is an actual merge conflict. A branch being behind its base is not, by itself, a reason to sync.
