#!/usr/bin/env node
/**
 * Generic-catch justification gate (#2114) — the deterministic half of the
 * S2221 enforcement. SonarAnalyzer.CSharp covers `catch (Exception)` at build
 * time, but it deliberately does not fire inside async-void methods, on
 * catch-rethrow sites, or inside test methods — exactly the sites
 * github-code-quality (Qodana) kept flagging after #2569 merged (e.g. the
 * async-void link handlers added in #2596, flagged again on #2644). This
 * script closes that hole: EVERY generic catch in production app code must
 * carry a `//NOSONAR — <reason>` justification (the remote-visible half of the
 * documented pragma+NOSONAR pair), or the commit fails.
 *
 * What counts as generic: `catch (Exception`/`catch (System.Exception`,
 * bare `catch {`, and `when` filters that do not constrain the exception
 * type at all (`when (retries < 3)` still swallows every exception type).
 * Type-constraining `when` filters (`is`, `is not`, `.GetType()`) are the
 * audited "already narrow" class and pass unannotated.
 *
 * What counts as justified: `NOSONAR` on the catch line or on the contiguous
 * comment/#pragma run directly above it. A `#pragma warning disable` alone
 * does NOT justify — the review engines do not honor it and the site stays
 * undocumented for reviewers; add the `//NOSONAR — reason` half.
 *
 * Test assemblies (`app/*.Tests*`) are out of scope: the audited finding
 * surface was production code and S2221 already exempts test methods.
 *
 * Modes:
 *   scan-catch.cjs file1.cs file2.cs   gate mode — check the listed files
 *                                      (wired as the `catch-boundary`
 *                                      pre-commit hook, pass_filenames).
 *   scan-catch.cjs                     audit mode — scan every in-scope .cs
 *                                      under app/ and report (regenerates
 *                                      the catch-ledger site table).
 * Exit code is 1 whenever unjustified sites are found.
 */
const { readFileSync, readdirSync } = require("node:fs");
const { isAbsolute, join, relative } = require("node:path");

// SCAN_CATCH_ROOT overrides the repo root — the unit tests build a fixture
// tree in a temp dir instead of scanning the real app/.
const repoRoot = process.env.SCAN_CATCH_ROOT ?? join(__dirname, "..", "..");

// Audit scope = the #2599 ledger surface: production projects under app/.
// `*.Tests*` assemblies are excluded — their boundaries were triaged as
// "need no annotation" in the audit and the remote engines did not flag them.
const TEST_ASSEMBLY = /^app[/\\][^/\\]*\.Tests[^/\\]*[/\\]/;

/**
 * Blank out comments and string/char/raw-literal contents, preserving
 * positions so offsets still map back to the original line. Covers C#
 * verbatim `@"..."`, interpolated `$"..."`/`$@"..."`, raw `"""`+ strings and
 * char literals so a `catch (` inside a literal or comment cannot match.
 * Interpolated ${...} holes stay masked — `catch` is a statement and cannot
 * legally appear inside an interpolation expression.
 */
function maskCsharp(src) {
	const out = src.split("");
	const blank = (i) => {
		if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
	};
	const range = (from, to) => {
		for (let i = from; i < to && i < src.length; i++) blank(i);
	};

	let i = 0;
	while (i < src.length) {
		const two = src.slice(i, i + 2);
		if (two === "//") {
			const start = i;
			while (i < src.length && src[i] !== "\n") i++;
			range(start, i);
			continue;
		}
		if (two === "/*") {
			const start = i;
			i += 2;
			while (i < src.length && src.slice(i, i + 2) !== "*/") i++;
			range(start, Math.min(i + 2, src.length));
			i += 2;
			continue;
		}
		// Prefixes that make the following `"` non-standard: @" (verbatim),
		// $" (interpolated), $@" / @$" (interpolated verbatim).
		let j = i;
		let verbatim = false;
		while (src[j] === "$" || src[j] === "@") {
			if (src[j] === "@") verbatim = true;
			j++;
		}
		if (src[j] === '"' || src[j] === "'") {
			const quote = src[j];
			const start = i;
			if (quote === '"') {
				// Raw string: 3+ quotes, no escapes, closes on the same run.
				let run = 0;
				while (src[j + run] === '"') run++;
				if (run >= 3) {
					const closer = '"'.repeat(run);
					const end = src.indexOf(closer, j + run);
					range(start, end === -1 ? src.length : end + run);
					i = end === -1 ? src.length : end + run;
					continue;
				}
			}
			i = j + 1;
			while (i < src.length) {
				if (verbatim && quote === '"') {
					if (src[i] === '"' && src[i + 1] === '"') {
						i += 2; // "" inside a verbatim literal is an escaped quote
						continue;
					}
					if (src[i] === '"') {
						i++;
						break;
					}
					i++;
					continue;
				}
				if (src[i] === "\\") {
					i += 2;
					continue;
				}
				if (src[i] === quote) {
					i++;
					break;
				}
				i++;
			}
			range(start, i);
			continue;
		}
		i++;
	}
	return out.join("");
}

/** Map a character offset to a 1-based line number. */
function lineOf(starts, index) {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid] <= index) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
}

