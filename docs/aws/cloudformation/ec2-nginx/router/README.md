# Router configuration validation

Validate the complete installed Nginx configuration with `sudo nginx -t` before
gracefully reloading it. Preserve the live worker user, includes, and temporary
paths. A root-run configuration test can change temporary-directory ownership;
it is not a read-only parser check. Nginx's
[initialization](https://github.com/nginx/nginx/blob/master/src/core/ngx_cycle.c)
calls [directory creation and ownership repair](https://github.com/nginx/nginx/blob/master/src/core/ngx_file.c)
using the tested configuration's worker user, including during a syntax test.

For an isolated candidate test, use a dedicated temporary directory for **every**
temporary path, log, and PID file. Specify the worker user explicitly. Do not
point a minimal standalone configuration at production temporary directories;
omitting the live `user www-data;` directive selects a different default user.

Before activation, compare the installed configuration with the expected
baseline and the candidate with the merged repository file. Stop if either
changed. Keep a backup outside the `*.conf` include pattern, replace the candidate
atomically, and run `sudo nginx -t` against the complete installed configuration.
If validation or graceful reload fails, restore the backup, validate the restored
configuration, and reload it. Transfer scripts as files so their line endings
remain intact.

After activation, verify worker access to the configured temporary directories,
health and warmed readiness, and complete recitation JSON through both the
upstream and public router. Compare full response bytes and parse the JSON;
HTTP 200 alone does not prove a response completed. Inspect the error log and
`release-probes.log`. Keep routing, timeouts, and capacity unchanged when adding
diagnostics.

On 2026-10-06, a standalone candidate check omitted the live worker user. Later
public responses failed with proxy-file permission errors while the upstream
still returned all 411,873 bytes. One public HTTP 200 response ended at 97,791
bytes. The full installed configuration check restored `www-data` ownership,
and the public response again completed and parsed correctly. An isolated
reproduction confirmed that the standalone check changed its own proxy
directory from `www-data` to `nobody` while leaving production paths untouched.
This permission failure is separate from the earlier rollout stalls tracked in
[#2016](https://github.com/bible-on-site/bible-on-site/issues/2016).
