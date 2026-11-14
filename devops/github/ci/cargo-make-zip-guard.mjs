#!/usr/bin/env node
/**
 * cargo-make ZIP ingestion gate — https://github.com/bible-on-site/bible-on-site/issues/2826
 *
 * The pinned cargo-make CLI embeds duckscriptsdk with a nonoptional
 * `zip ^2` dependency. Every zip release through 9.0.4 is affected by
 * GHSA-m665-v7pm-7grj (ZipArchive/ZipStreamReader dual-header parser
 * differential); the latest supported cargo-make/SDK releases still carry
 * the affected dependency and no compatible upgrade is published. The SDK's
 * `unzip` command uses ZipArchive + extract() consistently — not the
 * advisory's mixed-reader ingestion flow — so the live exposure is a
 * repository-defined task that starts ingesting untrusted archives through
 * the embedded duckscript SDK, not the CLI's mere presence.
 *
 * This gate keeps that exposure tracked and blocked on every run:
 *
 *   1. Pins — every `cargo-make@X.Y.Z` install site under .github/workflows
 *      must agree on a single version, so the compatibility assessment
 *      always applies to exactly one supported release.
 *   2. Renovate — renovate.json must keep the cargo-make custom regex
 *      manager (pin discovery) and the automerge:false package rule
 *      (manual review for regular updates) that route upgrades through
 *      the issue's compatibility check.
 *   3. Rust graphs — no Cargo.toml may declare cargo-make again; the CLI is
 *      installed by CI, not resolved as a crate dependency (removed in
 *      #2828 because it dragged duckscriptsdk -> zip into the lockfile).
 *   4. Archive tasks — every Makefile.toml task script that runs as
 *      duckscript (the default engine) is scanned for the SDK archive
 *      commands: the `unzip`/`zip` aliases and their `*::*zip` namespaced
 *      forms, including names rebound via `alias`. A task that ingests
 *      archives must carry an entry in
 *      devops/github/ci/cargo-make-archive-allowlist.json — that entry IS
 *      the recorded "assess that exact ingestion path" the issue requires.
 *
 * Script-engine attribution: `script` runs as duckscript unless the task
 * sets a non-duckscript `script_runner` (@shell, python, ...); `condition`
 * scripts, env `{ script = ... }` values and `*.ds` file scripts are always
 * duckscript. External `command = "unzip"` spawns the system binary — a
 * different tool, outside this gate's scope. Dynamic command names
 * (`${VAR}` dispatch) cannot be resolved statically — a known boundary.
 *
 * Run: `node devops/github/ci/cargo-make-zip-guard.mjs` — audit mode,
 * wired as the `cargo-make-zip-guard` pre-commit hook and a
 * cross_module_ci step. Exit code 1 on any finding.
 * CARGO_MAKE_ZIP_GUARD_ROOT overrides the repo root — unit tests build a
 * fixture tree in a temp dir instead of scanning the real repository.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ISSUE_URL = "https://github.com/bible-on-site/bible-on-site/issues/2826";
export const ALLOWLIST_REL = "devops/github/ci/cargo-make-archive-allowlist.json";
const ENV_TASK = "(env)";
const DUCKSCRIPT_RUNNER = "duckscript";

// ---------------------------------------------------------------------------
// Minimal TOML structure reader — not a spec parser. It emits section
// headers and key = value pairs with correct comment/string/inline-table/
// array handling, which is all the makefile semantics below need.
// ---------------------------------------------------------------------------

const KEY_PART_RE = /^(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')$/;

function unquoteKey(part) {
	const t = part.trim();
	if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0])
		return t.slice(1, -1);
	return t;
}

/** True when index i is the first non-ws character of its line. */
function atLineStart(text, i) {
	for (let j = i - 1; j >= 0 && text[j] !== "\n"; j -= 1)
		if (text[j] !== " " && text[j] !== "\t" && text[j] !== "\r") return false;
	return true;
}

