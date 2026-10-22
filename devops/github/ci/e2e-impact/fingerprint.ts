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
	/**
	 * Declaration-level semantic digests for C# sources (the AST tier):
	 * `Ns.Type.Member#<sig>` keys over trivia-insensitive member bodies plus
	 * `type:Ns.Type` keys over type declaration runs. A member's key carries
	 * its signature hash, so a signature edit reads as remove+add while a
	 * body-only edit keeps the key and changes the digest — the selector
	 * narrows covered files to the members that actually changed. Absent for
	 * non-C# kinds and absent in older baselines — both fall back to
	 * file-level selection.
	 */
	members?: Record<string, string>;
	/**
	 * Trivia-insensitive digest over every token OUTSIDE a `member`-kind
	 * span — directives, usings, namespace/type declaration runs and any
	 * file-scope text. A diff that touches none of the member digests but
	 * changes this digest (e.g. a `using` edit) cannot be attributed to a
	 * member, so the selector widens to the file's whole covering set.
	 * Absent in older baselines — treated as "unknown outside" → widen.
	 */
	nonMember?: string;
}

/**
 * One source declaration member (C#): the narrowing unit for member-level
 * selection and the span anchor for exec-node → member mapping.
 */
export interface SourceMember {
	/** Stable identity: `Ns.Type.Member#<sigHash12>` or `type:Ns.Type`. */
	key: string;
	/** `member` entries may contain execution nodes; `type` entries cannot. */
	kind: "member" | "type";
	/** Enclosing type identity (`Ns.Type`), `""` at file scope. */
	typeKey: string;
	/** 1-based inclusive `[startLine, endLine]` covering the whole member. */
	span: [number, number];
	/** Trivia-insensitive sha256 over the member's token span. */
	semantic: string;
	/**
	 * Token-index `[start, endExclusive)` range the member covers — internal
	 * to fingerprinting so a "rest of file" digest can exclude member text
	 * precisely (line spans would also hide tokens sharing a member line).
	 */
	tokenRange?: [number, number];
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
 *
 * `lines` is parallel to `tokens`: the 1-based source line each token starts
 * on. Multi-line literals record their first line — the member extractor
 * only needs containment spans, never exact offsets.
 */
function scanCFamily(
	text: string,
	options: {
		singleQuoteStrings: boolean;
		backtickStrings: boolean;
		hashDirectives: boolean;
		regexBailout: boolean;
	},
): { tokens: string[]; lines: number[] } | null {
	const tokens: string[] = [];
	const lines: number[] = [];
	const n = text.length;
	let i = 0;
	let current = "";
	let currentLine = 1;
	let line = 1;
	let atLineStart = true;

	const countNewlines = (from: number, to: number): number => {
		let count = 0;
		for (let j = from; j < to; j++) if (text[j] === "\n") count++;
		return count;
	};
	const push = (token: string, tokenLine: number) => {
		tokens.push(token);
		lines.push(tokenLine);
	};
	const flush = () => {
		if (current.length > 0) {
			push(current, currentLine);
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
			if (char === "\n") {
				atLineStart = true;
				line++;
			}
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
			line += countNewlines(i, end + 2);
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
			push("/", line);
			i++;
			atLineStart = false;
			continue;
		}
		if (options.hashDirectives && char === "#" && atLineStart) {
			flush();
			const end = text.indexOf("\n", i + 1);
			const directive = (end === -1 ? text.slice(i + 1) : text.slice(i + 1, end)).trim();
			// Directive arguments keep semantics (`#nullable enable`) — collapsed
			// whitespace only, and only for the parts outside string literals.
			push(`#${directive.split(/[ \t]+/).join(" ")}`, line);
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
			push(`S:${literal}`, line);
			line += countNewlines(i, end + quoteRun);
			i = end + quoteRun;
			atLineStart = false;
			continue;
		}
		if (literalStart !== -1) {
			flush();
			const end = scanQuoted(literalStart, '"', verbatim);
			if (end === -1) return null;
			const literal = text.slice(i, end);
			push(`S:${literal}`, line);
			line += countNewlines(i, end);
			i = end;
			atLineStart = false;
			continue;
		}
		if (options.backtickStrings && char === "`") {
			flush();
			const end = scanQuoted(i, "`", false);
			if (end === -1) return null;
			push(`S:${text.slice(i, end)}`, line);
			line += countNewlines(i, end);
			i = end;
			atLineStart = false;
			continue;
		}
		if (options.singleQuoteStrings && char === "'") {
			flush();
			const end = scanQuoted(i, "'", false);
			if (end === -1) return null;
			push(`S:${text.slice(i, end)}`, line);
			line += countNewlines(i, end);
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
			push(`S:${text.slice(i, end)}`, line);
			line += countNewlines(i, end);
			i = end;
			atLineStart = false;
			continue;
		}
		if (isIdentChar(char)) {
			if (current === "") currentLine = line;
			current += char;
			i++;
			atLineStart = false;
			continue;
		}
		flush();
		push(char, line);
		i++;
		atLineStart = false;
	}
	flush();
	return { tokens, lines };
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
		if (!run.some((part) => isIdentChar(part[0]))) return;
		const first = run[0];
		const joined = run.join(" ");
		if (first === "namespace") {
			declarations.add(`ns:${run.slice(1).join("")}`.slice(0, 160));
			return;
		}
		if (SKIP_RUN_PREFIXES.has(first)) return;
		const kwIndex = run.findIndex((part) => TYPE_KEYWORDS.has(part));
		if (kwIndex !== -1) {
			const name = run.slice(kwIndex + 1).find((part) => isIdentChar(part[0]));
			declarations.add(`type:${run[kwIndex]}:${name ?? "?"}`);
			return;
		}
		// Member signature (field before `=`/`;`, method/property before `{`).
		declarations.add(`member:${joined}`.slice(0, 200));
	};

