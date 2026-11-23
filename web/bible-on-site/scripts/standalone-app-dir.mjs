import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The traced standalone app directory for the website package.
 *
 * `turbopack.root` widened to `web/` so `src` can import the shared
 * contract modules (#3710); output tracing follows that root and nests
 * the app under `.next/standalone/<package-dir>/` instead of the
 * standalone root. `server.js` marks the app dir, so callers resolve it
 * rather than hardcoding the directory name.
 *
 * @param {string} packageRoot absolute path of the website package
 * @returns {string} the directory holding the traced `server.js`
 */
export function standaloneAppDir(packageRoot) {
	const standalone = path.join(packageRoot, ".next", "standalone");
	const candidates = [
		standalone,
		...(existsSync(standalone)
			? readdirSync(standalone, { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => path.join(standalone, entry.name))
			: []),
	];
	const appDir = candidates.find((dir) =>
		existsSync(path.join(dir, "server.js")),
	);
	if (!appDir) {
		throw new Error(`no traced app dir with server.js under ${standalone}`);
	}
	return appDir;
}
