/**
 * Deterministic discovery of Playwright tests from TypeScript sources (#2085).
 *
 * Like the xUnit discovery, the selector parses sources rather than running
 * `playwright --list` — identical inputs must produce identical manifests and
 * discovery must not depend on installed node_modules or a bootable server.
 *
 * Test identity is `<testDir-relative file> :: <describe/test titles>`,
 * exactly what the runtime evidence helpers
 * (`web/shared/tests-util/e2e-impact.mjs`) compute from `titlePath.slice(2)`
 * — the project (titlePath[1]) is not part of identity because a selection
 * can never run a test on one project but not another.
 *
 * A test file whose titles cannot all be resolved statically — a non-literal
 * title (variable, template literal, expression), a parse anomaly, or a file
 * matching the test glob that yields no declarations — is "dynamic": the
 * selector treats a change to it as shared harness and runs every applicable
 * test, and a future enforce-mode runner must run such files wholesale.
 * Over-discovery is harmless; under-discovery is not, so every doubt resolves
 * to dynamic and tests under an unresolvable describe are never fabricated
 * into phantom candidate ids.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { listFiles } from "./xunit-discovery.ts";
import type { DiscoveredTest } from "./model.ts";

interface Tok {
	kind: "ident" | "string" | "template" | "punct";
	value: string;
}

const isIdentStart = (c: string) =>
	(c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
const isIdentChar = (c: string) => isIdentStart(c) || (c >= "0" && c <= "9");
const isDigit = (c: string) => c >= "0" && c <= "9";

/** Tokens that may precede a `/regex/` literal rather than a division. */
const REGEX_PRECEDERS = new Set([
	"(", "[", "{", ",", ";", ":", "=", "!", "?", "+", "-", "*", "%", "^", "&",
	"|", "~", "=>", "...", "return", "typeof", "case", "throw", "in", "of",
	"new", "delete", "void", "do", "else", "yield", "await",
]);

/**
 * Tokenizes the subset of TS syntax discovery needs: identifiers, string
 * literals, template literals (opaque — interpolations stay inside), comments,
 * regex literals and punctuation. Returns `null` on unterminated literals or
 * comments — the caller treats the file as dynamic.
 */
function tokenize(source: string): Tok[] | null {
	const tokens: Tok[] = [];
	const n = source.length;
	let i = 0;

	const scanQuoted = (start: number, quote: string): number => {
		let j = start + 1;
		while (j < n) {
			if (source[j] === "\\") {
				j += 2;
				continue;
			}
			if (source[j] === quote) return j + 1;
			j++;
		}
		return -1;
	};

	/** Template literal: `${` nests expressions; nested templates/strings count. */
	const scanTemplate = (start: number): number => {
		let j = start + 1;
		let depth = 0;
		while (j < n) {
			const ch = source[j];
			if (ch === "\\") {
				j += 2;
				continue;
			}
			if (ch === "`") {
				if (depth === 0) return j + 1;
				const end = scanTemplate(j);
				if (end === -1) return -1;
				j = end;
				continue;
			}
			if (ch === "$" && source[j + 1] === "{") {
				depth++;
				j += 2;
				continue;
			}
			if (ch === "}" && depth > 0) {
				depth--;
				j++;
				continue;
			}
			if ((ch === '"' || ch === "'") && depth > 0) {
				const end = scanQuoted(j, ch);
				if (end !== -1) {
					j = end;
					continue;
				}
			}
			j++;
		}
		return -1;
	};

	/** Regex literal: skip to the unescaped `/` outside character classes. */
	const scanRegex = (start: number): number => {
		let j = start + 1;
		let inClass = false;
		while (j < n) {
			const ch = source[j];
			if (ch === "\\") {
				j += 2;
				continue;
			}
			if (ch === "[") inClass = true;
			else if (ch === "]") inClass = false;
			else if (ch === "/" && !inClass) {
				j++;
				while (j < n && isIdentChar(source[j])) j++;
				return j;
			} else if (ch === "\n") return -1;
			j++;
		}
		return -1;
	};

	while (i < n) {
		const ch = source[i];
		if (" \t\n\r\f\v".includes(ch)) {
			i++;
			continue;
		}
		if (ch === "/" && source[i + 1] === "/") {
			const end = source.indexOf("\n", i + 2);
			i = end === -1 ? n : end;
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			if (end === -1) return null;
			i = end + 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const end = scanQuoted(i, ch);
			if (end === -1) return null;
			tokens.push({ kind: "string", value: source.slice(i + 1, end - 1) });
			i = end;
			continue;
		}
		if (ch === "`") {
			const end = scanTemplate(i);
			if (end === -1) return null;
			tokens.push({ kind: "template", value: source.slice(i, end) });
			i = end;
			continue;
		}
		if (ch === "/") {
			const prev = tokens[tokens.length - 1];
			const regexContext =
				prev === undefined ||
				(prev.kind === "punct" && REGEX_PRECEDERS.has(prev.value)) ||
				(prev.kind === "ident" && REGEX_PRECEDERS.has(prev.value));
			if (regexContext) {
				const end = scanRegex(i);
				if (end !== -1) {
					tokens.push({ kind: "punct", value: "/regex/" });
					i = end;
					continue;
				}
			}
			tokens.push({ kind: "punct", value: "/" });
			i++;
			continue;
		}
		if (isIdentStart(ch)) {
			let j = i + 1;
			while (j < n && isIdentChar(source[j])) j++;
			tokens.push({ kind: "ident", value: source.slice(i, j) });
			i = j;
			continue;
		}
		if (isDigit(ch)) {
			let j = i + 1;
			while (j < n && (isIdentChar(source[j]) || source[j] === ".")) j++;
			tokens.push({ kind: "punct", value: source.slice(i, j) });
			i = j;
			continue;
		}
		const three = source.slice(i, i + 3);
		if (three === "..." || three === "===" || three === "!==") {
			tokens.push({ kind: "punct", value: three });
			i += 3;
			continue;
		}
		const two = source.slice(i, i + 2);
		if (two === "=>" || two === "&&" || two === "||" || two === "??" || two === "==" || two === "!=") {
			tokens.push({ kind: "punct", value: two });
			i += 2;
			continue;
		}
		tokens.push({ kind: "punct", value: ch });
		i++;
	}
	return tokens;
}

