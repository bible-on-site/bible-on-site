# Repository History Cleanup — Option A Execution Plan

Tracking issue: [#1968](https://github.com/bible-on-site/bible-on-site/issues/1968).
Approved option: **A — strip history of the generated dump paths, re-commit the
current files as regular blobs** (owner decision: "Go with A", issue comment by
doradsoft). This document is the prepared migration proposal required by the
issue's November 3 triage note: fresh measurements, reference/CI compatibility
checks, preservation/recovery evidence, and the choices that still need owner
review before a coordinated execution.

**No part of this plan has been executed against the remote.** The rewrite was
rehearsed on a local scratch mirror only. Execution requires an explicit go-ahead
plus a coordinated freeze window, because it force-pushes every branch and tag
and invalidates every existing clone.

## Fresh measurements (November 2026)

The October 5 snapshot (394.9 MiB clone pack) is stale. Re-measured today from a
fresh `--bare` clone of `origin` (heads + tags — the refs a real clone fetches):

| Metric | October 5 | Today |
|---|---|---|
| Clone pack size (`size-pack`) | 394.9 MiB | **591.30 MiB** |
| Reachable commits (heads+tags) | — | 3,776 |
| Branches / tags / open PRs | — | 136 / 808 / 44 |

Largest paths by cumulative raw blob size across all reachable history:

| Path | Raw total | Versions | In HEAD |
|---|---|---|---|
| `web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json` | **6.96 GB** | 82 | yes, 43 MB |
| `web/bible-on-site/package-lock.json` | 666 MB | 1,816 | yes (normal churn, keep) |
| `app/…/AssetPacks/perushim_notes/sefaria-dump-5784-sivan-4.perushim_notes.sqlite.gz` | 517 MB | 9 | yes, 86 MB |
| `data/recitation/recitation.sqlite` | 355 MB | 72 | yes, 17 MB |
| `app/…/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite` | 325 MB | 9 | yes, 38 MB |
| `web/admin/package-lock.json` | 104 MB | 266 | yes (normal churn, keep) |
| `web/bulletin/data/tanach-text.json` | 10.6 MB | 2 | yes, 5.5 MB |
| `data/recitation/corrections/**.mp3` (not in HEAD) | 11.4 MB | 5 | no |
| `web/api/.playwright-report/**` | 0.9 MB | 2 | 1 file (untracked in this PR) |
| `actionlint` (stray root binary) | 5.6 MB | 1 | no |
| `data/recitation/benchmarks/golden-2026-10-07.json` (uncompressed; HEAD keeps `.json.gz`) | 5.4 MB | 1 | no |
| `data/929/dates-generator/poetry.lock` (deleted module) | 4.7 MB | 35 | no |
| `pr-2820/בראשית.pdf` (stray artifact, side branch) | 1.6 MB | 1 | no |
| `monocart-report/` + `web/bible-on-site/monocart-report/` | 0.7 MB | 2 | no |
| `2098-*.png` (stray root screenshots, side branch) | 0.4 MB | 3 | no |

Regrowth rate: pack grew 395 → 591 MiB in ~6 weeks (**~40 MiB/week**), driven by
recurring regenerated-dump commits (e.g. the `data(recitation): publish N chapters`
and Sefaria-dump refresh commits). Option A resets the accumulated history; it
does not stop regrowth — see "After execution" below.

## Rehearsal results (measured, local scratch mirror)

Rehearsed with `git filter-repo` on a fresh clone of today's `origin`:

| Variant | Pack after strip | Pack after restoring current files |
|---|---|---|
| **Core set** (the 6 approved dump paths) | 92.45 MiB | **192.96 MiB (−67%)** |
| **Core + dead-artifact extension** | 79.31 MiB | **179.66 MiB (−70%)** |

Verified in rehearsal:

- `git fsck --connectivity-only` clean.
- No stripped path remains in any rewritten commit
  (`git rev-list --objects --all` shows zero matches; `.github/actionlint.yaml`
  is a config file and is correctly untouched).
- All 5 restored files are **bit-identical** to their pre-rewrite HEAD blobs
  (blob SHAs compared, `sha-manifest.txt` match — see Appendix).
- Simulated clone of the rewritten repo: 194 MiB `.git` (core set).
- File histories of untouched paths are intact (e.g. `package.json` log).

## Strip list

Core set (approved under Option A — "the dumps" from the issue table):

```text
web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json
glob:app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/*.perushim_notes.sqlite.gz
glob:app/BibleOnSite/Resources/Raw/sefaria-dump-*.tanah_view.sqlite
data/recitation/recitation.sqlite
web/bulletin/data/tanach-text.json
actionlint
```

Recommended extension — dead artifacts only (nothing in HEAD; −13 MiB more):

```text
data/929/dates-generator
data/recitation/corrections
pr-2820
web/api/.playwright-report
monocart-report
web/bible-on-site/monocart-report
glob:2098-*.png
data/recitation/benchmarks/golden-2026-10-07.json
```

The `glob:`/`regex:` prefixes are `git filter-repo --paths-from-file` syntax.
The `perushim_notes`/`sefaria-dump-*` globs keep the list valid if the dated
filename changes before execution.

## Impact and coordination requirements

- **Every commit SHA changes.** All 136 branches and 808 tags are rewritten.
  Every local clone, worktree (130+ exist on the maintainer machine alone), and
  fork must be re-cloned or hard-reset afterwards. A freeze window (~1 hour,
  no merges/pushes) is required.
- **Open PRs (44):** if all branch refs are rewritten and force-pushed in one
  pass, PR diffs stay intact because ancestry is preserved on both sides.
  Caveats: inline review comments anchored to old SHAs may become orphaned,
  and old-SHA permalinks in comments stop resolving. Branches still need
  `master` merged in before their CI builds pass again — until then a branch
  checkout lacks the restored dump files (they exist only at/after master's
  restore commit).
- **CI:** no workflow changes needed — that is the point of Option A. All 61
  `actions/checkout` usages keep working; the dump files are normal blobs at
  HEAD. CI builds on PR branches whose checkouts lack the dumps will fail until
  they merge rewritten `master` — expected during the transition.
- **`refs/pull/*`:** GitHub-internal pull refs (~1,885 of them) cannot be
  force-pushed and keep pointing at old commits. They do not affect clone size
  (clones only fetch heads + tags) but they keep the old objects alive in
  GitHub's on-disk pack until GitHub housekeeping runs — the *reported* repo
  size may lag the real clone savings. Optionally open a GitHub support ticket
  for an aggressive gc after the push.
- **Old dump versions are gone from history.** Anything needing a historical
  dump uses the backup bundle (below), not `git show`.

## Execution procedure (rehearsed)

Prerequisites: `git filter-repo` ≥ 2.45, `git lfs` not required, freeze window
announced, all CI quiet.

```bash
WORK=/path/to/scratch && cd "$WORK"
SOURCE_URL=https://github.com/bible-on-site/bible-on-site.git

# ── 0. Write the strip list the filter actually reads ──────────────────────
# Core set, plus the extension entries only if that scope was approved:
cat > "$WORK/strip-paths.txt" <<'EOF'
web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json
glob:app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/*.perushim_notes.sqlite.gz
glob:app/BibleOnSite/Resources/Raw/sefaria-dump-*.tanah_view.sqlite
data/recitation/recitation.sqlite
web/bulletin/data/tanach-text.json
actionlint
EOF
test -s "$WORK/strip-paths.txt" && cat "$WORK/strip-paths.txt"
# The file must exist and list exactly the approved scope before continuing.

# ── 1. Preservation ────────────────────────────────────────────────────────
git clone --mirror "$SOURCE_URL" backup.git
git -C backup.git bundle create bos-backup-pre-rewrite-$(date +%F).bundle --all
git -C backup.git for-each-ref \
  --format='%(objectname) %(refname)' > ref-manifest-pre-rewrite.txt
# Refresh the preservation inventory against the master being rewritten — the
# dated dump filenames drift between planning and execution, so re-list rather
# than trusting the names recorded here:
git -C backup.git ls-tree -r --name-only refs/heads/master | grep -E \
  'tanah_view\.json|perushim_notes.*sqlite\.gz|tanah_view\.sqlite|recitation\.sqlite|tanach-text\.json'
# Save the current contents of the files that must survive at HEAD (use the
# inventory above; the loop below shows today's names):
mkdir -p keep
for f in \
  web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json \
  app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/sefaria-dump-5784-sivan-4.perushim_notes.sqlite.gz \
  app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite \
  data/recitation/recitation.sqlite \
  web/bulletin/data/tanach-text.json ; do
  mkdir -p "keep/$(dirname "$f")"
  git -C backup.git show "refs/heads/master:$f" > "keep/$f"
  git -C backup.git rev-parse "refs/heads/master:$f" >> keep/sha-manifest.txt
done
# Optionally also push backup.git to a private archive repo for off-machine
# preservation (owner decision — needs a repo to push to).

# ── 2. Rewrite ─────────────────────────────────────────────────────────────
git clone --mirror "$SOURCE_URL" rewrite.git
cd rewrite.git
# Drop GitHub-internal pull refs — they cannot be pushed and are auto-managed.
git for-each-ref --format='%(refname)' refs/pull/ | while read -r r; do
  git update-ref -d "$r"
done
git filter-repo --invert-paths --paths-from-file ../strip-paths.txt
# filter-repo removes the 'origin' remote; restore it now so the publish step
# later can reach GitHub:
git remote add origin "$SOURCE_URL"
# Prove the strip worked before anything is restored — every rewritten ref
# must be free of the removed paths (this check is meaningless once the dumps
# are re-committed in step 3):
git rev-list --objects --all | grep -E \
  'tanah_view\.json|sqlite\.gz|tanah_view\.sqlite|recitation\.sqlite|tanach-text\.json' \
  | grep -v 'actionlint.yaml'    # expect no output

# ── 3. Restore current files on master ─────────────────────────────────────
cd "$WORK" && git clone rewrite.git restore-wt && cd restore-wt
git checkout master
cp -r ../keep/app ../keep/data ../keep/web .
git add -A
git commit -m "chore: restore current generated data files after history cleanup"
git push ../rewrite.git master:master   # or push via file:// path

# ── 4. Verify (all must pass before the force-push) ────────────────────────
cd "$WORK/rewrite.git"
git count-objects -vH            # expect size-pack ≈ 180–195 MiB
git fsck --connectivity-only
# The strip check already ran in step 2, before restoration; do not repeat it
# here — the five restored dumps legitimately appear in history now.
# Confirm restored blobs are identical to the saved manifest:
git rev-parse refs/heads/master:web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json
#   …repeat per file; must match keep/sha-manifest.txt

# ── 5. Publish ─────────────────────────────────────────────────────────────
git push --force origin 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

Post-push checklist:

1. Fresh clone → confirm ~190 MiB download and the 5 files present at HEAD.
2. Re-run the master CI workflow once; confirm dump-consuming jobs pass.
3. Announce: everyone re-clones (or `git fetch` + `git reset --hard origin/master`
   and rebuild worktrees); open PRs merge/rebase onto new master.
4. Optionally request GitHub support housekeeping so the on-disk pack reflects
   the drop (pull refs keep old objects until gc).

## Rollback

- Before the force-push: nothing published; delete the scratch dir.
- After the force-push: `backup.git` + `bos-backup-pre-rewrite-*.bundle` hold
  every old ref. Restore by pushing the backup's refs back
  (`git push --force origin 'refs/heads/*' 'refs/tags/*'` from `backup.git`),
  then re-apply any commits made since. Old SHAs are recorded in
  `ref-manifest-pre-rewrite.txt`.

## Choices needing owner review before execution

1. **Execution window** — pick the freeze window; ~1 hour including verification.
2. **Strip list** — core set vs. core + dead-artifact extension (−13 MiB extra;
   removes only paths absent from HEAD: stray mp3/pdf/png artifacts, the dead
   `data/929/dates-generator` module, report output). Recommended: extended.
3. **Backup location** — local bundle only, or also a private
   `bible-on-site-archive` repo for the pre-rewrite mirror.
4. **Optional pre-step** — prune stale remote branches (many of the 136 are
   merged/abandoned) so the rewrite has fewer refs to carry; separate cleanup,
   independent of this plan.

## After execution

The dump-commit cadence that produced the bloat continues — at ~40 MiB/week the
pack re-bloats toward today's size within months. Options to revisit later (out
of scope here): reduce dump-commit frequency, or adopt Option B (host dumps
externally and fetch them in dev setup / CI / packaging). The `check-added-large-files`
pre-commit hook already blocks new large files outside the excluded generated paths.

## Appendix — rehearsal preservation evidence

Blob SHAs recorded by `keep/sha-manifest.txt` in the rehearsal (pre-rewrite
HEAD at rehearsal time). The same SHAs are re-derivable from `master` as long
as the dumps have not been regenerated since:

| Path | Blob SHA |
|---|---|
| `web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json` | `0c3aea8cfcf5b22a7c15a12eb1af4d828cf58768` |
| `app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/sefaria-dump-5784-sivan-4.perushim_notes.sqlite.gz` | `4a497d46b411a97ae0f218f2c946affb055d1d77` |
| `app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite` | `01bad7304fe3f00158e929ee1507daec936279c8` |
| `data/recitation/recitation.sqlite` | `730e7c68b0e593cf298c3dbc220234684d2dbba7` |
| `web/bulletin/data/tanach-text.json` | `dd2541935a78b71a3f63e60981477c79da409650` |

A later execution regenerates the manifest in step 1 and compares these values
against it; a mismatch means the dump was republished since the rehearsal and
the preservation loop needs the refreshed names from the `ls-tree` inventory.