/**
 * Scan a TOML value starting at `pos` (first non-ws char of the value).
 * Returns { kind, raw, end }: 'string' | 'table' | 'array' | 'scalar',
 * raw spans the whole value (quotes/brackets kept), end is the offset
 * after it. Throws on unterminated constructs.
 */
function scanTomlValue(text, pos) {
	const open = text[pos];
	if (open === '"' || open === "'") {
		if (text.slice(pos, pos + 3) === open.repeat(3)) {
			const closer = open.repeat(3);
			for (let i = pos + 3; i < text.length; i += 1) {
				if (!text.startsWith(closer, i)) continue;
				// In basic multiline strings an odd backslash run before the
				// closer escapes the first quote — the string continues.
				let backslashes = 0;
				for (let j = i - 1; j >= 0 && text[j] === "\\"; j -= 1) backslashes += 1;
				if (open === "'" || backslashes % 2 === 0)
					return { kind: "string", raw: text.slice(pos, i + 3), end: i + 3 };
			}
			throw new Error(`unterminated multiline string at offset ${pos}`);
		}
		for (let i = pos + 1; i < text.length && text[i] !== "\n"; i += 1) {
			if (open === '"' && text[i] === "\\") {
				i += 1;
				continue;
			}
			if (text[i] === open) return { kind: "string", raw: text.slice(pos, i + 1), end: i + 1 };
		}
		throw new Error(`unterminated string at offset ${pos}`);
	}
	if (open === "{" || open === "[") {
		const stack = [open];
		const match = { "{": "}", "[": "]", "}": "{", "]": "[" };
		for (let i = pos + 1; i < text.length; i += 1) {
			const c = text[i];
			if (c === '"' || c === "'") {
				i = scanTomlValue(text, i).end - 1;
				continue;
			}
			if (c === "#") {
				while (i < text.length && text[i] !== "\n") i += 1;
				continue;
			}
			if (c === "{" || c === "[") stack.push(c);
			else if (c === "}" || c === "]") {
				if (stack.pop() !== match[c]) throw new Error(`mismatched '${c}' at offset ${i}`);
				if (stack.length === 0)
					return { kind: open === "{" ? "table" : "array", raw: text.slice(pos, i + 1), end: i + 1 };
			}
		}
		throw new Error(`unterminated ${open === "{" ? "inline table" : "array"} at offset ${pos}`);
	}
	let i = pos;
	while (i < text.length && text[i] !== "\n" && text[i] !== "#") i += 1;
	return { kind: "scalar", raw: text.slice(pos, i).trimEnd(), end: i };
}

/**
 * Walk TOML text once; emit {type:'section', name, line} and
 * {type:'kv', section, keyPath, kind, raw, line} events in order.
 */
export function parseTomlStructure(text) {
	const events = [];
	let section = "";
	let pos = 0;
	let line = 1;
	while (pos < text.length) {
		const c = text[pos];
		if (c === "\n") {
			line += 1;
			pos += 1;
			continue;
		}
		if (c === " " || c === "\t" || c === "\r") {
			pos += 1;
			continue;
		}
		if (c === "#") {
			while (pos < text.length && text[pos] !== "\n") pos += 1;
			continue;
		}
		if (c === "[" && atLineStart(text, pos)) {
			const arrayForm = text[pos + 1] === "[";
			const close = arrayForm ? "]]" : "]";
			const end = text.indexOf(close, pos);
			if (end === -1 || text.slice(pos, end).includes("\n"))
				throw new Error(`unterminated table header on line ${line}`);
			section = text.slice(pos + (arrayForm ? 2 : 1), end).trim();
			events.push({ type: "section", name: section, line });
			pos = end + close.length;
			continue;
		}
		if (atLineStart(text, pos)) {
			let eq = pos;
			while (eq < text.length && text[eq] !== "=" && text[eq] !== "\n") {
				if (text[eq] === '"' || text[eq] === "'") {
					const closeQuote = text.indexOf(text[eq], eq + 1);
					if (closeQuote === -1) break;
					eq = closeQuote;
				}
				eq += 1;
			}
			if (eq >= text.length || text[eq] !== "=")
				throw new Error(`expected key = value on line ${line}`);
			const keyPath = text
				.slice(pos, eq)
				.split(".")
				.map(unquoteKey);
			if (!keyPath.every((k) => KEY_PART_RE.test(k) || k.length > 0))
				throw new Error(`invalid key on line ${line}`);
			let vpos = eq + 1;
			while (vpos < text.length && (text[vpos] === " " || text[vpos] === "\t")) vpos += 1;
			const value = scanTomlValue(text, vpos);
			events.push({ type: "kv", section, keyPath, kind: value.kind, raw: value.raw, line });
			line += (text.slice(pos, value.end).match(/\n/g) ?? []).length;
			pos = value.end;
			continue;
		}
		pos += 1;
	}
	return events;
}

