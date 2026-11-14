/**
 * Post-processes monocart's `.coverage/e2e/lcov.info` into the repo-relative,
 * merge-ready layout.
 *
 * Two normalizations:
 * - SF paths are rewritten to `web/admin/src/...` so Codecov's `admin` flag
 *   path filter matches them (the merge tool prefixes unit's bare `src/`
 *   paths the same way).
 * - TanStack Start's server-function split emits a virtual
 *   `X.tstss-serverfn-split` chunk holding the server half of `X.ts`/`X.tsx`,
 *   source-mapped back to the original file's line numbers. The virtual path
 *   is not a repository file, so its records are folded onto the sibling
 *   source record: the merge then reads them as additional E2E hits on the
 *   real file instead of a second file entry double-counting the same lines.
 */
export function normalizeE2eLcov(content: string): string {
	const lines = content.split(/\r?\n/);
	const paths = new Set<string>();
	for (const raw of lines) {
		if (raw.startsWith("SF:")) paths.add(normalizeSfPath(raw.slice(3)));
	}
	return lines
		.map((raw) =>
			raw.startsWith("SF:")
				? `SF:${foldSplitPath(normalizeSfPath(raw.slice(3)), paths)}`
				: raw,
		)
		.join("\n");
}

function normalizeSfPath(path: string): string {
	let p = path.replace(/\\/g, "/");
	const srcIdx = p.indexOf("web/admin/src/");
	if (srcIdx !== -1) {
		p = p.slice(srcIdx);
	} else if (p.startsWith("src/")) {
		p = `web/admin/${p}`;
	}
	return p;
}

const SPLIT_SUFFIX = ".tstss-serverfn-split";

function foldSplitPath(path: string, siblings: ReadonlySet<string>): string {
	if (!path.endsWith(SPLIT_SUFFIX)) return path;
	const stem = path.slice(0, -SPLIT_SUFFIX.length);
	for (const ext of [".ts", ".tsx"]) {
		const parent = `${stem}${ext}`;
		if (siblings.has(parent)) return parent;
	}
	// No sibling source record: keep the virtual name. The merge's hits-only
	// contract drops unprovable foreign coordinates and logs the dropped
	// file, so an unexpected shape stays visible instead of silent.
	return path;
}
