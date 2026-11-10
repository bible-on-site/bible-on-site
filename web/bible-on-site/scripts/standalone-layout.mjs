import { cpSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/** Keep the established standalone runtime layout when tracing includes ../shared. */
export function flattenStandaloneApp(standalone) {
	const nested = path.join(standalone, "bible-on-site");
	if (!existsSync(path.join(nested, "server.js"))) return;
	// Next emits app-local dependencies and assets under this directory when
	// the tracing root is web/. Merge them alongside any root-level dependencies.
	for (const entry of readdirSync(nested)) {
		const source = path.join(nested, entry);
		const destination = path.join(standalone, entry);
		if (existsSync(destination)) cpSync(source, destination, { recursive: true });
		else renameSync(source, destination);
	}
	rmSync(nested, { recursive: true });
}