/** Members that turn `test.X(...)`/`test.X.Y(...)` into declarations. */
const TEST_MODIFIERS = new Set(["only", "skip", "fixme", "fail", "slow"]);
const DESCRIBE_MODIFIERS = new Set(["serial", "parallel", "only", "skip", "fixme"]);

export interface PlaywrightDiscovery {
	tests: DiscoveredTest[];
	/**
	 * Repo-relative test files whose declarations cannot all be resolved
	 * statically — a change to them selects every applicable test, and
	 * enforce-mode runners must execute them wholesale.
	 */
	dynamicFiles: string[];
}

interface Frame {
	title: string;
	/** Brace depth at which this describe's callback body opened. */
	depth: number;
	/** True when the describe title could not be resolved — children suppress. */
	dynamic: boolean;
}

/**
 * Parses one test source into declarations: `titles` holds the literal
 * describe/test title paths; `dynamic` reports any declaration that could
 * not be fully resolved (non-literal title, missing callback, tokenize
 * failure) or any test nested under an unresolvable describe.
 */
export function parsePlaywrightSource(source: string): {
	titles: string[][];
	dynamic: boolean;
} {
	const tokens = tokenize(source);
	if (tokens === null) return { titles: [], dynamic: true };
	const titles: string[][] = [];
	let dynamic = false;
	const describes: Frame[] = [];
	let depth = 0;

	/**
	 * Classifies `test`-chain calls at `index` (the `test` token).
	 * Returns the call's `(` index and kind, or null for non-declarations
	 * (hooks, `test.use`, `test.step`, member access like `foo.test(`).
	 */
	const declAt = (
		index: number,
	): { kind: "test" | "describe"; callOpen: number } | null => {
		const prev = tokens[index - 1];
		if (prev !== undefined && prev.kind === "punct" && prev.value === ".") return null;
		let j = index + 1;
		const chain: string[] = [];
		while (
			j + 1 < tokens.length &&
			tokens[j].kind === "punct" &&
			tokens[j].value === "." &&
			tokens[j + 1].kind === "ident"
		) {
			chain.push(tokens[j + 1].value);
			j += 2;
		}
		if (tokens[j]?.kind !== "punct" || tokens[j]?.value !== "(") return null;
		if (chain.length === 0) return { kind: "test", callOpen: j };
		if (
			chain[0] === "describe" &&
			chain.slice(1).every((member) => DESCRIBE_MODIFIERS.has(member))
		) {
			return { kind: "describe", callOpen: j };
		}
		if (chain.every((member) => TEST_MODIFIERS.has(member))) {
			return { kind: "test", callOpen: j };
		}
		return null;
	};

	/**
	 * Reads a declaration's first argument: a plain string literal is the
	 * title; anything else (template, expression, identifier) is dynamic.
	 * `next` is the index just past the first argument.
	 */
	const readTitle = (
		open: number,
	): { title: string | null; dynamic: boolean; next: number } => {
		const first = tokens[open + 1];
		if (first === undefined) return { title: null, dynamic: true, next: open + 1 };
		if (first.kind === "string") {
			const after = tokens[open + 2];
			// `"a" + x`/`"a",` distinction: the token after the literal must
			// close the argument (`)` for a title-only call is not a decl, but
			// `,` proves an argument boundary).
			if (after !== undefined && (after.value === "," || after.value === ")")) {
				return { title: first.value, dynamic: false, next: open + 2 };
			}
			return { title: null, dynamic: true, next: open + 2 };
		}
		return { title: null, dynamic: true, next: open + 1 };
	};

	/**
	 * Inside a call's parens (opening `(` index given, depth 1), finds the
	 * callback body `{` — the first `{` at depth 1 following `=>` or
	 * `function`. -1 when the call has no function-body callback (config or
	 * condition forms like `test.skip(cond, "why")`).
	 */
	const findBodyBrace = (callOpen: number): number => {
		let parens = 1;
		let sawFn = false;
		for (let j = callOpen + 1; j < tokens.length; j++) {
			const tok = tokens[j];
			if (tok.kind !== "punct") continue;
			if (tok.value === "(") parens++;
			else if (tok.value === ")") {
				parens--;
				if (parens === 0) return -1;
			} else if (parens === 1 && tok.value === "=>") sawFn = true;
			else if (parens === 1 && tok.value === "{") {
				if (sawFn) return j;
			}
		}
		return -1;
	};

	for (let index = 0; index < tokens.length; index++) {
		const tok = tokens[index];
		if (tok.kind === "punct" && tok.value === "{") {
			depth++;
			continue;
		}
		if (tok.kind === "punct" && tok.value === "}") {
			depth--;
			while (describes.length > 0 && describes[describes.length - 1].depth > depth) {
				describes.pop();
			}
			continue;
		}
		if (tok.kind !== "ident" || tok.value !== "test") continue;
		const decl = declAt(index);
		if (decl === null) continue;
		const title = readTitle(decl.callOpen);
		const bodyBrace = findBodyBrace(decl.callOpen);
		if (decl.kind === "describe") {
			// A describe without a function body is not a suite declaration.
			if (bodyBrace === -1) continue;
			if (title.dynamic || title.title === null) {
				dynamic = true;
				// Nest children under a synthetic frame at the right depth so
				// braces still balance — their tests record nothing (the file
				// is dynamic anyway and phantom ids must never be emitted).
				describes.push({ title: "", depth: depth + 1, dynamic: true });
				continue;
			}
			describes.push({ title: title.title, depth: depth + 1, dynamic: false });
		} else {
			if (title.dynamic || title.title === null) {
				// A non-literal first argument is a declaration only when a
				// callback follows (`test(name, fn)`); otherwise it is a
				// configuration call like `test.skip(cond, "why")`.
				if (bodyBrace !== -1) dynamic = true;
				continue;
			}
			if (describes.some((frame) => frame.dynamic)) {
				// Under a non-literal describe: unresolvable at runtime too.
				dynamic = true;
				continue;
			}
			// Literal title — a declaration. `test("title")` without a body
			// is a valid todo declaration and records the same identity.
			titles.push([...describes.map((frame) => frame.title), title.title]);
		}
	}
	return { titles, dynamic };
}

