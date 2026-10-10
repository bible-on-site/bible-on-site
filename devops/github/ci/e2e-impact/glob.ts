/**
 * Minimal gitignore-style glob matcher used by the E2E impact rules.
 *
 * Supported syntax (no character classes, no braces — keep rules simple):
 * - `*` inside a segment: any run of characters except a path separator
 * - `**` as a complete segment: zero or more whole path segments (elsewhere
 *   it behaves like `*`)
 * - `?` inside a segment: a single character except a path separator
 *
 * Patterns match whole repo-relative POSIX paths; a trailing `**` segment
 * covers an entire directory tree, including the directory itself.
 *
 * Matching is implemented directly — no RegExp construction — so rule
 * patterns and candidate paths carry no regular-expression surface at all.
 */

/** Star-backtracking match of one path segment against one glob segment. */
function matchSegment(pattern: string, value: string): boolean {
	let p = 0;
	let v = 0;
	let star = -1;
	let retry = -1;
	while (v < value.length) {
		if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) {
			p += 1;
			v += 1;
		} else if (p < pattern.length && pattern[p] === "*") {
			star = p;
			p += 1;
			retry = v;
		} else if (star !== -1) {
			p = star + 1;
			retry += 1;
			v = retry;
		} else {
			return false;
		}
	}
	while (p < pattern.length && pattern[p] === "*") p += 1;
	return p === pattern.length;
}

/** Matches a repo-relative POSIX path against a glob pattern. */
export function matchesGlob(path: string, glob: string): boolean {
	if (glob.length === 0) throw new Error("Empty glob pattern");
	const patternSegments = glob.split("/");
	const pathSegments = path.split("/");
	// `**` can consume any number of segments, so match backtracks over the
	// segment lists; memoized positions keep it linear in practice.
	const memo = new Map<string, boolean>();
	const walk = (patternIndex: number, pathIndex: number): boolean => {
		const key = `${patternIndex}:${pathIndex}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let result: boolean;
		if (patternIndex === patternSegments.length) {
			result = pathIndex === pathSegments.length;
		} else if (patternSegments[patternIndex] === "**") {
			result =
				walk(patternIndex + 1, pathIndex) ||
				(pathIndex < pathSegments.length && walk(patternIndex, pathIndex + 1));
		} else {
			result =
				pathIndex < pathSegments.length &&
				matchSegment(patternSegments[patternIndex], pathSegments[pathIndex]) &&
				walk(patternIndex + 1, pathIndex + 1);
		}
		memo.set(key, result);
		return result;
	};
	return walk(0, 0);
}

/** Compiles a list of glob patterns once and tests paths against all of them. */
export function globMatcher(globs: readonly string[]): (path: string) => boolean {
	for (const glob of globs) {
		if (glob.length === 0) throw new Error("Empty glob pattern");
	}
	return (path) => globs.some((glob) => matchesGlob(path, glob));
}
