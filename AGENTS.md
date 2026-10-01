# Delivery Rule

For repository change, build, or fix tasks, local-only work is not a completed delivery. Commit and push the finished, validated changes at minimum. When authorization and repository policy permit, carry the pull request through CI and merge it. Stop short only when the user explicitly requests review before publication or a hard blocker prevents pushing or merging; report that blocker and the exact remaining action.

Own every failure that blocks delivery, regardless of whether the task's changes caused it. Investigate and fix or rerun failing checks, including unrelated tests and CI issues, until the pull request merges. Do not stop after attributing a failure to another cause; if a hard blocker remains, report the evidence and exact action still needed.

For changes limited to README files, local test suites and CI are not required for validation. Commit and push, then request merge without waiting for optional checks. If repository policy requires CI or a merge queue, let those checks run and verify the final merge result.

# Task Permissions

For a task the user assigns, you may grant the local tool, Docker file-sharing, and workspace access permissions needed to complete and validate that task. Keep each grant scoped to the task and follow platform security prompts and repository policy. Do not ask the user to repeat this authorization.

# Dependency Upgrade Rule

For a dependency upgrade task, refresh every dependency kind within the user's requested scope: direct packages, transitive packages and lockfiles, toolchains, build images, CI actions, and related configuration. Make the code and test changes needed to work with current releases. Defer an upgrade only when a concrete, substantial incompatibility in the current open-source ecosystem makes alignment impractical. For each deferral, create a follow-up issue and link it beside the pin and in the corresponding Renovate rule. Do not defer merely because the upgrade requires repository code changes.

# Pull Request Branch Sync

Sync a pull request branch with its base only when both conditions hold: the current head has no green CI result, and there is an actual merge conflict. A branch being behind its base is not, by itself, a reason to sync.