/** Unwrap a TOML string literal (''', """, ' or ") to its content. */
function tomlStringContent(raw) {
	const t = raw.trim();
	for (const q of ["'''", '"""']) {
		if (t.startsWith(q) && t.endsWith(q) && t.length >= q.length * 2) {
			let content = t.slice(q.length, -q.length);
			if (content.startsWith("\r\n")) content = content.slice(2);
			else if (content.startsWith("\n")) content = content.slice(1);
			return content;
		}
	}
	const q = t[0];
	if ((q === '"' || q === "'") && t.length >= 2 && t.endsWith(q)) return t.slice(1, -1);
	throw new Error(`not a TOML string: ${t.slice(0, 40)}`);
}

/** Split an inline array [...] into element raws (strings/tables/scalars). */
function inlineArrayElements(raw) {
	const inner = raw.trim().slice(1, -1);
	const out = [];
	let pos = 0;
	while (pos < inner.length) {
		const c = inner[pos];
		if (c === "," || c === " " || c === "\t" || c === "\n" || c === "\r" || c === "#") {
			if (c === "#") while (pos < inner.length && inner[pos] !== "\n") pos += 1;
			pos += 1;
			continue;
		}
		const v = scanTomlValue(inner, pos);
		out.push(v);
		pos = v.end;
	}
	return out;
}

/**
 * Extract `key = <value>` fields out of an inline-table raw body ({...}).
 * Returns a map of key -> { kind, raw } (string raws keep their quotes).
 */
