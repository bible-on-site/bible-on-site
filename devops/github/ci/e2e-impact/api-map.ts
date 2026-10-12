/**
 * Static API endpoint→source attribution for the `api-e2e` suite (#2085).
 *
 * Rust `cargo llvm-cov` coverage is suite-level — the API process is shared
 * by every test and no per-test dump protocol exists — so instead of runtime
 * coverage the collector attributes tests statically: the GraphQL
 * operations and REST paths exercised by a test file resolve to resolver /
 * handler source files, and a `use`-graph closure over `web/api` Rust
 * sources widens each test to the files those files can reach.
 *
 * Conservative over-approximation by construction:
 * - `use` trees expand recursively (`a::b::{C, d::E}`) and each head edges
 *   to its longest resolvable module prefix — the item's real module;
 *   intermediate index modules are compile-time plumbing, not runtime
 *   evidence. `mod child;` declarations edge parent → child module file so
 *   `child::fn()` path calls (invisible to `use`) still attribute.
 * - `self`/`super`/`crate`/`entities` prefixes resolve against the
 *   containing module, including inline `mod` scopes.
 * - Router/dispatch files (`startup/app.rs`, `startup/schema_builder.rs`)
 *   land in `sharedFiles`, not per-test evidence — a change to the wiring
 *   every request flows through selects the whole suite.
 * - Anything missed entirely still resolves in-scope → select-all in the
 *   selector; under-attribution can only over-select, never skip.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globMatcher } from "./glob.ts";
import { listFiles } from "./xunit-discovery.ts";

export interface ApiSourceMap {
	/** All repo-relative Rust files scanned (sorted). */
	files: string[];
	/** Repo-relative file → files it `use`s inside the repo (sorted). */
	deps: Record<string, string[]>;
	/** GraphQL operation name (camelCase) → declaring resolver file. */
	operations: Record<string, string>;
	/**
	 * GraphQL field name (any selection depth, incl. DTO `ComplexObject`
	 * computed fields and `SimpleObject` members) → every file defining it.
	 * Nested selections widen a test's attribution through this map.
	 */
	fields: Record<string, string[]>;
	/** Route path (e.g. `/health`) → files serving it (registrar + handler). */
	routes: Record<string, string[]>;
}

