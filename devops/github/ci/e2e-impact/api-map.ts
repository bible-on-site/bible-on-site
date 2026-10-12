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
 * - `use` resolution maps every path prefix to its module file (an imported
 *   item need not be defined there — re-export chains add edges anyway).
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
	/** Route path (e.g. `/health`) → files serving it (registrar + handler). */
	routes: Record<string, string[]>;
}

const MOD_DECL = /\b(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g;
const USE_STMT = /\buse\s+([^;]+);/g;
const OBJECT_IMPL = /#\[\s*Object[^\]]*\]\s*(?:pub\s+)?impl\b/g;
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

/**
 * Resolves one `use` path into module paths (prefix-expanded), e.g.
 * `crate::a::b::{C, d::E}` → `a`, `a::b`, `a::b::C`, `a::b::d`, `a::b::d::E`.
 * `entities::x` paths resolve inside the entities crate (empty `crateRoot`
 * prefix `entities`), everything outside `crate`/`entities`/`self`/`super`
 * is an external dependency — no repo file to map.
 */
function usePathModules(
	usePath: string,
	current: string[],
): { crate: string; segments: string[] }[] {
	// Group expansion: `a::b::{c, d::E}` → [`a::b::c`, `a::b::d::E`].
	const brace = usePath.indexOf("{");
	let heads: string[];
	if (brace !== -1) {
		const close = usePath.lastIndexOf("}");
		const prefix = usePath.slice(0, brace).replace(/::\s*$/, "");
		const items = usePath
			.slice(brace + 1, close === -1 ? undefined : close)
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item.length > 0 && item !== "*");
		// `use a::b::{self}` refers to `a::b` itself.
		heads = items.map((item) =>
			item === "self" ? prefix : `${prefix}::${item.replace(/\s+as\s+\w+$/, "")}`,
		);
	} else {
		heads = [usePath.trim().replace(/\s+as\s+\w+$/, "").replace(/::\s*\*.*$/, "")];
	}
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
		for (let k = 1; k <= segments.length; k++) {
			results.push({ crate, segments: segments.slice(0, k) });
		}
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
	// Second pass: `mod` declarations register child module files.
	for (const file of parsed.values()) {
		const entitiesPrefix = `${apiRel}/entities/src/`;
		const srcPrefix = `${apiRel}/src/`;
		const inEntities = file.path.startsWith(entitiesPrefix);
		const rel = inEntities
			? file.path.slice(entitiesPrefix.length)
			: file.path.slice(srcPrefix.length);
		const dir = moduleDirOf(rel);
		const baseDir = inEntities ? entitiesPrefix : srcPrefix;
		for (const match of file.text.matchAll(MOD_DECL)) {
			const name = match[1];
			for (const candidate of [`${dir}/${name}.rs`, `${dir}/${name}/mod.rs`]) {
				const repo = `${baseDir}${candidate}`;
				if (parsed.has(repo)) {
					const child = parsed.get(repo);
					if (child !== undefined) {
						moduleToFile.set(child.modulePath.join("::"), repo);
					}
				}
			}
		}
	}

	const deps: Record<string, string[]> = {};
	for (const file of parsed.values()) {
		const edges = new Set<string>();
		for (const match of file.text.matchAll(USE_STMT)) {
			const targets = usePathModules(match[1].trim(), file.modulePath);
			for (const target of targets) {
				// Entities modules are keyed `entities::*`; `self`/`super`
				// paths inside them already carry the prefix in segments.
				const key =
					target.crate === "entities"
						? ["entities", ...target.segments].join("::")
						: target.segments.join("::");
				const resolved = moduleToFile.get(key);
				if (resolved !== undefined && resolved !== file.path) edges.add(resolved);
			}
		}
		deps[file.path] = [...edges].sort();
	}

	// GraphQL operations: `#[Object] impl` methods (camelCased by async-graphql).
	const operations: Record<string, string> = {};
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
				// `#[graphql(name = "…")]` renames take precedence over camelCase.
				const before = body.slice(Math.max(0, fn.index - 200), fn.index);
				const renames = [...before.matchAll(GRAPHQL_RENAME)];
				const name =
					renames.length > 0
						? renames[renames.length - 1][1]
						: snakeToCamel(fn[1]);
				operations[name] = file.path;
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
