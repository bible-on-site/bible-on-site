/**
 * Structural source fingerprints (#2085 — declaration/structural tier).
 *
 * A fingerprint is a trivia-insensitive digest of one source revision:
 * comments, line endings and pure formatting are dropped before hashing, so a
 * diff that only touches trivia cannot invalidate coverage evidence. Alongside
 * the digest, declaration signatures (types and members for C#, key identity
 * attributes for XAML/XML) are extracted and persisted for provenance.
 *
 * Equivalence is decided exclusively by `semantic` equality between the
 * baseline-persisted fingerprint and the tested-revision fingerprint. Any
 * input the lexer cannot prove it parsed returns `null`, which the selector
 * treats as "changed" — an unparseable file can never narrow a selection.
 */
import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = 1;

export interface SourceFingerprint {
	version: number;
	/** sha256 over the normalized token stream — trivia-insensitive. */
	semantic: string;
	/** Sorted declaration signatures extracted from the source (provenance). */
	declarations: string[];
}

export type SourceKind = "csharp" | "xml" | "script" | "json";

const KINDS: [string, SourceKind][] = [
	[".cs", "csharp"],
	[".xaml", "xml"],
	[".xml", "xml"],
	[".csproj", "xml"],
	[".props", "xml"],
	[".targets", "xml"],
	[".resx", "xml"],
	[".config", "xml"],
	[".plist", "xml"],
	[".axml", "xml"],
	[".storyboard", "xml"],
	[".entitlements", "xml"],
	[".ts", "script"],
	[".tsx", "script"],
	[".js", "script"],
	[".jsx", "script"],
	[".mjs", "script"],
	[".cjs", "script"],
	[".mts", "script"],
	[".cts", "script"],
	[".json5", "script"],
	[".json", "json"],
];

/** Maps a repo-relative path to its fingerprint dialect; `null` = uncomputable. */
export function sourceKind(path: string): SourceKind | null {
	const lower = path.toLowerCase();
	for (const [suffix, kind] of KINDS) {
		if (lower.endsWith(suffix)) return kind;
	}
	return null;
}

const sha256 = (text: string): string =>
	createHash("sha256").update(text).digest("hex");

/**
 * Computes the structural fingerprint for a known source dialect. Returns
 * `null` for unknown extensions, binary content or anything the lexer cannot
 * fully parse — callers treat `null` as "cannot prove unchanged".
 */
export function fingerprintSource(
	path: string,
	content: string,
): SourceFingerprint | null {
	const kind = sourceKind(path);
	if (kind === null || content.includes("\u0000")) return null;
	const normalized = content.replace(/\uFEFF/, "").replace(/\r\n?/g, "\n");
	switch (kind) {
		case "csharp":
			return fingerprintCSharp(normalized);
		case "xml":
			return fingerprintXml(normalized);
		case "script":
			return fingerprintScript(normalized);
		case "json":
			return fingerprintJson(normalized);
	}
}

/** `\w` plus non-ASCII letters (Hebrew identifiers are legal in C#). */
function isIdentChar(char: string): boolean {
	return (
		(char >= "a" && char <= "z") ||
		(char >= "A" && char <= "Z") ||
		(char >= "0" && char <= "9") ||
		char === "_" ||
		char.charCodeAt(0) > 127
	);
}

/**
 * Shared scanner over C-family syntax: drops `//` and `/* *\/` comments,
 * collapses whitespace, copies string/char literals verbatim and records `#`
 * line directives when `hashDirectives` is set (C# preprocessor lines carry
 * semantics like `#nullable enable`). Returns `null` on unterminated
 * comments, literals or malformed char literals.
 */