const MOD_DECL = /\b(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g;
const INLINE_MOD = /\b(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{/g;
const USE_STMT = /\buse\s+([^;]+);/g;
// `#[Object]` covers query/mutation resolvers; `#[ComplexObject]` and
// `#[Interface]` impls declare computed fields on DTOs — both attribute.
const OBJECT_IMPL =
	/#\[\s*(?:Object|ComplexObject|Interface)[^\]]*\]\s*(?:pub\s+)?impl\b/g;
const SIMPLE_OBJECT =
	/#\[\s*derive\([^)]*SimpleObject[^)]*\)\s*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?struct\s+\w+\s*\{/g;
const STRUCT_FIELD = /\bpub\s+(\w+)\s*:/g;
const FN_NAME = /\b(?:async\s+)?fn\s+(\w+)/g;
const GRAPHQL_RENAME = /#\[\s*graphql\([^)]*name\s*=\s*"([^"]+)"[^)]*\)\s*\]/g;
const RESOURCE = /resource\(\s*"([^"]+)"\s*\)/g;
const TO_HANDLER = /\.to\(\s*(\w+)/g;

/** Removes `//` and `/* *\/` comments, preserving length and line structure. */
export function stripRustComments(source: string): string {
	const out = source.split("");
	let i = 0;
	while (i < out.length) {
		if (source[i] === "/" && source[i + 1] === "/") {
			let j = i;
			while (j < out.length && source[j] !== "\n") {
				out[j] = " ";
				j++;
			}
			i = j;
			continue;
		}
		if (source[i] === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? out.length : end + 2;
			for (let j = i; j < stop; j++) {
				if (out[j] !== "\n") out[j] = " ";
			}
			i = stop;
			continue;
		}
		// String literals may hold `//`/`/*` — skip them so comment markers
		// inside strings cannot blank real code.
		if (source[i] === '"') {
			let j = i + 1;
			while (j < out.length && source[j] !== '"') {
				if (source[j] === "\\") j++;
				j++;
			}
			i = j + 1;
			continue;
		}
		// Raw strings r#"..."# (and deeper): scan to the matching `"#`.
		if (source[i] === "r" && source[i + 1] === '"') {
			const end = source.indexOf('"#', i + 2);
			i = end === -1 ? out.length : end + 2;
			continue;
		}
		i++;
	}
	return out.join("");
}

const snakeToCamel = (name: string): string =>
	name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

interface ParsedFile {
	path: string;
	/** Module path segments, e.g. `["resolvers","articles_resolver"]`. */
	modulePath: string[];
	text: string;
}

/**
 * Builds the module tree: `src/main.rs`/`src/lib.rs` is the crate root,
 * `a/b.rs` is `a::b`, `a/b/mod.rs` is `a::b`... wait — `a/mod.rs` is `a`
 * and `a/b.rs` is `a::b`. Child `mod c` declarations resolve against the
 * declaring file's directory layout.
 */
function modulePathOf(rel: string): string[] {
	const segments = rel.replace(/\.rs$/, "").split("/");
	const last = segments[segments.length - 1];
	if (last === "mod" || last === "main" || last === "lib") segments.pop();
	return segments;
}

/** Directory a `mod c;` inside `rel` resolves children under (module-relative). */
function moduleDirOf(rel: string): string {
	const parts = rel.split("/");
	const last = parts[parts.length - 1];
	if (last === "mod.rs" || last === "main.rs" || last === "lib.rs") {
		return parts.slice(0, -1).join("/");
	}
	return [...parts.slice(0, -1), last.replace(/\.rs$/, "")].join("/");
}

/** Splits a `use`-tree body on top-level commas; nested `{...}` stay whole. */
function splitUseItems(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of body) {
		if (ch === "{") depth++;
		else if (ch === "}") depth--;
		if (ch === "," && depth === 0) {
			parts.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	if (cur.trim() !== "") parts.push(cur);
	return parts;
}

/**
 * Expands one `use` path tree into flat paths recursively:
 * `crate::a::{b::{C, d::E}, f}` →
 * [`crate::a::b::C`, `crate::a::b::d::E`, `crate::a::f`].
 * `self` resolves to the prefix itself, `*` and `as`-aliases are carried
 * through for the caller to normalize.
 */
function expandUseTree(path: string): string[] {
	const brace = path.indexOf("{");
	if (brace === -1) return [path.trim()];
	const close = path.lastIndexOf("}");
	const prefix = path
		.slice(0, brace)
		.replace(/::\s*$/, "")
		.trim();
	const inner = path.slice(brace + 1, close === -1 ? undefined : close);
	const results: string[] = [];
	for (const item of splitUseItems(inner)) {
		for (const flat of expandUseTree(item)) {
			if (flat === "") continue;
			// `use a::b::{self}` refers to `a::b` itself.
			if (flat === "self") {
				if (prefix !== "") results.push(prefix);
				continue;
			}
			results.push(prefix === "" ? flat : `${prefix}::${flat}`);
		}
	}
	return results;
}

/** Finds `mod name { … }` bodies (inline modules) with brace-matched ends. */
function inlineModRanges(
	text: string,
): { name: string; start: number; end: number }[] {
	const ranges: { name: string; start: number; end: number }[] = [];
	for (const match of text.matchAll(INLINE_MOD)) {
		const open = match.index + match[0].length - 1;
		let depth = 1;
		let end = open + 1;
		while (end < text.length && depth > 0) {
			if (text[end] === "{") depth++;
			else if (text[end] === "}") depth--;
			end++;
		}
		if (depth === 0) ranges.push({ name: match[1], start: open, end });
	}
	return ranges;
}

/**
 * Resolves one `use` path into candidate module paths, one per expanded
 * head — e.g. `crate::a::b::{C, d::E}` → `a::b::C` and `a::b::d::E`. The
 * last segment is usually an *item*, not a module, so the caller tries the
 * longest resolvable prefix (`a::b::C` → `a::b`). Intermediate prefixes are
 * intentionally NOT mapped: `use crate::services::article_service::X` has no
 * behavioral dependency on `services/mod.rs` itself, and edging to every
 * ancestor would hub-widen each test to all sibling modules through the
 * index file's `mod` declarations.
 * `entities::x` paths resolve inside the entities crate, everything outside
 * `crate`/`entities`/`self`/`super` is an external dependency — no repo
 * file to map.
 */
function usePathModules(
	usePath: string,
	current: string[],
): { crate: string; segments: string[] }[] {
	const heads = expandUseTree(usePath)
		.map((head) => head.replace(/\s+as\s+\w+$/, "").replace(/::\s*\*.*$/, ""))
		.filter((head) => head !== "" && head !== "*");
	const results: { crate: string; segments: string[] }[] = [];
	for (const head of heads) {
		let crate = "";
		let segments = head.split("::").map((s) => s.trim()).filter(Boolean);
		if (segments[0] === "crate") {
			// Inside the entities subcrate `crate::` means entities itself.
			if (current[0] === "entities") crate = "entities";
			segments = segments.slice(1);
		} else if (segments[0] === "self") {
			segments = [...current, ...segments.slice(1)];
		} else if (segments[0] === "super") {
			let up = 0;
			while (segments[up] === "super") up++;
			const base = current.slice(0, Math.max(0, current.length - up));
			segments = [...base, ...segments.slice(up)];
		} else if (segments[0] === "entities") {
			crate = "entities";
			segments = segments.slice(1);
		} else {
			// External crate (actix_web, sea_orm, entities via `use entities::`
			// covered above) or local shorthand — nothing repo-mapped unless it
			// names a top module of this crate.
			if (segments[0] === "common" || segments[0] === "dtos" || segments[0] === "providers" || segments[0] === "resolvers" || segments[0] === "services" || segments[0] === "startup") {
				// `use services::x` without `crate::` still resolves.
			} else {
				continue;
			}
		}
		if (segments.length > 0) results.push({ crate, segments });
	}
	return results;
}

/**
 * Builds the static map over the API crate and its entities subcrate.
 * `apiRoot` is the absolute `web/api` directory; `apiRel` its repo-relative
 * path (`web/api`) — map keys are repo-relative.
 */
export function buildApiSourceMap(apiRoot: string, apiRel = "web/api"): ApiSourceMap {
	const fileSet = new Map<string, string>(); // repo-relative → abs
	const crateFiles: { crate: string; dir: string }[] = [
		{ crate: "", dir: join(apiRoot, "src") },
		{ crate: "entities", dir: join(apiRoot, "entities", "src") },
	];
	for (const { crate, dir } of crateFiles) {
		if (!existsSync(dir)) continue;
		for (const abs of listFiles(dir, "**/*.rs")) {
			const rel = abs
				.replace(/\\/g, "/")
				.slice(dir.replace(/\\/g, "/").length + 1);
			const repo =
				crate === ""
					? `${apiRel}/src/${rel}`
					: `${apiRel}/entities/src/${rel}`;
			fileSet.set(repo, abs);
		}
	}

	const files = [...fileSet.keys()].sort();
	const parsed = new Map<string, ParsedFile>();
	const moduleToFile = new Map<string, string>();
	// First pass: parse texts and register module paths.
	for (const [repo, abs] of fileSet) {
		const text = stripRustComments(readFileSync(abs, "utf8"));
		const entitiesPrefix = `${apiRel}/entities/src/`;
		const srcPrefix = `${apiRel}/src/`;
		const inEntities = repo.startsWith(entitiesPrefix);
		const rel = inEntities
			? repo.slice(entitiesPrefix.length)
			: repo.slice(srcPrefix.length);
		const modulePath = [
			...(inEntities ? ["entities"] : []),
			...modulePathOf(rel),
		];
		parsed.set(repo, { path: repo, modulePath, text });
		moduleToFile.set(modulePath.join("::"), repo);
	}
	const deps: Record<string, string[]> = {};
	for (const file of parsed.values()) {
		const entitiesPrefix = `${apiRel}/entities/src/`;
		const srcPrefix = `${apiRel}/src/`;
		const inEntities = file.path.startsWith(entitiesPrefix);
		const rel = inEntities
			? file.path.slice(entitiesPrefix.length)
			: file.path.slice(srcPrefix.length);
		const childDir = moduleDirOf(rel);
		const baseDir = inEntities ? entitiesPrefix : srcPrefix;
		const edges = new Set<string>();
		// `use` inside an inline `mod tests { ... }` resolves `super`/`self`
		// against the nested module, not the file's own — without this,
		// `use super::*` in a test module edges the file to its parent index
		// module and hub-widens every sibling through its `mod` edges.
		const inlineMods = inlineModRanges(file.text);
		for (const match of file.text.matchAll(USE_STMT)) {
			const enclosing = inlineMods
				.filter((range) => range.start < match.index && match.index < range.end)
				.map((range) => range.name);
			const targets = usePathModules(match[1].trim(), [
				...file.modulePath,
				...enclosing,
			]);
			for (const target of targets) {
				// Longest resolvable prefix wins: the final segment is usually
				// an item (`::Type`), so `a::b::Type` edges to `a/b.rs`. Shorter
				// ancestors are compile-time plumbing, not runtime evidence.
				for (let k = target.segments.length; k >= 1; k--) {
					// Entities modules are keyed `entities::*`; `self`/`super`
					// paths inside them already carry the prefix in segments.
					const key =
						target.crate === "entities"
							? ["entities", ...target.segments.slice(0, k)].join("::")
							: target.segments.slice(0, k).join("::");
					const resolved = moduleToFile.get(key);
					if (resolved !== undefined) {
						if (resolved !== file.path) edges.add(resolved);
						break;
					}
				}
			}
		}
		// `mod name;` declares a child module — the file may never `use` it
		// (items are reached via `name::` paths), so it needs its own edge:
		// a change inside `article_search/lsa.rs` must select every test
		// whose closure reaches `article_search.rs`.
		for (const match of file.text.matchAll(MOD_DECL)) {
			const name = match[1];
			for (const candidate of [
				`${childDir}/${name}.rs`,
				`${childDir}/${name}/mod.rs`,
			]) {
				const repo = `${baseDir}${candidate}`;
				if (parsed.has(repo)) edges.add(repo);
			}
		}
		deps[file.path] = [...edges].sort();
	}

	// GraphQL operations: `#[Object]`/`#[ComplexObject]`/`#[Interface]` impl
	// methods (camelCased by async-graphql). `operations` records top-level
	// resolver roots; `fields` records every GraphQL field name → all files
	// defining it, so a nested selection like `authors { articlesCount }`
	// attributes the DTO impl that computes it — not just the root resolver.
	const operations: Record<string, string> = {};
	const fieldFiles = new Map<string, Set<string>>();
	const addField = (name: string, file: string) => {
		const owners = fieldFiles.get(name) ?? new Set<string>();
		owners.add(file);
		fieldFiles.set(name, owners);
	};
	const nearestName = (body: string, at: number, fallback: string): string => {
		// `#[graphql(name = "…")]` renames take precedence over camelCase.
		// The attribute must sit between the previous member boundary and this
		// item — an unbounded lookback could adopt a neighbor's rename.
		const boundary =
			Math.max(
				body.lastIndexOf(",", at),
				body.lastIndexOf(";", at),
				body.lastIndexOf("}", at),
				body.lastIndexOf("{", at),
			) + 1;
		const renames = [...body.slice(boundary, at).matchAll(GRAPHQL_RENAME)];
		return renames.length > 0 ? renames[renames.length - 1][1] : fallback;
	};
	for (const file of parsed.values()) {
		for (const implMatch of file.text.matchAll(OBJECT_IMPL)) {
			const start = implMatch.index + implMatch[0].length;
			const open = file.text.indexOf("{", start);
			if (open === -1) continue;
			let depth = 1;
			let end = open + 1;
			while (end < file.text.length && depth > 0) {
				if (file.text[end] === "{") depth++;
				else if (file.text[end] === "}") depth--;
				end++;
			}
			const body = file.text.slice(open + 1, end - 1);
			for (const fn of body.matchAll(FN_NAME)) {
				const name = nearestName(body, fn.index, snakeToCamel(fn[1]));
				operations[name] = file.path;
				addField(name, file.path);
			}
		}
		// `#[derive(SimpleObject)]` struct members are GraphQL fields too —
		// selecting `title` executes code generated from the declaring DTO.
		for (const structMatch of file.text.matchAll(SIMPLE_OBJECT)) {
			const start = structMatch.index + structMatch[0].length - 1;
			let depth = 1;
			let end = start + 1;
			while (end < file.text.length && depth > 0) {
				if (file.text[end] === "{") depth++;
				else if (file.text[end] === "}") depth--;
				end++;
			}
			const body = file.text.slice(start + 1, end - 1);
			for (const member of body.matchAll(STRUCT_FIELD)) {
				addField(
					nearestName(body, member.index, snakeToCamel(member[1])),
					file.path,
				);
			}
		}
	}

	// Routes: `web::resource("PATH")` + `.to(handler)` — registrar file plus
	// the file defining `fn handler`.
	const fnOwner = new Map<string, string>();
	for (const file of parsed.values()) {
		for (const fn of file.text.matchAll(FN_NAME)) {
			if (!fnOwner.has(fn[1])) fnOwner.set(fn[1], file.path);
		}
	}
	const routes: Record<string, string[]> = {};
	for (const file of parsed.values()) {
		for (const res of file.text.matchAll(RESOURCE)) {
			const path = res[1];
			const owners = new Set<string>([file.path]);
			const window = file.text.slice(res.index, res.index + 400);
			const handler = TO_HANDLER.exec(window)?.[1];
			if (handler !== undefined) {
				const owner = fnOwner.get(handler);
				if (owner !== undefined) owners.add(owner);
			}
			routes[path] = [...(routes[path] ?? []), ...owners].sort();
		}
	}
	for (const key of Object.keys(routes)) {
		routes[key] = [...new Set(routes[key])].sort();
	}

	return {
		files,
		deps: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
		operations: Object.fromEntries(
			Object.entries(operations).sort(([a], [b]) => a.localeCompare(b)),
		),
		fields: Object.fromEntries(
			[...fieldFiles.entries()]
				.map(([name, owners]) => [name, [...owners].sort()] as const)
				.sort(([a], [b]) => a.localeCompare(b)),
		),
		routes: Object.fromEntries(
			Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)),
		),
	};
}

/** Depth-bounded transitive closure of `deps` from `roots` (roots included). */
export function depsClosure(
	deps: Record<string, string[]>,
	roots: string[],
): string[] {
	const seen = new Set<string>();
	const stack = [...roots];
	while (stack.length > 0) {
		const file = stack.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const dep of deps[file] ?? []) {
			if (!seen.has(dep)) stack.push(dep);
		}
	}
	return [...seen].sort();
}

/**
 * Extracts top-level field names from a GraphQL operation string: the
 * depth-1 selection set of `{`, `query X(...) {` or `mutation {`. Aliases
 * and field args are over-collected (safe — the map lookup ignores unknown
 * names and reports them as unmapped evidence).
 */
export function graphqlTopLevelFields(query: string): string[] {
	// Find the first `{` outside parens/strings — the selection-set opener.
	let depth = 0;
	let start = -1;
	let i = 0;
	while (i < query.length) {
		const ch = query[i];
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < query.length && query[j] !== ch) {
				if (query[j] === "\\") j++;
				j++;
			}
			i = j + 1;
			continue;
		}
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "{" && depth === 0) {
			start = i;
			break;
		}
		i++;
	}
	if (start === -1) return [];
	const fields = new Set<string>();
	depth = 1;
	let parens = 0;
	let ident = "";
	// A field name flushing at depth 1 outside argument parens is top-level
	// (aliases included — over-collection is the conservative direction).
	const flush = () => {
		if (
			ident !== "" &&
			depth === 1 &&
			parens === 0 &&
			ident !== "fragment" &&
			ident !== "on" &&
			ident !== "__typename"
		) {
			fields.add(ident);
		}
		ident = "";
	};
	for (i = start + 1; i < query.length && depth > 0; i++) {
		const ch = query[i];
		// Escape sequences inside the literal (`\n`, `\"`) are two source
		// characters but one query character — never an identifier.
		if (ch === "\\") {
			flush();
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			// String arguments never contribute field names.
			flush();
			let j = i + 1;
			while (j < query.length && query[j] !== ch) {
				if (query[j] === "\\") j++;
				j++;
			}
			i = j;
			continue;
		}
		if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_") {
			ident += ch;
			continue;
		}
		flush();
		if (ch === "(") parens++;
		else if (ch === ")") parens = Math.max(0, parens - 1);
		else if (parens === 0 && ch === "{") depth++;
		else if (ch === "}") {
			// Input-object braces inside parens do not move the selection
			// depth; a closing `}` at parens>0 belongs to one.
			if (parens === 0) depth--;
		}
	}
	return [...fields];
}