	for (let index = 0; index < tokens.length; index++) {
		const part = tokens[index];
		if (part === "(") parenDepth++;
		else if (part === ")") parenDepth--;
		else if (part === "[") bracketDepth++;
		else if (part === "]") bracketDepth--;
		else if (part === "{" && parenDepth === 0 && bracketDepth === 0) {
			const run = tokens.slice(runStart, index);
			const isType = run.some((t) => TYPE_KEYWORDS.has(t));
			classifyRun(index);
			contexts.push(isType ? "type" : "body");
			runStart = index + 1;
		} else if (part === "}" && parenDepth === 0 && bracketDepth === 0) {
			classifyRun(index);
			contexts.pop();
			runStart = index + 1;
		} else if (
			(part === ";" || part === "=" || part === ",") &&
			parenDepth === 0 &&
			bracketDepth === 0 &&
			contexts.every((ctx) => ctx === "type")
		) {
			classifyRun(index);
		} else if (
			(part === ";" || part === "=" || part === ",") &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			// Inside opaque bodies just reset the run — locals are not declarations.
			runStart = index + 1;
		}
	}
	return [...declarations].sort();
}

// ── Member-level extraction (the AST tier, #2085) ───────────────────────

/**
 * Resolves a member's name from its declaration run: the identifier before
 * the parameter list for callable members (`M<T>(…)` walks back over the
 * generic bracket), else the last identifier before the first `=` — covers
 * fields, properties, events and expression-bodied members. Falls back to
 * the run's last identifier; `?` when the run carries none.
 */
function memberName(run: string[]): string {
	let lastIdent: string | undefined;
	let bracketDepth = 0;
	for (let index = 0; index < run.length; index++) {
		const part = run[index];
		if (part === "[") {
			bracketDepth++;
			continue;
		}
		if (part === "]") {
			bracketDepth--;
			continue;
		}
		if (bracketDepth > 0) continue;
		if (part === "(" || part === "=") {
			if (part === "(" && run[index - 1] === ">") {
				// Generic method `M<T>(`: the name precedes the matching `<`.
				let depth = 0;
				for (let j = index - 1; j >= 0; j--) {
					if (run[j] === ">") depth++;
					else if (run[j] === "<") {
						depth--;
						if (depth === 0) {
							for (let k = j - 1; k >= 0; k--) {
								if (isIdentChar(run[k][0])) return run[k];
								break;
							}
							break;
						}
					}
				}
			}
			return lastIdent ?? "?";
		}
		if (isIdentChar(part[0])) lastIdent = part;
	}
	return lastIdent ?? "?";
}