function scanCFamily(
	text: string,
	options: {
		singleQuoteStrings: boolean;
		backtickStrings: boolean;
		hashDirectives: boolean;
		regexBailout: boolean;
	},
): { tokens: string[] } | null {
	const tokens: string[] = [];
	const n = text.length;
	let i = 0;
	let current = "";
	let atLineStart = true;

	const flush = () => {
		if (current.length > 0) {
			tokens.push(current);
			current = "";
		}
	};
	const lastToken = () => tokens[tokens.length - 1];

	/** Scans a literal starting at `start` (index of the opening quote). */
	const scanQuoted = (start: number, quote: string, verbatim: boolean): number => {
		let j = start + 1;
		while (j < n) {
			const ch = text[j];
			if (!verbatim && ch === "\\") {
				j += 2;
				continue;
			}
			if (ch === quote) {
				if (verbatim && text[j + 1] === quote) {
					j += 2;
					continue;
				}
				return j + 1;
			}
			j++;
		}
		return -1;
	};

	while (i < n) {
		const char = text[i];
		if (char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\v") {
			if (char === "\n") atLineStart = true;
			flush();
			i++;
			continue;
		}
		if (char === "/" && text[i + 1] === "/") {
			flush();
			const end = text.indexOf("\n", i + 2);
			i = end === -1 ? n : end;
			continue;
		}
		if (char === "/" && text[i + 1] === "*") {
			flush();
			const end = text.indexOf("*/", i + 2);
			if (end === -1) return null;
			i = end + 2;
			continue;
		}
		if (options.regexBailout && char === "/") {
			// `/` can open a regex literal in JS/TS; rather than guess, bail to
			// the conservative path whenever the context could allow a regex.
			flush();
			const prev = lastToken();
			const regexContext =
				prev === undefined ||
				"({[=,:;!&|?+-*%^~<>".includes(prev) ||
				["return", "typeof", "case", "throw", "in", "of", "=>", "new", "delete", "void", "do", "else", "yield", "await"].includes(prev);
			if (regexContext) return null;
			tokens.push("/");
			i++;
			atLineStart = false;
			continue;
		}
		if (options.hashDirectives && char === "#" && atLineStart) {
			flush();
			const end = text.indexOf("\n", i + 1);
			const line = (end === -1 ? text.slice(i + 1) : text.slice(i + 1, end)).trim();
			// Directive arguments keep semantics (`#nullable enable`) — collapsed
			// whitespace only, and only for the parts outside string literals.
			tokens.push(`#${line.split(/[ \t]+/).join(" ")}`);
			i = end === -1 ? n : end;
			atLineStart = false;
			continue;
		}
		// String/char literals. `@"`/`$"`/`$$"`/`$@"`/`@$"` prefixes and `"""`
		// raw strings are detected by scanning the prefix run; literal bytes are
		// copied verbatim into the token so content edits still differ.
		let literalStart = -1;
		let verbatim = false;
		let quoteRun = 0;
		{
			let j = i;
			let sawAt = false;
			if (text[j] === "@") {
				sawAt = true;
				j++;
			}
			while (text[j] === "$") j++;
			if (text[j] === "@" && !sawAt) {
				sawAt = true;
				j++;
			}
			if (text[j] === '"') {
				literalStart = j;
				verbatim = sawAt;
				while (text[j + quoteRun] === '"') quoteRun++;
			}
		}
		if (literalStart !== -1 && quoteRun >= 3) {
			// Raw string: closes on a run of exactly `quoteRun` quotes.
			flush();
			const closer = '"'.repeat(quoteRun);
			const end = text.indexOf(closer, literalStart + quoteRun);
			if (end === -1) return null;
			const literal = text.slice(i, end + quoteRun);
			tokens.push(`S:${literal}`);
			i = end + quoteRun;
			atLineStart = false;
			continue;
		}
		if (literalStart !== -1) {
			flush();
			const end = scanQuoted(literalStart, '"', verbatim);
			if (end === -1) return null;
			const literal = text.slice(i, end);
			tokens.push(`S:${literal}`);
			i = end;
			atLineStart = false;
			continue;
		}
		if (options.backtickStrings && char === "`") {
			flush();
			const end = scanQuoted(i, "`", false);
			if (end === -1) return null;
			tokens.push(`S:${text.slice(i, end)}`);
			i = end;
			atLineStart = false;
			continue;
		}
		if (options.singleQuoteStrings && char === "'") {
			flush();
			const end = scanQuoted(i, "'", false);
			if (end === -1) return null;
			tokens.push(`S:${text.slice(i, end)}`);
			i = end;
			atLineStart = false;
			continue;
		}
		if (char === "'") {
			// C# char literal: bounded scan for the closing quote.
			flush();
			let j = i + 1;
			let end = -1;
			while (j < n && j <= i + 8) {
				if (text[j] === "\\") {
					j += 2;
					continue;
				}
				if (text[j] === "'") {
					end = j + 1;
					break;
				}
				if (text[j] === "\n") break;
				j++;
			}
			if (end === -1) return null;
			tokens.push(`S:${text.slice(i, end)}`);
			i = end;
			atLineStart = false;
			continue;
		}
		if (isIdentChar(char)) {
			current += char;
			i++;
			atLineStart = false;
			continue;
		}
		flush();
		tokens.push(char);
		i++;
		atLineStart = false;
	}
	flush();
	return { tokens };
}

