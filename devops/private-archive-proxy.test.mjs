import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Official nginx image pinned to the version used for this proxy regression.
const image =
	"nginx@sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703";
const docker = (...args) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

test("real nginx preserves the archive canonical URL and route boundaries", {
	timeout: 60_000,
}, async (t) => {
	const source = readFileSync(
		new URL(
			"../docs/aws/cloudformation/ec2-nginx/router/router.conf",
			import.meta.url,
		),
		"utf8",
	);
	const host = source.indexOf("server_name admin.xn--febl3a.co.il;");
	assert.ok(host >= 0, "Canonical Admin virtual host must exist");
	const start = source.lastIndexOf("server {", host);
	const end = source.indexOf("\nserver {", host);
	assert.ok(
		start >= 0 && end > start,
		"Canonical Admin server block must be bounded",
	);
	// Keep the real proxy locations. Substitute loopback transport and omit TLS
	// certificate files; the backend reproduces the app's slashless canonical URL.
	const proxy = source
		.slice(start, end)
		.replace("listen 443 ssl;", "listen 8080; absolute_redirect off;")
		.replace(/^\s*ssl_[^\n]*\n/gm, "")
		.replace("server_name admin.xn--febl3a.co.il;", "server_name localhost;")
		.replace(/"admin\.bible-on-site\.local"/g, '"127.0.0.1"')
		.replace(
			"proxy_request_buffering off;",
			"proxy_request_buffering off; add_header X-Test-Archive-Location archive always;",
		);
	const directory = mkdtempSync(join(tmpdir(), "private-archive-nginx-"));
	const config = join(directory, "nginx.conf");
	const name = `codex-archive-proxy-${randomUUID()}`;
	let started = false;
	try {
		writeFileSync(
			config,
			`worker_processes 1;\nevents { worker_connections 64; }\nhttp {
 access_log off;
 ${proxy}
 server {
  listen 3101;
  absolute_redirect off;
  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
  add_header Cache-Control "private, no-store" always;
  add_header X-Observed-Proto $http_x_forwarded_proto always;
  location = /archive/ { return 307 /archive$is_args$args; }
  location = /archive/api { return 401; }
  location / { return 200 "$request_uri"; }
 }
}\n`,
		);
		docker(
			"run",
			"--rm",
			"--detach",
			"--name",
			name,
			"--publish",
			"127.0.0.1::8080",
			"--volume",
			`${config}:/etc/nginx/nginx.conf:ro`,
			"--entrypoint",
			"nginx",
			image,
			"-g",
			"daemon off;",
		);
		started = true;
		docker("exec", name, "nginx", "-t");
		const port = docker("port", name, "8080/tcp").match(
			/^127\.0\.0\.1:(\d+)$/,
		)?.[1];
		assert.ok(port, "Only the owned loopback port may be used");
		const origin = `http://127.0.0.1:${port}`;
		const request = (path) =>
			fetch(origin + path, {
				redirect: "manual",
				headers: { Host: "admin.xn--febl3a.co.il" },
				signal: AbortSignal.timeout(5_000),
			});
		let ready = false;
		for (let attempt = 0; attempt < 50; attempt++) {
			try {
				const response = await request("/proxy-health");
				await response.body?.cancel();
				ready = response.status === 200;
			} catch {
				/* Container startup has not bound its listener yet. */
			}
			if (ready) break;
			await delay(100);
		}
		assert.ok(
			ready,
			"Owned nginx listener must become ready within five seconds",
		);
		async function follow(path) {
			for (let hop = 0; hop < 4; hop++) {
				const response = await request(path);
				if (![301, 302, 303, 307, 308].includes(response.status))
					return response;
				const next = new URL(response.headers.get("location"), origin);
				await response.body?.cancel();
				assert.equal(
					next.origin,
					origin,
					"Proxy check must stay on the owned local listener",
				);
				path = next.pathname + next.search;
			}
			throw new Error("Archive canonicalization exceeded four redirects");
		}
		for (const path of ["/archive", "/archive/", "/archive?probe=1"]) {
			await t.test(`resolves canonical entry ${path}`, async () => {
				const response = await follow(path);
				assert.equal(response.status, 200);
				assert.equal(
					await response.text(),
					path === "/archive/" ? "/archive" : path,
				);
				assert.equal(
					response.headers.get("x-test-archive-location"),
					"archive",
				);
				assert.equal(response.headers.get("x-observed-proto"), "https");
			});
		}
		await t.test(
			"forwards the backend's API denial and privacy headers",
			async () => {
				const response = await request("/archive/api");
				assert.equal(response.status, 401);
				assert.equal(
					response.headers.get("x-test-archive-location"),
					"archive",
				);
				assert.match(response.headers.get("cache-control"), /no-store/);
				assert.match(response.headers.get("x-robots-tag"), /noindex/);
				await response.body?.cancel();
			},
		);
		for (const path of ["/archive-settings", "/archive-other", "/Archive"]) {
			await t.test(
				`existing Admin route stays outside archive streaming: ${path}`,
				async () => {
					const response = await request(path);
					assert.equal(response.status, 200);
					assert.equal(response.headers.get("x-test-archive-location"), null);
					assert.equal(await response.text(), path);
				},
			);
		}
	} finally {
		if (started) docker("rm", "--force", name);
		// Only these exact task-created paths are removed; no recursive deletion.
		unlinkSync(config);
		rmdirSync(directory);
	}
});
