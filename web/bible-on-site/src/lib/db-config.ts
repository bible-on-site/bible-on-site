import { verifiedRdsTls } from "../../../shared/mysql/rds-ca.ts";

export function databaseTls(host: string, mode?: string | null) {
	if (
		host.toLowerCase().endsWith(".rds.amazonaws.com") ||
		mode === "REQUIRED" ||
		mode === "VERIFY_CA" ||
		mode === "VERIFY_IDENTITY"
	) {
		return verifiedRdsTls;
	}
	return undefined;
}

function decodeDbComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		// Preserve literal percent signs in legacy connection strings.
		console.warn(
			"Malformed database URL component; preserving its original value",
		);
		return value;
	}
}

export function parseDbUrl(url: string) {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number.parseInt(parsed.port || "3306", 10),
		user: decodeDbComponent(parsed.username),
		password: decodeDbComponent(parsed.password),
		database: decodeDbComponent(parsed.pathname.slice(1)),
		ssl: databaseTls(parsed.hostname, parsed.searchParams.get("ssl-mode")),
	};
}
