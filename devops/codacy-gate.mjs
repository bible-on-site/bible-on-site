#!/usr/bin/env node
/**
 * Local gate for the recurring Codacy findings that have no Roslyn analyzer or
 * linter equivalent in this repo's toolchains — the C#-side patterns are
 * enforced by SonarAnalyzer.CSharp at build time (see app/Directory.Build.props
 * and the [*.cs] section of .editorconfig) and the Python-side ones by ruff
 * (ruff.toml); everything else lands here so it fails `pre-commit` instead of
 * first surfacing as post-push Codacy annotations.
 *
 * Covered Codacy patterns (message -> check):
 *   - "Use of unicode characters in a non unicode string" (*.sql):
 *     a single-quoted literal containing non-ASCII must be written N'...'
 *     (or a _charset'...' introducer).
 *   - "args/args_os should not be used for security operations" (*.rs):
 *     any std::env::args/args_os call site must carry an adjacent `nosemgrep`
 *     justification comment (same convention Semgrep honors on Codacy).
 *   - "The `RegExp` constructor was called with a non-literal value" /
 *     "RegExp() called with a `pattern` function argument" (JS/TS):
 *     RegExp()/new RegExp() whose first argument is not a literal.
 *   - "The string method replaceAll is not supported ... older browsers"
 *     (JS/TS): String.prototype.replaceAll is not transpiled; use a global
 *     regex replace.
 *
 * The pre-commit hook feeds the staged files as argv; each check only inspects
 * the extensions it understands. Exit code 1 if any finding is reported.
 *
 * Comments and string/regex contents are masked before matching so a pattern
 * can never fire inside a comment or literal (except the SQL-string check,
 * which intentionally inspects literal contents).
 */
import { readFileSync } from "node:fs";

const files = process.argv.slice(2).map((f) => f.replace(/\\/g, "/"));

/** Findings collected across all files: { file, line, rule, detail }. */
const findings = [];

function report(file, offsetToLine, index, rule, detail) {
	findings.push({ file, line: offsetToLine(index), rule, detail });
}

/** Build an index->lineNumber (1-based) mapper for a source string. */
function lineMapper(src) {
	const starts = [0];
	for (let i = 0; i < src.length; i++) {
		if (src[i] === "\n") starts.push(i + 1);
	}
	return (index) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= index) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
}

/**
 * Blank out comments and literal contents, preserving positions so offsets in
 * the masked text still map back to the original. `strings` lists the quote
 * characters that open literals; `'\\'` escapes are honored. Template literals
 * are masked in full (interpolated ${...} code included — brace counting is
 * not used here).
 */
function maskNonCode(src, { lineComment, blockComment, strings }) {
	const out = src.split("");
	const blank = (i) => {
		if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
	};
	let i = 0;
	while (i < src.length) {
		const two = src.slice(i, i + 2);
		if (lineComment && two === lineComment) {
			while (i < src.length && src[i] !== "\n") blank(i++);
			continue;
		}
		if (blockComment && two === blockComment[0]) {
			blank(i++);
			blank(i++);
			while (i < src.length && src.slice(i, i + 2) !== blockComment[1]) blank(i++);
			blank(i++);
			blank(i++);
			continue;
		}
		if (strings.includes(src[i])) {
			const quote = src[i];
			blank(i++);
			while (i < src.length) {
				if (src[i] === "\\") {
					blank(i++);
					if (i < src.length) blank(i++);
					continue;
				}
				if (src[i] === quote) {
					blank(i++);
					break;
				}
				blank(i++);
			}
			continue;
		}
		i++;
	}
	return out.join("");
}

