import "@tanstack/react-start/server-only";
import { verifiedRdsTls } from "../../../shared/mysql/rds-ca";
import { productionRuntime } from "./environment.server";

/** Trust RDS certificates and verify the database host; plaintext is local-only. */
export function databaseTls(url: URL) {
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		!productionRuntime() &&
		local &&
		url.searchParams.get("ssl-mode") !== "REQUIRED"
	)
		return undefined;
	return verifiedRdsTls;
}

/** ssl-mode is our configuration flag, not a mysql2 connection option. */
export function databaseConnectionOptions(url: URL) {
	const ssl = databaseTls(url);
	const connectionUrl = new URL(url.href);
	connectionUrl.searchParams.delete("ssl-mode");
	return { uri: connectionUrl.href, ssl };
}