/**
 * Extracts field names at every selection depth — the nested counterpart of
 * `graphqlTopLevelFields`. Nested names attribute DTO/computed-field impls
 * (e.g. `authors { articlesCount }` → the `ComplexObject` file); argument
 * parens, strings, aliases and directives (`@include`) never count.
 */
export function graphqlAllFields(query: string): string[] {
	let depth = 0;
	let parens = 0;
	let ident = "";
	let prevNonSpace = "";
	let sawBrace = false;
	const fields = new Set<string>();
	const flush = (ch: string) => {
		if (
			ident !== "" &&
			depth > 0 &&
			parens === 0 &&
			// `...Fragment`/`fragment X`/`on T` keywords and `@directive` names
			// are not fields.
			prevNonSpace !== "@" &&
			ident !== "fragment" &&
			ident !== "on" &&
			ident !== "__typename"
		) {
			fields.add(ident);
		}
		ident = "";
		prevNonSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" ? prevNonSpace : ch;
	};
	for (let i = 0; i < query.length; i++) {
		const ch = query[i];
		if (ch === "\\") {
			flush(ch);
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			// String arguments/enum literals never contribute field names.
			flush(ch);
			let j = i + 1;
			while (j < query.length && query[j] !== ch) {
				if (query[j] === "\\") j++;
				j++;
			}
			i = j;
			continue;
		}
		if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_") {
			ident += ch;
			continue;
		}
		flush(ch);
		if (ch === "(") parens++;
		else if (ch === ")") parens = Math.max(0, parens - 1);
		else if (parens === 0 && ch === "{") {
			depth++;
			sawBrace = true;
		} else if (ch === "}") {
			// Input-object braces inside parens do not move the selection
			// depth; a closing `}` at parens>0 belongs to one.
			if (parens === 0) depth--;
		}
	}
	// `query X` documents without a selection set yield nothing.
	return sawBrace ? [...fields] : [];
}