/** Non-ASCII inside a '...' literal must carry an N'...'/_charset'...' prefix. */
function checkSqlUnicode(file, src) {
	// Mask comments only — the check inspects literal contents.
	const masked = maskNonCode(src, {
		lineComment: "--",
		blockComment: ["/*", "*/"],
		strings: [],
	});
	const toLine = lineMapper(src);
	// Manually scan literals so '' and backslash escapes are exact.
	let i = 0;
	while (i < masked.length) {
		if (masked[i] !== "'") {
			i++;
			continue;
		}
		const start = i;
		i++;
		let content = "";
		let closed = false;
		while (i < masked.length) {
			if (masked[i] === "\\") {
				content += masked[i] + (masked[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (masked[i] === "'") {
				if (masked[i + 1] === "'") {
					content += "''";
					i += 2;
					continue;
				}
				i++;
				closed = true;
				break;
			}
			content += masked[i++];
		}
		if (!closed) break;
		if (!/[^\x00-\x7F]/.test(content)) continue;
		// What precedes the quote decides if the literal is unicode-capable.
		const prefix = /[_A-Za-z0-9]*$/.exec(masked.slice(0, start))[0];
		const unicodeAware = /^[Nn]$/.test(prefix) || /^_[A-Za-z]/.test(prefix);
		if (!unicodeAware) {
			report(
				file,
				toLine,
				start,
				"sql-unicode-literal",
				"non-ASCII text in a non-unicode string literal — write it as N'...' (Codacy: \"Use of unicode characters in a non unicode string\")",
			);
		}
	}
}

/** std::env::args[_os] must carry an adjacent nosemgrep justification. */
function checkRustArgs(file, src) {
	const masked = maskNonCode(src, {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"'],
	});
	const toLine = lineMapper(src);
	const rawLines = src.split("\n");
	for (const match of masked.matchAll(/\b(?:std::)?env::args(?:_os)?\b/g)) {
		const line = toLine(match.index);
		const here = rawLines[line - 1];
		const above = line > 1 ? rawLines[line - 2] : "";
		if (here.includes("nosemgrep") || above.includes("nosemgrep")) continue;
		report(
			file,
			toLine,
			match.index,
			"rust-env-args",
			"std::env::args/args_os must not feed security-relevant decisions — pass the value explicitly (Codacy: \"args should not be used for security operations\")",
		);
	}
}

/**
 * JS/TS masked-code checks. `lang` tweaks the masker (TS/JS share syntax here).
 */
function maskedJs(src) {
	return maskNonCode(src, {
		lineComment: "//",
		blockComment: ["/*", "*/"],
		strings: ['"', "'", "`"],
	});
}

/** .replaceAll( is flagged for missing transpilation on older browsers. */
function checkReplaceAll(file, src, masked) {
	const toLine = lineMapper(src);
	for (const match of masked.matchAll(/\.replaceAll\s*\(/g)) {
		report(
			file,
			toLine,
			match.index,
			"no-replaceall",
			"String.prototype.replaceAll is not transpiled — use .replace(/pattern/g, ...) (Codacy: \"replaceAll is not supported ... older browser versions\")",
		);
	}
}

/** RegExp()/new RegExp() with a non-literal first argument (ReDoS vector). */
function checkNonLiteralRegExp(file, src, masked) {
	const toLine = lineMapper(src);
	for (const match of masked.matchAll(/\bRegExp\s*\(/g)) {
		// Skip member accesses (foo.RegExp() — not the constructor function).
		if (match.index > 0 && masked[match.index - 1] === ".") continue;
		// Find the first argument in the ORIGINAL text (strings are masked out,
		// so a quoted first arg reads as whitespace there).
		let j = match.index + match[0].length;
		while (j < src.length && /\s/.test(src[j])) j++;
		const c = src[j];
		if (c === "'" || c === '"') continue; // plain string literal pattern
		if (c === "/") continue; // regex literal pattern
		if (c === "`") {
			// Template literal: flagged only when it interpolates ${...}.
			const end = src.indexOf("`", j + 1);
			if (end !== -1 && !src.slice(j + 1, end).includes("${")) continue;
		}
		report(
			file,
			toLine,
			match.index,
			"non-literal-regexp",
			"RegExp() called with a non-literal pattern (ReDoS vector) — inline a literal regex (Codacy: \"The `RegExp` constructor was called with a non-literal value\")",
		);
	}
}

const SQL_RE = /\.sql$/;
const RUST_RE = /\.rs$/;
const JS_RE = /\.(?:m?[jt]sx?|c[jt]s)$/;

for (const file of files) {
	let src;
	try {
		src = readFileSync(file, "utf8");
	} catch {
		continue; // staged file removed between hook launch and read
	}
	if (SQL_RE.test(file)) checkSqlUnicode(file, src);
	if (RUST_RE.test(file)) checkRustArgs(file, src);
	if (JS_RE.test(file)) {
		const masked = maskedJs(src);
		checkReplaceAll(file, src, masked);
		checkNonLiteralRegExp(file, src, masked);
	}
}

if (findings.length > 0) {
	for (const f of findings) {
		console.error(`codacy-gate ${f.rule}: ${f.file}:${f.line}: ${f.detail}`);
	}
	console.error(`codacy-gate: ${findings.length} finding(s)`);
	process.exit(1);
}
