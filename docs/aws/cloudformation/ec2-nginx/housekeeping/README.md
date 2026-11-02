# Proxy disk housekeeping

These two native Ubuntu configuration snippets are installed on the existing
nginx router. They do not provision infrastructure. The November 1, 2026 cleanup
was explicitly authorized by Dorad: inspect disk consumers, discard only safe
items, arrange safe periodic cleanup, and extend storage only if needed.

## Completed maintenance: November 1, 2026

The router's 6.8 GiB root filesystem was 98% full, with approximately 157 MiB
available at the start of cleanup. The principal removable consumers were:

| Consumer | Before | Action |
| --- | --- | --- |
| Old VS Code server binaries | Five versions, about 1.1 GiB | Removed three unused November 2025 versions; kept both January 2026 versions |
| Old Cursor server binaries | Two versions, about 685 MiB | Removed the older February 2026 version; kept the newer version |
| APT cache | About 329 MiB, including 217 MiB of package archives | Ran `apt-get clean`; installed packages and package lists were preserved |
| System journals | 533.7 MiB | Installed bounded retention; journald reduced usage to 211.2 MiB |
| Nginx logs | About 233 MiB | Preserved, including existing daily rotation and 14 rotated files |

Immediately after maintenance, approximately **1.76 GiB was available and disk
usage was 74%**, a recovery of **1.60 GiB**. No volume expansion or added recurring
AWS charge was necessary. This fixes disk headroom; it does not establish that
disk usage caused the separately investigated website CPU/latency stalls.

Before deletion, instance identity was verified through IMDSv2 against the
expected account, instance, and Israel region. A root-run check verified the
exact allowlisted directory paths, owners, absence of symlinks at those paths,
age over 90 days, and preservation of the newest versions. It rechecked process
arguments and open executable, working-directory, and file references before
each deletion. No editor process was running. Symlink-safe recursive deletion
was restricted to these four version directories:

```text
/home/ubuntu/.vscode-server/cli/servers/Stable-cb1933bbc38d329b3595673a600fab5c7368f0a7
/home/ubuntu/.vscode-server/cli/servers/Stable-1e3c50d64110be466c0b4a45222e81d2c9352888
/home/ubuntu/.vscode-server/cli/servers/Stable-bf9252a2fb45be6893dd8870c0bf37e2e1766d61
/home/ubuntu/.cursor-server/bin/linux-x64/511523af765daeb1fa69500ab0df5b6524424610
```

The editor deletion recovered 1,039,699,968 allocated bytes. Settings, extensions,
projects, credentials, current binaries, installed OS packages, snap revisions,
certificate files, and application content were preserved. An older editor
client may download its matching server binary again on its next connection.
Editor binaries are **not** pruned periodically: future sessions and version
requirements need a fresh check before removing an installed version.

## Automatic cleanup

Install [90-bible-on-site-housekeeping](90-bible-on-site-housekeeping) at
`/etc/apt/apt.conf.d/90-bible-on-site-housekeeping`, root-owned with mode `0644`.
The existing enabled `apt-daily-upgrade.timer` invokes Ubuntu's
`/usr/lib/apt/apt.systemd.daily install`. Its native
`APT::Periodic::CleanInterval "7"` runs `apt-get clean` when seven days have
elapsed since the successful clean stamp. The first eligible daily timer run
performs cleanup; this is not a fixed weekday. The initial successful manual
clean was recorded in `/var/lib/apt/periodic/clean-stamp`.

The 30-day age and 100 MiB size targets additionally constrain downloaded
archives through APT's normal periodic size checks, with a two-day minimum age
for those checks. The minimum age can leave the size target temporarily exceeded;
the weekly full clean removes all downloaded archives. This can require a later
package download, but never removes an installed package. Existing update and
unattended-upgrade settings were not changed. No extra cron job, custom service,
Codex automation, AWS credentials, or running desktop is required.

Install [60-bible-on-site-housekeeping.conf](60-bible-on-site-housekeeping.conf)
at `/etc/systemd/journald.conf.d/60-bible-on-site-housekeeping.conf`, root-owned
with mode `0644`. Journald itself enforces:

- A 256 MiB persistent-journal target and a 1 GiB free-space reserve.
- A 90-day retention age and seven-day maximum journal-file age.
- Removal of archived journal files, preserving active files. Age is evaluated
  by journal file; a retained file can contain older individual entries. Size
  limits and rotation granularity can shorten retention or cause temporary
  overshoot. The free-space reserve does not prevent other programs filling disk.

Only `systemd-journald` was restarted, using a single `systemctl restart` so
existing service logging streams survive. Retention was also applied with
`journalctl --rotate --vacuum-time=90days --vacuum-size=256M`; the restart had
already reclaimed the expired archives, so the explicit vacuum freed no further
space. Nginx was neither restarted nor reloaded. These policies manage host logs
and caches independently of AWS CloudWatch retention.

Sources: [APT clean semantics](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html),
[systemd 255 journal retention](https://www.freedesktop.org/software/systemd/man/255/journald.conf.html),
and [safe journald restarts](https://www.freedesktop.org/software/systemd/man/255/systemd-journald.service.html).
The native APT interval and cache-limit support was also checked in the installed
`apt.systemd.daily` script before activation.

## Verification and rollback

The configuration bytes and SHA-256 digests were compared with the installed
files. `apt-config dump` confirmed the effective periodic values. Journald
reported a 256 MiB limit with no configuration errors. Existing APT, logrotate,
and certificate-renewal timers remained active. The complete installed
`nginx.conf` and `router.conf` hashes, Nginx PID and activation timestamp remained
unchanged.

Before and after maintenance, ten public requests covered the homepage, liveness,
readiness, and complete recitation JSON through both website domains, plus API
health through both API domains. All returned HTTP 200; response bodies were
fully read, JSON parsed, and compared with their before-maintenance hashes.
Both homepages retained their Next.js cache hits.

To disable the new policies, remove only the two installed housekeeping snippets
and restart `systemd-journald` once. The original main configuration and all
package-provided APT configuration were left intact. The cleanup stamp is
harmless if left in place. Removed package downloads can be fetched again, and
removed editor versions can be reinstalled by their matching clients. Expired
journal archives cannot be recovered by reverting configuration. Retained
journals and every Nginx access, error, and release-probe log remain available.

If space pressure returns, inspect `df -h /`, `df -i /`, the APT cache, journal
usage, inactive editor versions, and deleted-but-open files before deleting
anything else. Preserve active sessions and diagnostic retention. If safe cleanup
cannot maintain sufficient headroom, extend the root volume and filesystem after
fresh target, filesystem, backup, capacity, and cost checks. Never truncate live
Nginx logs, remove certificates, purge installed packages, or delete snap rollback
revisions merely to reach a free-space target.

This operational work was authorized and applied independently of merging its
documentation. The resulting AWS-related pull request still requires Dorad's
explicit approval of that specific pull request before merge under `AGENTS.md`.