// `catch` head: optional parens clause. Matches `catch {`, `catch (Exception
// ex)`, `catch (System.Exception)`, `catch (global::System.Exception ex)` —
// plus the other base types S2221 reports (Application/SystemException).
// Excludes typed catches (`catch (IOException)`, `catch (ExceptionX)`).
const CATCH_HEAD = /\bcatch\b\s*(?:\(\s*(?:global::)?(?:System\.)?(?:Exception|ApplicationException|SystemException)(?:\s+[A-Za-z_]\w*)?\s*\)|(?!\s*\())/g;

/**
 * The `when` filter decides whether an `Exception` catch is really generic:
 *   when (ex is IOException or X)      -> narrowed to types   -> not generic
 *   when (ex is not GraphQLException)  -> type carve-out      -> not generic
 *   when (ex.GetType().Name == "T")    -> narrowed to a type  -> not generic
 *   when (retries < 3) / other cond    -> no type constraint  -> generic
 * Matches the #2599 ledger classification, which kept type-exclusion
 * filters in the "already narrow" set.
 */
function isNarrowFilter(filter) {
	return /\bis\b/.test(filter) || /\.GetType\s*\(/.test(filter);
}

/**
 * A catch site is justified when `NOSONAR` sits on the catch line or on the
 * contiguous run of comment/#pragma lines directly above it — the documented
 * dual convention is `#pragma warning disable S2221 // reason` on the line
 * above plus `//NOSONAR — reason` inline on the catch.
 */
function hasJustification(rawLines, lineIdx) {
	if (rawLines[lineIdx].includes("NOSONAR")) return true;
	for (let up = lineIdx - 1; up >= 0; up--) {
		const line = rawLines[up];
		if (!/^\s*(?:#pragma\b|\/\/)/.test(line)) break;
		if (line.includes("NOSONAR")) return true;
	}
	return false;
}

/** Return the unjustified generic-catch sites in one source file. */
function bareCatches(file, src) {
	const masked = maskCsharp(src);
	const starts = [0];
	for (let i = 0; i < src.length; i++) {
		if (src[i] === "\n") starts.push(i + 1);
	}
	const rawLines = src.split("\n");
	const bare = [];
	for (const match of masked.matchAll(CATCH_HEAD)) {
		const head = match[0];
		// A `when` filter follows the closing paren — read it from the raw
		// text and skip the site when it narrows the exception type.
		const tail = src.slice(match.index + head.length, match.index + head.length + 300);
		const whenMatch = tail.match(/^\s*when\s*\(/);
		if (whenMatch) {
			const open = whenMatch[0].lastIndexOf("(");
			let depth = 0;
			let end = -1;
			for (let k = open; k < tail.length; k++) {
				if (tail[k] === "(") depth++;
				else if (tail[k] === ")") {
					depth--;
					if (depth === 0) {
						end = k;
						break;
					}
				}
			}
			const filter = end === -1 ? tail : tail.slice(open + 1, end);
			if (isNarrowFilter(filter)) continue;
		}
		const ln = lineOf(starts, match.index);
		if (!hasJustification(rawLines, ln - 1)) {
			bare.push(`${file}:${ln}: ${rawLines[ln - 1].trim()}`);
		}
	}
	return bare;
}

/** Recursively list the in-scope .cs files under app/ (audit mode). */
function auditFiles(dir) {
	const files = [];
	for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			if (entry.name === "bin" || entry.name === "obj" || TEST_ASSEMBLY.test(`${rel}/`)) continue;
			files.push(...auditFiles(rel));
		} else if (entry.name.endsWith(".cs")) {
			files.push(rel);
		}
	}
	return files;
}

const argFiles = process.argv.slice(2);
let files;
if (argFiles.length > 0) {
	// Gate mode: check the listed files (absolute or repo-relative).
	files = argFiles
		.map((f) => (isAbsolute(f) ? relative(repoRoot, f) : f).replace(/\\/g, "/"))
		.filter((f) => f.endsWith(".cs"));
} else {
	files = auditFiles("app");
}
// Test-assembly exclusion applies in both modes (match on the dir prefix).
files = files.filter((f) => !TEST_ASSEMBLY.test(f.slice(0, f.lastIndexOf("/") + 1)));

const bare = [];
let checked = 0;
for (const file of files) {
	let src;
	try {
		src = readFileSync(join(repoRoot, file), "utf8");
	} catch {
		continue; // staged file removed between hook launch and read
	}
	checked++;
	bare.push(...bareCatches(file, src));
}

console.log(`scan-catch: ${checked} file(s) checked, ${bare.length} unjustified generic catch site(s)`);
if (bare.length > 0) {
	for (const site of bare) console.error(site);
	console.error(
		"Every generic catch must carry a documented reason: add `//NOSONAR — <reason>`" +
			"\ninline on the catch line (paired with `#pragma warning disable S2221` where the" +
			"\nanalyzer sees it). Narrow the catch to the real exception types instead when" +
			"\nthe try body is provably bounded. See docs/devops/catch-ledger.md.",
	);
	process.exit(1);
}
