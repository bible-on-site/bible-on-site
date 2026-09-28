# Delivery Rule

For repository change, build, or fix tasks, local-only work is not a completed delivery. Commit and push the finished, validated changes at minimum. When authorization and repository policy permit, carry the pull request through CI and merge it. Stop short only when the user explicitly requests review before publication or a hard blocker prevents pushing or merging; report that blocker and the exact remaining action.

# Pull Request Branch Sync

Sync a pull request branch with its base only when both conditions hold: the current head has no green CI result, and there is an actual merge conflict. A branch being behind its base is not, by itself, a reason to sync.