function inlineTableFields(rawTable) {
	const inner = rawTable.trim().slice(1, -1);
	const out = new Map();
	const keyRe = /([A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')\s*=\s*/g;
	let m;
	while ((m = keyRe.exec(inner)) !== null) {
		try {
			const value = scanTomlValue(inner, m.index + m[0].length);
			out.set(unquoteKey(m[1]), { kind: value.kind, raw: value.raw });
			keyRe.lastIndex = value.end;
		} catch {
			// A malformed inner value is the TOML linter's finding, not ours.
		}
	}
	return out;
}

const strField = (fields, name) =>
	fields.has(name) && fields.get(name).kind === "string"
		? tomlStringContent(fields.get(name).raw)
		: null;

/**
 * A cargo-make script body: a string literal or an array of string lines
 * (`script = ["cmd1", "cmd2"]` runs as one duckscript). Returns null for
 * anything else.
 */
function scriptContent(kind, raw) {
	if (kind === "string") return tomlStringContent(raw);
	if (kind !== "array") return null;
	const parts = [];
	for (const el of inlineArrayElements(raw)) {
		if (el.kind !== "string") return null;
		parts.push(tomlStringContent(el.raw));
	}
	return parts.join("\n");
}

/** scriptContent for a named field inside an inline table. */
const scriptField = (fields, name) =>
	fields.has(name) ? scriptContent(fields.get(name).kind, fields.get(name).raw) : null;

// ---------------------------------------------------------------------------
// Duckscript archive-command detection.
// ---------------------------------------------------------------------------

// SDK archive tokens: the lowercase `unzip`/`zip` aliases plus namespaced
// command names whose leaf is a zip-family word (0.11.1 registers
// fs::zip::{Unzip,Zip}; other releases may prefix differently, so any
// `*::*zip` leaf counts). Membership is checked with string ops — no
// nested-quantifier patterns on file content.
const isNamespacedZip = (token) => {
	const leaf = token.slice(token.lastIndexOf("::") + 2);
	return (
		token.includes("::") &&
		(leaf === "unzip" || leaf === "zip" || leaf === "Unzip" || leaf === "Zip")
	);
};
const isArchiveToken = (token) => token === "unzip" || token === "zip" || isNamespacedZip(token);
// `alias`/`unalias` are the aliases of the SDK's lib::alias::{Set,Unset}
// commands; the leaf names cover the namespaced spellings too.
const isAliasCommand = (token) =>
	token === "alias" || token.endsWith("::alias") || token.endsWith("::Alias") || token.endsWith("::Set");
const isUnaliasCommand = (token) =>
	token === "unalias" ||
	token.endsWith("::unalias") ||
	token.endsWith("::Unalias") ||
	token.endsWith("::Unset");
// Command-position candidates: a token at line start, after '=', ';', or a
// flow keyword whose argument is itself a command invocation — captured for
// a membership check rather than baked into a dynamic pattern. The keyword
// itself is excluded from the capture (`if unzip a b` flags `unzip`).
// Global: every candidate on the line is checked, so `a; unzip x y` and a
// second invocation after the first command cannot slip through.
const CALL_CANDIDATE_RE =
	/(?:^|[;=]|\b(?:if|elseif|elif|while|until|not|and|or|for|for_each|for_each_in|do|then|fn)\s+)\s*(?!(?:if|elseif|elif|while|until|not|and|or|for|for_each|for_each_in|do|then|fn)\b)([A-Za-z_][\w:]*)\b(?!\s*=)/g;

/** Blank out comments and "..." string contents, line by line. */
function maskDuckscript(script) {
	return script.split("\n").map((line) => {
		let out = "";
		for (let i = 0; i < line.length; i += 1) {
			const c = line[i];
			if (c === "#") break;
			if (c === '"') {
				out += " ";
				i += 1;
				while (i < line.length && line[i] !== '"') {
					out += " ";
					i += line[i] === "\\" ? 2 : 1;
					if (line[i - 1] === "\\") out += " ";
				}
				out += " ";
				continue;
			}
			out += c;
		}
		return out;
	});
}

/**
 * Return every archive-command invocation in duckscript source as
 * { command, line } (1-based). Detects names rebound through `alias`.
 */
export function findArchiveInvocations(script) {
	const masked = maskDuckscript(script);
	const aliases = new Set();
	// First collect `alias <name> <archive-command>` bindings so rebound
	// names cannot launder an SDK archive call past the gate; `unalias`
	// drops a binding.
	for (const code of masked) {
		for (const m of code.matchAll(CALL_CANDIDATE_RE)) {
			const [name, target] = code
				.slice(m.index + m[0].length)
				.trimStart()
				.split(/\s+/);
			if (isAliasCommand(m[1]) && name && target && isArchiveToken(target)) aliases.add(name);
			else if (isUnaliasCommand(m[1]) && name) aliases.delete(name);
		}
	}
	const isArchiveCommand = (token) => isArchiveToken(token) || aliases.has(token);
	const hits = [];
	masked.forEach((code, idx) => {
		for (const m of code.matchAll(CALL_CANDIDATE_RE))
			if (isArchiveCommand(m[1])) hits.push({ command: m[1], line: idx + 1 });
	});
	return hits;
}

// ---------------------------------------------------------------------------
// Makefile.toml semantics.
// ---------------------------------------------------------------------------

/**
 * Interpret a Makefile.toml into auditable duckscript sources:
 * { sources: [{task, script, line}], fileScripts: [{task, file, runner,
 *   extension, line}], extends: [{path, optional, line}], tasks: string[] }
 */
export function analyzeMakefile(text) {
	const sources = [];
	const fileScripts = [];
	const extendsDecl = [];
	const tasks = new Set();
	const taskRunners = new Map();
	const inlineScripts = new Map(); // task -> [{script, line}]
	const scriptTables = new Map(); // task -> merged script object
	const dottedScripts = new Map();

	const taskOf = (sectionName) => {
		const m = sectionName.match(/^tasks\.("[^"]*"|'[^']*'|[\w-]+)(?:\.|$)/);
		if (!m) return { task: null, sub: null };
		return { task: unquoteKey(m[1]), sub: sectionName.slice(m[0].length).replace(/^\./, "") };
	};
	const mergeScript = (map, task) => {
		if (!map.has(task))
			map.set(task, { task, file: null, absolutePath: null, runner: null, extension: null, line: 0 });
		return map.get(task);
	};

	for (const ev of parseTomlStructure(text)) {
		if (ev.type !== "kv") continue;
		const { section, keyPath, kind, raw, line } = ev;
		const key = keyPath[0];
		const { task, sub } = taskOf(section);

		// Root `extend` includes other makefiles; task-level `extend` is task
		// inheritance (a task name, not a path) and must not be resolved.
		if (section === "" && key === "extend" && keyPath.length === 1) {
			if (kind === "string")
				extendsDecl.push({ path: tomlStringContent(raw), optional: false, line });
			else if (kind === "table") {
				const fields = inlineTableFields(raw);
				if (strField(fields, "path"))
					extendsDecl.push({
						path: strField(fields, "path"),
						optional: fields.get("optional")?.raw.trim() === "true",
						line,
					});
			} else if (kind === "array") {
				for (const el of inlineArrayElements(raw)) {
					if (el.kind === "string")
						extendsDecl.push({ path: tomlStringContent(el.raw), optional: false, line });
					else if (el.kind === "table") {
						const fields = inlineTableFields(el.raw);
						if (strField(fields, "path"))
							extendsDecl.push({
								path: strField(fields, "path"),
								optional: fields.get("optional")?.raw.trim() === "true",
								line,
							});
					}
				}
			}
			continue;
		}

		if (task) tasks.add(task);

		// [env] / [tasks.X.env]: `VAR = { script = "..." }` env scripts are
		// always duckscript.
		if ((section === "env" || (task && sub === "env")) && kind === "table" && keyPath.length === 1) {
			const fields = inlineTableFields(raw);
			if (scriptField(fields, "script") !== null)
				sources.push({ task: task ?? ENV_TASK, script: scriptField(fields, "script"), line });
			continue;
		}
		// [tasks.X.script] table form and [tasks.X.condition] script.
		if (task && sub === "script" && keyPath.length === 1 && kind === "string") {
			const holder = mergeScript(scriptTables, task);
			if (!holder.line) holder.line = line;
			holder[key === "absolute_path" ? "absolutePath" : key] = tomlStringContent(raw);
			continue;
		}
		if (task && sub === "condition" && key === "script" && scriptContent(kind, raw) !== null) {
			sources.push({ task, script: scriptContent(kind, raw), line });
			continue;
		}
		if (!task || sub !== "") continue;

		if (key === "script") {
			if (keyPath.length === 1) {
				const body = scriptContent(kind, raw);
				if (body !== null) {
					const list = inlineScripts.get(task) ?? [];
					list.push({ script: body, line });
					inlineScripts.set(task, list);
				} else if (kind === "table") {
					const fields = inlineTableFields(raw);
					fileScripts.push({
						task,
						file: strField(fields, "file"),
						absolutePath: strField(fields, "absolute_path"),
						runner: strField(fields, "runner"),
						extension: strField(fields, "extension"),
						line,
					});
				}
			} else if (kind === "string") {
				// script.file / script.runner / ... dotted keys — one object per task.
				const holder = mergeScript(dottedScripts, task);
				if (!holder.line) holder.line = line;
				holder[keyPath[1] === "absolute_path" ? "absolutePath" : keyPath[1]] = tomlStringContent(raw);
			}
			continue;
		}
		if (key === "script_runner" && keyPath.length === 1 && kind === "string") {
			taskRunners.set(task, tomlStringContent(raw));
			continue;
		}
		if (key === "condition") {
			if (keyPath.length === 1 && kind === "table") {
				const fields = inlineTableFields(raw);
				if (scriptField(fields, "script") !== null)
					sources.push({ task, script: scriptField(fields, "script"), line });
			} else if (keyPath[1] === "script" && scriptContent(kind, raw) !== null) {
				sources.push({ task, script: scriptContent(kind, raw), line });
			}
			continue;
		}
		if (key === "condition_script" && keyPath.length === 1 && scriptContent(kind, raw) !== null) {
			sources.push({ task, script: scriptContent(kind, raw), line });
			continue;
		}
	}

	// An inline `script` runs as duckscript unless the task pinned a
	// non-duckscript script_runner. The same task-level runner applies to
	// file scripts: `script_runner = "@shell"` makes a `.ds` file execute
	// through the shell, not the SDK.
	for (const [task, list] of inlineScripts) {
		const runner = taskRunners.get(task);
		if (runner && runner !== DUCKSCRIPT_RUNNER) continue;
		for (const s of list) sources.push({ task, ...s });
	}
	fileScripts.push(...scriptTables.values(), ...dottedScripts.values());
	for (const fs of fileScripts) fs.runner ??= taskRunners.get(fs.task) ?? null;
	return { sources, fileScripts, extends: extendsDecl, tasks: [...tasks] };
}

// ---------------------------------------------------------------------------
// Guard checks.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "target", ".next", "dist", "build"]);

function walkFiles(root, filter) {
	const out = [];
	const stack = [root];
	while (stack.length) {
		const dir = stack.pop();
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) stack.push(p);
			} else if (entry.isFile() && filter(p)) out.push(p);
		}
	}
	return out;
}

