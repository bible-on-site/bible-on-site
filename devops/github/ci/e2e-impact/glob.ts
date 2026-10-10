/**
 * Minimal gitignore-style glob matcher used by the E2E impact rules.
 *
 * Supported syntax (no character classes, no braces — keep rules simple):
 * - single star: any run of characters except a path separator
 * - double star: any run of characters including separators, and a
 *   double star followed by a slash also matches zero directories
 * - question mark: a single character except a path separator
 *
 * Patterns match whole repo-relative POSIX paths. A pattern ending in a
 * double star covers an entire directory tree.
 */
export function globToRegExp(glob: string): RegExp {
	if (glob.length === 0) throw new Error("Empty glob pattern");
	let source = "";
	let i = 0;
	while (i < glob.length) {
		const char = glob[i];
		if (char === "*") {
			if (glob[i + 1] === "*") {
				if (glob[i + 2] === "/") {
					source += "(?:.*/)?";
					i += 3;
				} else if (i + 2 === glob.length && source.endsWith("/")) {
					// Trailing `dir/<double-star>` also matches `dir` itself.
					source = `${source.slice(0, -1)}(?:/.*)?`;
					i += 2;
				} else {
					source += ".*";
					i += 2;
				}
			} else {
				source += "[^/]*";
				i += 1;
			}
		} else if (char === "?") {
			source += "[^/]";
			i += 1;
		} else {
			source += escapeRegExpChar(char);
			i += 1;
		}
	}
	return new RegExp(`^${source}$`);
}

function escapeRegExpChar(char: string): string {
	return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function matchesGlob(path: string, glob: string): boolean {
	return globToRegExp(glob).test(path);
}

/** Compiles a list of glob patterns once and tests paths against all of them. */
export function globMatcher(globs: readonly string[]): (path: string) => boolean {
	const regexes = globs.map(globToRegExp);
	return (path) => regexes.some((regex) => regex.test(path));
}