/**
 * Extracts declaration members from a C-family token stream — the AST tier
 * the issue prescribes at member granularity. Only declaration surfaces
 * contribute: file scope, namespace blocks and type bodies. Anything inside
 * a member body (locals, lambdas, anonymous members) is opaque.
 *
 * Each member key is `Ns.Type.Name#<sig>` — the signature hash covers the
 * declaration run up to the body/`;` terminator, so overloads and signature
 * edits get distinct keys while body-only edits keep them. `type:` entries
 * record a type's own declaration run (base list, attributes, constraints)
 * so type-shape changes widen past member granularity. Member spans cover
 * the full declaration including the body — the containment anchor the
 * exec tree uses to map `method:*` nodes onto source members.
 *
 * Runs that do not classify (statement leftovers at file scope, garbage
 * after `,`) produce no members — worst case the file narrows less, never
 * wrongly.
 */
export function extractMembers(tokens: string[], lines: number[]): SourceMember[] {
	const members: SourceMember[] = [];
	interface PendingMember {
		member: SourceMember;
		startIndex: number;
	}
	interface Context {
		kind: "namespace" | "type" | "body";
		/** Qualified name segments (`Ns.Outer.Inner` path parts). */
		name: string;
		/** The member whose body this context is — its span closes with it. */
		pending?: PendingMember;
	}
	const contexts: Context[] = [];
	let fileNamespace = "";
	let runStart = 0;
	let parenDepth = 0;
	let bracketDepth = 0;
	/** Member whose body just closed — a following `= expr;` joins it. */
	let lastClosed: PendingMember | undefined;

	/**
	 * `Ns` / `Ns.Outer.Inner` — the innermost declared scope. Context names
	 * are stored fully qualified (each push already resolved its parent),
	 * so the last non-body context is the complete scope.
	 */
	const scopeName = (): string => {
		for (let index = contexts.length - 1; index >= 0; index--) {
			const context = contexts[index];
			if (context.kind !== "body") return context.name;
		}
		return fileNamespace;
	};

	/** Whether the current position is a declaration surface (no open body). */
	const atDeclSurface = () => contexts.every((context) => context.kind !== "body");

	const semantic = (start: number, endExclusive: number): string =>
		sha256(tokens.slice(start, endExclusive).join(""));
	const signature = (start: number, endExclusive: number): string =>
		sha256(tokens.slice(start, endExclusive).join("")).slice(0, 12);

	/**
	 * First token that is not a `#`-line directive: `#if`-guarded runs carry
	 * directive tokens inline (`#if IOS`, `#endif`) and the declaration kind
	 * is decided by the first real token (`namespace`, `using`, a type kw).
	 */
	const firstReal = (run: string[]): string | undefined =>
		run.find((part) => !part.startsWith("#"));

	/**
	 * Declared type name for a run whose `kwIndex` holds a type keyword:
	 * `delegate` names sit before the parameter list (`delegate R Name(…)`),
	 * every other kind names itself right after the keyword run (skipping a
	 * `record struct`/`record class` companion keyword).
	 */
	const typeDeclName = (run: string[], kwIndex: number): string | undefined => {
		if (run[kwIndex] === "delegate") {
			const open = run.indexOf("(", kwIndex);
			if (open === -1) return undefined;
			for (let i = open - 1; i > kwIndex; i--) {
				if (isIdentChar(run[i][0]) && !TYPE_KEYWORDS.has(run[i])) return run[i];
			}
			return undefined;
		}
		for (let i = kwIndex + 1; i < run.length; i++) {
			const part = run[i];
			if (TYPE_KEYWORDS.has(part)) continue;
			return isIdentChar(part[0]) ? part : undefined;
		}
		return undefined;
	};

	/**
	 * Index of a type keyword in DECLARATOR position, else `-1`. Generic
	 * constraints (`where T : class`/`struct`) and member accesses
	 * (`x.Type`, `default(Enum)`) place keywords where no declaration
	 * starts — the keyword must not follow `:`, `,`, `(`, `.` or `?` and
	 * must be followed by a resolvable type name.
	 */
	const typeDeclIndex = (run: string[]): number => {
		for (let i = 0; i < run.length; i++) {
			if (!TYPE_KEYWORDS.has(run[i])) continue;
			const prev = i > 0 ? run[i - 1] : "";
			if (prev === ":" || prev === "," || prev === "(" || prev === "." || prev === "?") {
				continue;
			}
			if (typeDeclName(run, i) !== undefined) return i;
		}
		return -1;
	};

	const emitMember = (sigEnd: number, endIndex: number): PendingMember | null => {
		const run = tokens.slice(runStart, sigEnd);
		if (run.length === 0) return null;
		if (!run.some((part) => isIdentChar(part[0]))) return null;
		const first = firstReal(run);
		if (first === undefined || SKIP_RUN_PREFIXES.has(first)) return null;
		if (typeDeclIndex(run) !== -1) return null;
		if (first === "namespace") return null;
		const name = memberName(run);
		const scope = scopeName();
		const key = `${scope.length > 0 ? `${scope}.` : ""}${name}#${signature(runStart, sigEnd)}`;
		const member: SourceMember = {
			key,
			kind: "member",
			typeKey: scope,
			span: [lines[runStart], lines[endIndex]],
			semantic: semantic(runStart, endIndex + 1),
			tokenRange: [runStart, endIndex + 1],
		};
		members.push(member);
		return { member, startIndex: runStart };
	};

	const emitTypeEntry = (endIndex: number): void => {
		const run = tokens.slice(runStart, endIndex);
		const kwIndex = typeDeclIndex(run);
		if (kwIndex === -1) return;
		const name = typeDeclName(run, kwIndex) ?? "?";
		const parent = scopeName();
		const qualified = parent.length > 0 ? `${parent}.${name}` : name;
		members.push({
			key: `type:${qualified}`,
			kind: "type",
			typeKey: parent,
			span: [lines[runStart], lines[endIndex]],
			semantic: semantic(runStart, endIndex),
		});
	};

	for (let index = 0; index < tokens.length; index++) {
		const part = tokens[index];
		if (part === "(") parenDepth++;
		else if (part === ")") parenDepth--;
		else if (part === "[") bracketDepth++;
		else if (part === "]") bracketDepth--;
		else if (parenDepth === 0 && bracketDepth === 0) {
			if (part === "{") {
				// The run before `{` decides what the body opens: a type decl,
				// a namespace block or a member body (property/method/ctor).
				const run = tokens.slice(runStart, index);
				const kwIndex = typeDeclIndex(run);
				if (kwIndex !== -1) {
					emitTypeEntry(index);
					const name = typeDeclName(run, kwIndex) ?? "?";
					const parent = scopeName();
					contexts.push({
						kind: "type",
						name: parent.length > 0 ? `${parent}.${name}` : name,
					});
					lastClosed = undefined;
				} else if (firstReal(run) === "namespace") {
					const nameIndex = run.findIndex((part) => !part.startsWith("#")) + 1;
					const name = run
						.slice(nameIndex)
						.filter((part) => isIdentChar(part[0]) || part === ".")
						.join("");
					const parent = scopeName();
					contexts.push({
						kind: "namespace",
						name: parent.length > 0 ? `${parent}.${name}` : name,
					});
					lastClosed = undefined;
				} else if (atDeclSurface()) {
					// Member with a body — the body's `}` finalizes its span.
					// `= new X() { …init… }` trails a closed member: the `{`
					// run is the initializer continuation, so it re-extends
					// `lastClosed` rather than starting a phantom member.
					const pending =
						firstReal(run) === "=" && lastClosed !== undefined
							? lastClosed
							: (emitMember(index, index) ?? undefined);
					contexts.push({ kind: "body", name: "", ...(pending !== undefined ? { pending } : {}) });
					if (pending === undefined) lastClosed = undefined;
				} else {
					contexts.push({ kind: "body", name: "" });
				}
				runStart = index + 1;
			} else if (part === "}") {
				const closing = contexts.pop();
				if (closing?.pending !== undefined) {
					const pending = closing.pending;
					pending.member.span = [pending.member.span[0], lines[index]];
					pending.member.semantic = semantic(pending.startIndex, index + 1);
					pending.member.tokenRange = [pending.startIndex, index + 1];
					// `T Prop { get; } = expr;` — the initializer trails the
					// body; the `;` run below re-attaches it to this member.
					lastClosed = pending;
				} else {
					lastClosed = undefined;
				}
				runStart = index + 1;
			} else if (part === ";" && atDeclSurface()) {
				const run = tokens.slice(runStart, index);
				const first = firstReal(run);
				if (first === "=" && lastClosed !== undefined) {
					// Post-body initializer (`Prop { … } = expr;`) — part of
					// the closed member's declaration, not a new member.
					lastClosed.member.span = [lastClosed.member.span[0], lines[index]];
					lastClosed.member.semantic = semantic(lastClosed.startIndex, index + 1);
					lastClosed.member.tokenRange = [lastClosed.startIndex, index + 1];
				} else if (first === "namespace" && contexts.length === 0) {
					// File-scoped namespace — prefixes every member below it.
					const nameIndex = run.findIndex((part) => !part.startsWith("#")) + 1;
					fileNamespace = run
						.slice(nameIndex)
						.filter((part) => isIdentChar(part[0]) || part === ".")
						.join("");
				} else if (typeDeclIndex(run) !== -1) {
					// `record R(int X);` — a type declaration without a body.
					emitTypeEntry(index);
				} else {
					lastClosed = emitMember(index, index) ?? undefined;
				}
				runStart = index + 1;
			} else if (part === ";") {
				runStart = index + 1;
			}
		}
	}
	return members;
}