/** All GraphQL field names a test file issues, at any selection depth. */
export function graphqlAllFieldsInSource(source: string): string[] {
	const names = new Set<string>();
	for (const match of source.matchAll(
		/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`/g,
	)) {
		const doc = match[1] ?? match[2] ?? match[3] ?? "";
		if (!/^\s*(query\b|mutation\b|subscription\b|\{)/.test(doc)) continue;
		for (const field of graphqlAllFields(doc)) names.add(field);
	}
	return [...names];
}

/** REST paths a test file addresses: `["'`]/path["'`]` literals. */
export function restPaths(source: string): string[] {
	const paths = new Set<string>();
	for (const match of source.matchAll(/["'`](\/[A-Za-z0-9_\-/]*)["'`]/g)) {
		if (match[1].startsWith("//")) continue;
		paths.add(match[1].replace(/\/+$/, "") || "/");
	}
	return [...paths];
}

/**
 * GraphQL operation names a test file issues: top-level fields of every
 * embedded document literal. Tests pass docs both as `query:` payload
 * properties and as bare helper arguments, so every string/backtick
 * literal whose content opens like a GraphQL document (`{`, `query`,
 * `mutation`, `subscription`) is scanned.
 */
export function graphqlOperationsInSource(source: string): string[] {
	const ops = new Set<string>();
	for (const match of source.matchAll(
		/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`/g,
	)) {
		const doc = match[1] ?? match[2] ?? match[3] ?? "";
		if (!/^\s*(query\b|mutation\b|subscription\b|\{)/.test(doc)) continue;
		for (const field of graphqlTopLevelFields(doc)) ops.add(field);
	}
	return [...ops];
}

export const API_GLOBS = ["src/**/*.rs", "entities/src/**/*.rs"];

export function apiSourceMatcher(): (path: string) => boolean {
	return globMatcher(API_GLOBS);
}