const rel = (root, p) => relative(root, p).split("\\").join("/");

export function checkWorkflowPins(root) {
	const pinRe = /cargo-make@(\d+\.\d+\.\d+)/g;
	const byVersion = new Map();
	const findings = [];
	const workflowsDir = join(root, ".github", "workflows");
	if (existsSync(workflowsDir)) {
		for (const name of readdirSync(workflowsDir)) {
			if (!/\.ya?ml$/.test(name)) continue;
			const p = join(workflowsDir, name);
			readFileSync(p, "utf8")
				.split("\n")
				.forEach((text, idx) => {
					// `#` preceded by whitespace starts a YAML comment — a
					// historical pin version in a comment is documentation,
					// not an install site.
					const code = text.replace(/(^|\s)#.*$/, "");
					for (const m of code.matchAll(pinRe)) {
						const key = `${rel(root, p)}:${idx + 1}`;
						if (!byVersion.has(m[1])) byVersion.set(m[1], []);
						byVersion.get(m[1]).push(key);
					}
				});
		}
	}
	if (byVersion.size === 0)
		findings.push({
			check: "pins",
			message: `no cargo-make@X.Y.Z install pins found under .github/workflows — if the CLI was retired, retire this gate with it (${ISSUE_URL})`,
		});
	else if (byVersion.size > 1)
		findings.push({
			check: "pins",
			message:
				`cargo-make pins disagree — ${[...byVersion.entries()].map(([v, sites]) => `${v} at ${sites.join(", ")}`).join("; ")}. ` +
				`A single supported release keeps the ZIP-dependency assessment unambiguous (${ISSUE_URL})`,
		});
	return { findings, pinnedVersion: [...byVersion.keys()][0] ?? null };
}

export function checkRenovate(root) {
	const findings = [];
	const p = join(root, "renovate.json");
	if (!existsSync(p)) {
		findings.push({ check: "renovate", message: "renovate.json is missing" });
		return findings;
	}
	let config;
	try {
		config = JSON.parse(readFileSync(p, "utf8"));
	} catch (err) {
		findings.push({ check: "renovate", message: `renovate.json is not valid JSON: ${err.message}` });
		return findings;
	}
	const manager = (config.customManagers ?? []).find((m) =>
		(m.matchStrings ?? []).some((s) => s.includes("cargo-make@")),
	);
	if (!manager)
		findings.push({
			check: "renovate",
			message: `renovate.json lost the cargo-make custom regex manager — the CLI pin must stay discoverable for upgrade review (${ISSUE_URL})`,
		});
	const rule = (config.packageRules ?? []).find(
		(r) =>
			r.automerge === false &&
			(r.matchPackageNames ?? []).some(
				// Exact name or the /^cargo-make$/ regex spelling Renovate accepts.
				(n) => n === "cargo-make" || n === "/^cargo-make$/",
			),
	);
	if (!rule)
		findings.push({
			check: "renovate",
			message: `renovate.json lost the automerge:false cargo-make package rule — regular updates must stay manual while the ZIP gap is open (${ISSUE_URL})`,
		});
	return findings;
}

export function checkCargoGraphs(root) {
	const findings = [];
	for (const p of walkFiles(root, (f) => basename(f) === "Cargo.toml")) {
		readFileSync(p, "utf8")
			.split("\n")
			.forEach((text, idx) => {
				// `cargo-make` / `"cargo-make"` as a dependency key — string ops
				// only, so the check adds no regex-over-input surface.
				let t = text.trimStart();
				if (t[0] === '"' || t[0] === "'") t = t.slice(1);
				if (!t.startsWith("cargo-make")) return;
				let rest = t.slice("cargo-make".length).trimStart();
				if (rest[0] === '"' || rest[0] === "'") rest = rest.slice(1).trimStart();
				if (!rest.startsWith("=")) return;
				findings.push({
						check: "cargo-graphs",
						message: `${rel(root, p)}:${idx + 1} declares cargo-make — the CLI is installed via CI pins, not the Rust dependency graph (${ISSUE_URL})`,
					});
			});
	}
	return findings;
}

/**
 * Scan every Makefile.toml (plus `extend`-resolved includes) for SDK
 * archive commands in duckscript contexts. Returns { findings, scanned }.
 */
export function checkArchiveTasks(root, allowlist) {
	const findings = [];
	const scanned = [];
	const queue = walkFiles(root, (f) => basename(f) === "Makefile.toml");
	const visited = new Set();
	const covered = new Set();
	const allowed = Array.isArray(allowlist?.assessed) ? allowlist.assessed : [];

	while (queue.length) {
		const file = resolve(queue.pop());
		if (visited.has(file) || !existsSync(file)) continue;
		visited.add(file);
		scanned.push(rel(root, file));
		let analysis;
		try {
			analysis = analyzeMakefile(readFileSync(file, "utf8"));
		} catch (err) {
			findings.push({
				check: "archive-tasks",
				message: `${rel(root, file)} could not be audited (${err.message}) — an unparseable makefile must not hide an archive task`,
			});
			continue;
		}

		for (const ext of analysis.extends) {
			const target = resolve(dirname(file), ext.path);
			if (existsSync(target)) queue.push(target);
			else if (!ext.optional)
				findings.push({
					check: "archive-tasks",
					message: `${rel(root, file)}:${ext.line} extends missing makefile '${ext.path}' — an unresolved include hides its tasks from this audit (${ISSUE_URL})`,
				});
		}

		for (const fs of analysis.fileScripts) {
			const rawPath = fs.file ?? fs.absolutePath;
			if (!rawPath) continue;
			// Task-level script_runner already resolved into fs.runner.
			// An explicit `extension` overrides the filename for engine
			// selection; a non-.ds script without a duckscript runner is an
			// external process, not the SDK path.
			const ext = (fs.extension ?? (rawPath.includes(".") ? rawPath.split(".").pop() : null))
				?.toLowerCase();
			if (fs.runner && fs.runner !== DUCKSCRIPT_RUNNER) continue;
			if (!fs.runner && ext && ext !== "ds") continue;
			const target = isAbsolute(rawPath) ? rawPath : resolve(dirname(file), rawPath);
			if (!existsSync(target)) {
				findings.push({
					check: "archive-tasks",
					message: `${rel(root, file)}:${fs.line} task '${fs.task}' references missing duckscript file '${rawPath}' — its commands cannot be audited (${ISSUE_URL})`,
				});
				continue;
			}
			for (const hit of findArchiveInvocations(readFileSync(target, "utf8")))
				findings.push({
					check: "archive-tasks",
					makefile: rel(root, file),
					task: fs.task,
					message: `${rel(root, file)}:${fs.line} task '${fs.task}' duckscript file '${rel(root, target)}' invokes '${hit.command}' (line ${hit.line})`,
				});
		}

		for (const src of analysis.sources) {
			for (const hit of findArchiveInvocations(src.script))
				findings.push({
					check: "archive-tasks",
					makefile: rel(root, file),
					task: src.task,
					message: `${rel(root, file)}:${src.line} task '${src.task}' duckscript invokes '${hit.command}' (script line ${hit.line})`,
				});
		}
	}

	// Every archive-command finding needs an allowlist entry; every entry
	// must cover a current finding (stale entries and missing reasons fail).
	const unresolved = [];
	for (const f of findings) {
		if (f.check !== "archive-tasks" || !f.task) {
			unresolved.push(f);
			continue;
		}
		const idx = allowed.findIndex((a) => a.makefile === f.makefile && a.task === f.task);
		if (idx === -1)
			unresolved.push({
				...f,
				message: `${f.message} — SDK archive commands ingest through the affected zip dependency; record the ingestion-path assessment in ${ALLOWLIST_REL} or resolve ${ISSUE_URL} first`,
			});
		else covered.add(idx);
	}
	allowed.forEach((entry, idx) => {
		if (!entry.reason || !String(entry.reason).trim())
			unresolved.push({
				check: "archive-tasks",
				message: `${ALLOWLIST_REL} entry ${idx} (${entry.makefile ?? "?"} / ${entry.task ?? "?"}) needs a non-empty reason — the reason IS the ingestion-path assessment`,
			});
		else if (!covered.has(idx))
			unresolved.push({
				check: "archive-tasks",
				message: `${ALLOWLIST_REL} entry ${idx} is stale: ${entry.makefile} task '${entry.task}' invokes no SDK archive command — remove it or restore the assessment`,
			});
	});
	return { findings: unresolved, scanned };
}

export function loadAllowlist(root) {
	const p = join(root, ALLOWLIST_REL);
	if (!existsSync(p)) return { assessed: [] };
	const parsed = JSON.parse(readFileSync(p, "utf8"));
	return { assessed: Array.isArray(parsed?.assessed) ? parsed.assessed : [] };
}

/** Run every gate against the repository rooted at `root`. */
export function guardRepo(root) {
	const resolvedRoot = resolve(root);
	const pins = checkWorkflowPins(resolvedRoot);
	const archive = checkArchiveTasks(resolvedRoot, loadAllowlist(resolvedRoot));
	return {
		findings: [
			...pins.findings,
			...checkRenovate(resolvedRoot),
			...checkCargoGraphs(resolvedRoot),
			...archive.findings,
		],
		pinnedVersion: pins.pinnedVersion,
		scannedMakefiles: archive.scanned,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const root = process.env.CARGO_MAKE_ZIP_GUARD_ROOT ?? resolve(scriptDir, "..", "..", "..");
	const { findings, pinnedVersion, scannedMakefiles } = guardRepo(root);
	for (const f of findings) console.error(`[cargo-make-zip-guard] FAIL: ${f.message}`);
	if (findings.length) {
		console.error(`[cargo-make-zip-guard] ${findings.length} finding(s) — tracking: ${ISSUE_URL}`);
		process.exit(1);
	}
	console.log(
		`[cargo-make-zip-guard] OK — ${scannedMakefiles.length} makefile(s) free of SDK archive commands, ` +
			`pins agree on cargo-make@${pinnedVersion}, Renovate tracking intact, no Cargo.toml dependency`,
	);
}