/**
 * Declaration members of a C# source — `null` when the file is not C# or
 * cannot be lexed. Used by the exec-tree extractor (node → member spans)
 * and persisted on `SourceFingerprint.members` for member-level diffing.
 */
export function extractCSharpMembers(path: string, content: string): SourceMember[] | null {
	if (sourceKind(path) !== "csharp" || content.includes("\u0000")) return null;
	const normalized = content.replace(/\uFEFF/, "").replace(/\r\n?/g, "\n");
	const scanned = scanCFamily(normalized, {
		singleQuoteStrings: false,
		backtickStrings: false,
		hashDirectives: true,
		regexBailout: false,
	});
	if (scanned === null) return null;
	return extractMembers(scanned.tokens, scanned.lines);
}

/** `members` map value: combined digest so same-key `#if` twins stay one entry. */
function memberMapValue(members: SourceMember[]): Record<string, string> {
	const byKey = new Map<string, string[]>();
	for (const member of members) {
		byKey.get(member.key)?.push(member.semantic) ?? byKey.set(member.key, [member.semantic]);
	}
	const result: Record<string, string> = {};
	for (const [key, semantics] of byKey) {
		result[key] =
			semantics.length === 1 ? semantics[0] : sha256([...semantics].sort().join(""));
	}
	return result;
}

function fingerprintCSharp(text: string): SourceFingerprint | null {
	const scanned = scanCFamily(text, {
		singleQuoteStrings: false,
		backtickStrings: false,
		hashDirectives: true,
		regexBailout: false,
	});
	if (scanned === null) return null;
	const members = extractMembers(scanned.tokens, scanned.lines);
	// Every token outside a `member`-kind token range: directives, usings,
	// namespace/type declaration runs, file-scope leftovers. A change there
	// is invisible to the member diff, so the selector widens on it instead
	// of trusting member evidence alone.
	const inMember = new Array<boolean>(scanned.tokens.length).fill(false);
	for (const member of members) {
		if (member.kind !== "member" || member.tokenRange === undefined) continue;
		for (let i = member.tokenRange[0]; i < member.tokenRange[1]; i++) {
			inMember[i] = true;
		}
	}
	const nonMember = sha256(
		scanned.tokens.filter((_, index) => !inMember[index]).join(""),
	);
	return {
		version: FINGERPRINT_VERSION,
		semantic: sha256(scanned.tokens.join("")),
		declarations: extractDeclarations(scanned.tokens),
		members: memberMapValue(members),
		nonMember,
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