const TYPE_KEYWORDS = new Set([
	"class",
	"interface",
	"struct",
	"record",
	"enum",
	"delegate",
]);

// Statement keywords that cannot open a declaration run at file/type depth.
// `unsafe`, `fixed` and `checked` are deliberately absent — they are valid
// member modifiers and must reach the type/member classifier.
const SKIP_RUN_PREFIXES = new Set([
	"using",
	"return", "throw", "break", "continue", "goto",
	"else", "do", "while", "for", "foreach", "if", "switch", "lock",
	"catch", "finally", "try",
]);

/**
 * Extracts declaration signatures from a C-family token stream: type
 * declarations and member signatures at file or type-body depth. Runs inside
 * method/property bodies are not declarations; local functions are ignored
 * (the list is provenance, not an equivalence input).
 */
function extractDeclarations(tokens: string[]): string[] {
	const declarations = new Set<string>();
	// Stack entries: "type" = members may appear at this level, anything else
	// is an opaque body. File scope is implicit when the stack is empty.
	const contexts: string[] = [];
	let runStart = 0;
	let parenDepth = 0;
	let bracketDepth = 0;

	const classifyRun = (end: number): void => {
		const run = tokens.slice(runStart, end);
		runStart = end + 1;
		if (run.length === 0) return;
		if (contexts.length > 0 && contexts[contexts.length - 1] !== "type") return;
		if (!run.some((token) => isIdentChar(token[0]))) return;
		const first = run[0];
		const joined = run.join(" ");
		if (first === "namespace") {
			declarations.add(`ns:${run.slice(1).join("")}`.slice(0, 160));
			return;
		}
		if (SKIP_RUN_PREFIXES.has(first)) return;
		const kwIndex = run.findIndex((token) => TYPE_KEYWORDS.has(token));
		if (kwIndex !== -1) {
			const name = run.slice(kwIndex + 1).find((token) => isIdentChar(token[0]));
			declarations.add(`type:${run[kwIndex]}:${name ?? "?"}`);
			return;
		}
		// Member signature (field before `=`/`;`, method/property before `{`).
		declarations.add(`member:${joined}`.slice(0, 200));
	};

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "(") parenDepth++;
		else if (token === ")") parenDepth--;
		else if (token === "[") bracketDepth++;
		else if (token === "]") bracketDepth--;
		else if (token === "{" && parenDepth === 0 && bracketDepth === 0) {
			const run = tokens.slice(runStart, index);
			const isType = run.some((t) => TYPE_KEYWORDS.has(t));
			classifyRun(index);
			contexts.push(isType ? "type" : "body");
			runStart = index + 1;
		} else if (token === "}" && parenDepth === 0 && bracketDepth === 0) {
			classifyRun(index);
			contexts.pop();
			runStart = index + 1;
		} else if (
			(token === ";" || token === "=" || token === ",") &&
			parenDepth === 0 &&
			bracketDepth === 0 &&
			contexts.every((ctx) => ctx === "type")
		) {
			classifyRun(index);
		} else if (
			(token === ";" || token === "=" || token === ",") &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			// Inside opaque bodies just reset the run — locals are not declarations.
			runStart = index + 1;
		}
	}
	return [...declarations].sort();
}

function fingerprintCSharp(text: string): SourceFingerprint | null {
	const scanned = scanCFamily(text, {
		singleQuoteStrings: false,
		backtickStrings: false,
		hashDirectives: true,
		regexBailout: false,
	});
	if (scanned === null) return null;
	return {
		version: FINGERPRINT_VERSION,
		semantic: sha256(scanned.tokens.join("")),
		declarations: extractDeclarations(scanned.tokens),
	};
}

function fingerprintScript(text: string): SourceFingerprint | null {
	const scanned = scanCFamily(text, {
		singleQuoteStrings: true,
		backtickStrings: true,
		hashDirectives: false,
		regexBailout: true,
	});
	if (scanned === null) return null;
	return {
		version: FINGERPRINT_VERSION,
		semantic: sha256(scanned.tokens.join("")),
		declarations: extractDeclarations(scanned.tokens),
	};
}

function fingerprintJson(text: string): SourceFingerprint | null {
	const scanned = scanCFamily(text, {
		singleQuoteStrings: false,
		backtickStrings: false,
		hashDirectives: false,
		regexBailout: false,
	});
	if (scanned === null) return null;
	return {
		version: FINGERPRINT_VERSION,
		semantic: sha256(scanned.tokens.join("")),
		declarations: [],
	};
}

