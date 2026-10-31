import { createRequire } from "node:module";

// The annotation CLIs use the website's pinned driver, regardless of caller cwd.
const requireFromWebsite = createRequire(
	new URL("../web/bible-on-site/package.json", import.meta.url),
);

export function websiteMysql(): typeof import("mysql2/promise") {
	return requireFromWebsite("mysql2/promise");
}