/** `<file> :: <describe> :: <title>` — mirrors impactTestId in e2e-impact.mjs. */
export function playwrightTestId(file: string, titlePath: string[]): string {
	return [file, ...titlePath].join(" :: ");
}

/**
 * Discovers suite tests statically: files under `testsRoot` matching `glob`,
 * ids derived from `testDir`-relative paths plus literal describe/test
 * titles. `testDir` defaults to `testsRoot`.
 */
export function discoverPlaywrightTests(
	repoRoot: string,
	testsRoot: string,
	testsGlob: string,
	testDir?: string,
): PlaywrightDiscovery {
	const root = join(repoRoot, testsRoot);
	const dir = join(repoRoot, testDir ?? testsRoot);
	const tests: DiscoveredTest[] = [];
	const dynamicFiles: string[] = [];
	for (const file of listFiles(root, testsGlob)) {
		const parsed = parsePlaywrightSource(readFileSync(file, "utf8"));
		const repoFile = relative(repoRoot, file).replace(/\\/g, "/");
		const relFile = relative(dir, file).replace(/\\/g, "/");
		if (parsed.dynamic || parsed.titles.length === 0) {
			dynamicFiles.push(repoFile);
		}
		for (const titlePath of parsed.titles) {
			tests.push({
				id: playwrightTestId(relFile, titlePath),
				file: repoFile,
				platform: "Shared",
			});
		}
	}
	tests.sort((a, b) => a.id.localeCompare(b.id));
	dynamicFiles.sort();
	return { tests, dynamicFiles };
}
