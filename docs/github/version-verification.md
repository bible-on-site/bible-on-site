# Module Version Bumps

Module versions are never bumped in pull requests. PR and merge-queue checks validate
the proposed code without requiring a version change.

After a module releases from `master`, the `Bump Versions` job increments its version
on `master`, including the website. The bump is pushed with `[skip ci]`, so master
normally holds the next unreleased version and the next merge can release it directly.
The app build-number consistency check in `devops/check-app-version.py` remains active.

If a release tag already exists but belongs to another commit, the release job warns,
skips tag creation and release, and sets `needs_bump`. The master bump job then increments
that module and pushes a separate retry commit without `[skip ci]`. That push starts a
new CI run for the bumped module, which can package and release its new version. The
release workflow only dispatches CD when it created the tag, so retry runs do not deploy
the colliding release.

Hosted Renovate needs no version-bump configuration. It updates dependencies normally;
module version bumps happen only after releases on `master`.
