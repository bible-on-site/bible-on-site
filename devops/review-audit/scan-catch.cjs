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
 * bare `catch {`, and `when` filters that do not constrain the exception to
 * concrete types — `when (ex is object)`, `when (ex is Exception)`, boolean
 * patterns (`ready is true`) and type-free conditions all still swallow
 * every exception type. Type-constraining `when` filters (`is`/`is not`
 * concrete types, `.GetType()` comparisons) are the audited "already
 * narrow" class and pass unannotated.
 *
 * What counts as justified: `//NOSONAR` followed by a reason on the catch
 * line or on the contiguous comment/#pragma run directly above it. A bare
 * `//NOSONAR` with no reason does not justify — the point is a documented
 * boundary reviewers can evaluate. A `#pragma warning disable` alone does
 * not justify either — the review engines do not honor it.
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
 *                                      the catch-ledger site table; also
 *                                      run in devops CI so hook-less
 *                                      commits cannot bypass the gate).
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
 * positions so offsets still map back to the original line. Comments and
 * literal text are masked; interpolation holes in `$"..."`/`$@"..."`/`$"""`+
 * strings stay unmasked because they hold executable code (a `catch` can
 * legally appear inside a hole lambda — and a quoted `catch (...)` inside a
 * hole's own string literal must NOT unmask itself). Raw strings use a
 * closing run equal to the opening run of 3+ quotes.
 */
function maskCsharp(src) {
	const out = src.split("");
	const blank = (i) => {
		if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
	};
	const range = (from, to) => {
		for (let i = from; i < to && i < src.length; i++) blank(i);
	};

	/**
	 * Scan code from i. When holeBraces > 0 we are inside an interpolation
	 * hole and stop after a `}`-run of holeBraces length (consumed, not
	 * masked — hole contents are code). Returns the next unscanned index.
	 */
	function scan(i, holeBraces) {
		while (i < src.length) {
			if (holeBraces > 0 && src[i] === "}") {
				let run = 0;
				while (src[i + run] === "}") run++;
				if (run >= holeBraces) return i + run;
				i += run;
				continue;
			}
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
			// String/char-literal dispatch with prefix awareness: @" (verbatim),
			// $" (interpolated), $@" / @$" (interpolated verbatim), $"""+ /
			// $$"""+ (raw, interpolated when $-prefixed).
			let j = i;
			let verbatim = false;
			let dollars = 0;
			while (src[j] === "$" || src[j] === "@") {
				if (src[j] === "$") dollars++;
				else verbatim = true;
				j++;
			}
			if (src[j] === '"' || src[j] === "'") {
				const start = i;
				const quote = src[j];
				let quoteRun = 0;
				if (quote === '"') while (src[j + quoteRun] === '"') quoteRun++;
				else quoteRun = 1;
				const raw = quoteRun >= 3;
				const interpolated = dollars > 0 && quote === '"';
				range(start, j + quoteRun); // prefix + opening quotes are literal
				i = interpolated
					? scanInterpLiteral(j + quoteRun, { verbatim, raw, quoteRun, dollars })
					: scanPlainLiteral(j + quoteRun, { quote, verbatim, raw, quoteRun });
				continue;
			}
			i++;
		}
		return i;
	}

	/** Literal contents of a non-interpolated string/char literal. */
	function scanPlainLiteral(i, { quote, verbatim, raw, quoteRun }) {
		const start = i;
		if (raw) {
			const closer = '"'.repeat(quoteRun);
			const end = src.indexOf(closer, i);
			range(start, end === -1 ? src.length : end + quoteRun);
			return end === -1 ? src.length : end + quoteRun;
		}
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
		return i;
	}

	/**
	 * An interpolated string's literal regions (masked) with holes kept as
	 * code. Non-raw interpolated strings escape a literal brace as `{{`;
	 * raw interpolated strings need `dollars` braces to open a hole.
	 */
	function scanInterpLiteral(i, { verbatim, raw, quoteRun, dollars }) {
		const holeBraces = raw ? dollars : 1;
		const closer = '"'.repeat(quoteRun);
		let start = i;
		while (i < src.length) {
			if (src.startsWith(closer, i)) {
				range(start, i + quoteRun);
				return i + quoteRun;
			}
			if (verbatim && src[i] === '"' && src[i + 1] === '"') {
				i += 2; // "" escaped quote inside a verbatim literal region
				continue;
			}
			if (!verbatim && !raw && src[i] === "\\") {
				i += 2;
				continue;
			}
			if (src[i] === "{") {
				let run = 0;
				while (src[i + run] === "{") run++;
				if (raw ? run < holeBraces : run >= 2) {
					i += run; // literal braces, stay masked
					continue;
				}
				range(start, i); // mask the literal text up to the hole
				i = scan(i + holeBraces, holeBraces); // hole contents are code
				start = i;
				continue;
			}
			i++;
		}
		range(start, i);
		return i;
	}

	scan(0, 0);
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
// Group 1 captures the exception variable name when present.
// Excludes typed catches (`catch (IOException)`, `catch (ExceptionX)`).
const CATCH_HEAD =
	/\bcatch\b\s*(?:\(\s*(?:global::)?(?:System\.)?(?:Exception|ApplicationException|SystemException)(?:\s+([A-Za-z_]\w*))?\s*\)|(?!\s*\())/g;

// Type names that leave the catch unconstrained — `is`/`is not` on any of
// these (or a non-type pattern like `is true`, `is {}`, `is (a, b)`) does not
// narrow anything.
const BROAD_TYPE = /^(?:global::)?(?:System\.)?(?:Exception|ApplicationException|SystemException|object|dynamic|var)$/;

/**
 * The `when` filter decides whether an `Exception` catch is really generic.
 * It narrows only when every operand tests the caught variable against a
 * concrete exception type:
 *   when (ex is IOException or X)      -> narrowed to types   -> not generic
 *   when (ex is not GraphQLException)  -> type carve-out      -> not generic
 *   when (ex.GetType().Name == "T")    -> narrowed to a type  -> not generic
 *   when (ex is object/Exception/true) -> still generic
 *   when (retries < 3) / other cond    -> no type constraint  -> generic
 * Matches the #2599 ledger classification, which kept type-exclusion
 * filters in the "already narrow" set.
 */
/** True when `word` occurs in `text` as a whole `\w` token. */
function hasToken(text, word) {
	let i = text.indexOf(word);
	while (i !== -1) {
		const beforeOk = i === 0 || !/\w/.test(text[i - 1]);
		const end = i + word.length;
		const afterOk = end >= text.length || !/\w/.test(text[end]);
		if (beforeOk && afterOk) return true;
		i = text.indexOf(word, i + 1);
	}
	return false;
}

/**
 * Index just past `<varName> is ` inside `text`, or -1 when the variable is
 * never the subject of an is-pattern. Token scanning avoids `new RegExp`
 * with a non-literal pattern (the repo's codacy-gate rejects it).
 */
function isSubjectIndex(text, varName) {
	let i = text.indexOf(varName);
	while (i !== -1) {
		const beforeOk = i === 0 || !/\w/.test(text[i - 1]);
		const end = i + varName.length;
		const afterOk = end >= text.length || !/\w/.test(text[end]);
		if (beforeOk && afterOk) {
			const m = text.slice(end).match(/^\s+is\s+/);
			if (m) return end + m[0].length;
		}
		i = text.indexOf(varName, i + 1);
	}
	return -1;
}

function isNarrowFilter(filter, varName) {
	// A when filter can only constrain the exception through its variable —
	// an unnamed catch's filter is always type-free.
	if (!varName) return false;
	// `||` short-circuits the type test: `ex is IOException || flag` fires
	// for every exception type whenever `flag` holds — still generic.
	if (/\|\|/.test(filter)) return false;
	if (hasToken(filter, varName) && /\.GetType\s*\(/.test(filter)) return true;
	// `&&` only adds conditions on top of the left-hand type test.
	const head = filter.split(/&&/)[0];
	const patternStart = isSubjectIndex(head, varName);
	if (patternStart === -1) return false;
	// Every operand of the is/or/and pattern must be a concrete type
	// identifier — anything else (object, Exception, true, {}, positional
	// patterns) leaves the catch unconstrained.
	return head
		.slice(patternStart)
		.split(/\bor\b|\band\b/)
		.every((op) => {
			const operand = op.trim().replace(/^not\s+/, "").trim();
			if (BROAD_TYPE.test(operand)) return false;
			return /^(?:global::)?(?:[A-Z_]\w*\.)*[A-Z_]\w*$/.test(operand);
		});
}

// A justification is `//NOSONAR` followed by reason text — a bare `//NOSONAR`
// (or only punctuation, e.g. a lone `—`) documents nothing.
const JUSTIFIED = /\/\/NOSONAR[\s—–\-:.]*\p{L}/u;

/**
 * A catch site is justified when a `//NOSONAR — <reason>` comment sits on the
 * catch line or on the contiguous run of comment/#pragma lines directly
 * above it — the documented dual convention is `#pragma warning disable
 * S2221 // reason` on the line above plus `//NOSONAR — reason` inline on the
 * catch.
 */
function hasJustification(rawLines, lineIdx) {
	if (JUSTIFIED.test(rawLines[lineIdx])) return true;
	for (let up = lineIdx - 1; up >= 0; up--) {
		const line = rawLines[up];
		if (!/^\s*(?:#pragma\b|\/\/)/.test(line)) break;
		if (JUSTIFIED.test(line)) return true;
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
		const varName = match[1];
		// A `when` filter follows the closing paren. Comments and literals
		// inside the filter are trivia for this purpose — evaluate it on the
		// masked text so a comment between the clause and `when` still sees
		// the filter and a literal can never forge an `is` test.
		const tail = masked.slice(match.index + head.length, match.index + head.length + 400);
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
			if (isNarrowFilter(filter, varName)) continue;
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
