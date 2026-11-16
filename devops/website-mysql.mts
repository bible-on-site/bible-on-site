import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The annotation CLIs use the website's pinned driver, regardless of caller cwd.
const requireFromWebsite = createRequire(
	new URL("../web/bible-on-site/package.json", import.meta.url),
);

export function websiteMysql(): typeof import("mysql2/promise") {
	return requireFromWebsite("mysql2/promise");
}

export function parseFlags(argv: string[]) {
	const flags = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const raw = argv[i];
		if (!raw.startsWith("--")) throw new Error(`unexpected argument "${raw}"`);
		const [name, inline] = raw.slice(2).split("=", 2);
		flags.set(name, inline ?? argv[++i] ?? "true");
	}
	return flags;
}

export function loadDbUrl(envFile: string): string {
	if (process.env.DB_URL) return process.env.DB_URL;
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
			if (!m || process.env[m[1]] !== undefined) continue;
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
		}
	}
	if (!process.env.DB_URL)
		throw new Error("DB_URL not set and no env file provided");
	return process.env.DB_URL;
}

export function parseDbUrl(url: string) {
	const u = new URL(url.replace(/^mysql:\/\//, "http://"));
	return {
		host: u.hostname || "localhost",
		port: Number.parseInt(u.port || "3306", 10),
		user: u.username || "root",
		password: u.password || "",
		database: u.pathname?.slice(1)?.split("?")[0] || "tanah-dev",
	};
}