/**
 * XAML/XML normalizer: comments vanish, whitespace inside tags collapses,
 * attribute quoting unifies and whitespace-only text nodes collapse (unless
 * `xml:space="preserve"` appears anywhere). Text-bearing nodes keep their
 * exact bytes — whitespace inside content stays significant.
 */
function fingerprintXml(text: string): SourceFingerprint | null {
	const preserveSpace =
		text.includes('xml:space="preserve"') || text.includes("xml:space='preserve'");
	const tokens: string[] = [];
	const declarations = new Set<string>();
	const n = text.length;
	let i = 0;

	while (i < n) {
		if (text.startsWith("<!--", i)) {
			const end = text.indexOf("-->", i + 4);
			if (end === -1) return null;
			i = end + 3;
			continue;
		}
		if (text.startsWith("<![CDATA[", i)) {
			const end = text.indexOf("]]>", i + 9);
			if (end === -1) return null;
			tokens.push(`C:${text.slice(i + 9, end)}`);
			i = end + 3;
			continue;
		}
		if (text.startsWith("<?", i)) {
			const end = text.indexOf("?>", i + 2);
			if (end === -1) return null;
			tokens.push(`P:${text.slice(i + 2, end).trim().split(/\s+/).join(" ")}`);
			i = end + 2;
			continue;
		}
		if (text.startsWith("<!", i)) {
			const end = text.indexOf(">", i + 2);
			if (end === -1) return null;
			tokens.push(`D:${text.slice(i + 2, end).trim()}`);
			i = end + 1;
			continue;
		}
		if (text[i] === "<") {
			const close = text[i + 1] === "/";
			let j = i + (close ? 2 : 1);
			let name = "";
			while (j < n && text[j] !== ">" && text[j] !== "/" && text[j] !== " " && text[j] !== "\t" && text[j] !== "\n") {
				name += text[j];
				j++;
			}
			if (name.length === 0) return null;
			if (close) {
				while (j < n && text[j] !== ">") j++;
				if (j >= n) return null;
				tokens.push(`</${name}>`);
				i = j + 1;
				continue;
			}
			const attrs: string[] = [];
			let selfClose = false;
			while (j < n) {
				while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n")) j++;
				if (j >= n) return null;
				if (text.startsWith("/>", j)) {
					selfClose = true;
					j += 2;
					break;
				}
				if (text[j] === ">") {
					j++;
					break;
				}
				let attr = "";
				while (j < n && text[j] !== "=" && text[j] !== ">" && text[j] !== "/" && text[j] !== " " && text[j] !== "\t" && text[j] !== "\n") {
					attr += text[j];
					j++;
				}
				while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n")) j++;
				if (text[j] === "=") {
					j++;
					while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n")) j++;
					const quote = text[j];
					if (quote !== '"' && quote !== "'") return null;
					const valueEnd = text.indexOf(quote, j + 1);
					if (valueEnd === -1) return null;
					const value = text.slice(j + 1, valueEnd);
					j = valueEnd + 1;
					attrs.push(`${attr}="${value}"`);
					if (
						attr === "x:Class" || attr.endsWith(":Class") ||
						attr === "x:Name" || attr.endsWith(":Name") ||
						attr === "AutomationId" || attr.endsWith(":AutomationId")
					) {
						declarations.add(`attr:${attr}:${value}`);
					}
				} else {
					attrs.push(attr);
				}
			}
			tokens.push(`<${name}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}${selfClose ? " />" : ">"}`);
			i = j;
			continue;
		}
		// Text run up to the next markup token.
		const end = text.indexOf("<", i);
		const run = end === -1 ? text.slice(i) : text.slice(i, end);
		const isWhitespaceOnly = run.trim().length === 0;
		if (!isWhitespaceOnly || preserveSpace) {
			tokens.push(`T:${run}`);
		}
		i = end === -1 ? n : end;
	}
	return {
		version: FINGERPRINT_VERSION,
		semantic: sha256(tokens.join("")),
		declarations: [...declarations].sort(),
	};
}

/** Fingerprint for a buffer read from disk; binary content never computes. */
export function fingerprintFileBytes(path: string, bytes: Buffer): SourceFingerprint | null {
	if (bytes.includes(0)) return null;
	return fingerprintSource(path, bytes.toString("utf8"));
}
