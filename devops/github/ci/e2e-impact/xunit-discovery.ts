/**
 * Deterministic discovery of C# xUnit tests from source files.
 *
 * `dotnet test --list-tests` reports names but not the declaring file or the
 * traits needed for platform routing, so the selector parses the lightweight
 * subset of C# syntax this suite uses: `namespace` declarations, class
 * declarations, and `[Fact]`/`[Theory]`/`[Trait]`/`[Collection]` attributes
 * stacked above a member or type.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { DiscoveredTest } from "./model.ts";
import { matchesGlob } from "./glob.ts";

const NAMESPACE = /\bnamespace\s+([\w.]+)/;
const CLASS_DECL = /\b(?:public|internal|private|protected|file)?\s*(?:sealed\s+|static\s+|abstract\s+|partial\s+)*class\s+(\w+)/;
const METHOD_DECL =
	/^\s*public\s+(?:static\s+)?(?:async\s+)?(?:void|Task|ValueTask)\s+(\w+)\s*\(/;
const ATTRIBUTE = /^\s*\[\s*(\w+)(?:\((.*?)\))?\s*\]/;
const TRAIT_ARGUMENTS = /^\s*"([^"]+)"\s*,\s*"([^"]+)"\s*$/;

interface ParsedType {
	name: string;
	traits: Map<string, string>;
}

export interface ParsedTestSource {
	namespace: string;
	types: ParsedType[];
	/** method name -> declaring class name */
	tests: { method: string; className: string; traits: Map<string, string> }[];
}

/**
 * Parses a single C# file. The grammar handled is intentionally narrow:
 * attribute blocks are consecutive `[...]` lines; a declaration line consumes
 * the pending block. Nested classes (callback helpers) are ignored because the
 * first `class` keyword per enclosing type wins and members of nested types
 * cannot carry `[Fact]` without their own public method decl.
 */
export function parseTestSource(source: string): ParsedTestSource {
	const namespace = NAMESPACE.exec(source)?.[1] ?? "";
	const lines = source.split(/\r?\n/);
	const types: ParsedType[] = [];
	const tests: ParsedTestSource["tests"] = [];
	let pendingAttributes: { name: string; args: string }[] = [];
	let currentClass: ParsedType | null = null;

	const traitsOf = (attrs: { name: string; args: string }[]) => {
		const traits = new Map<string, string>();
		for (const attribute of attrs) {
			if (attribute.name !== "Trait") continue;
			const match = TRAIT_ARGUMENTS.exec(attribute.args);
			if (match) traits.set(match[1], match[2]);
		}
		return traits;
	};

	for (const line of lines) {
		// Consume the line left to right: attributes, then the first class or
		// method declaration, then whatever follows it (same-line members).
		let rest = line;
		while (true) {
			rest = rest.replace(/^\s*[{}]+/, "");
			const trimmed = rest.trim();
			if (trimmed === "" || trimmed.startsWith("//")) break;
			const attribute = ATTRIBUTE.exec(rest);
			if (attribute) {
				pendingAttributes.push({ name: attribute[1], args: attribute[2] ?? "" });
				rest = rest.slice(attribute.index + attribute[0].length);
				continue;
			}
			const classDecl = CLASS_DECL.exec(rest);
			const methodDecl = METHOD_DECL.exec(rest);
			const next =
				classDecl && (!methodDecl || classDecl.index <= methodDecl.index)
					? { kind: "class" as const, match: classDecl }
					: methodDecl
						? { kind: "method" as const, match: methodDecl }
						: null;
			if (next === null) {
				// Unrecognized content terminates the attribute block.
				pendingAttributes = [];
				break;
			}
			if (next.kind === "class") {
				const type: ParsedType = {
					name: next.match[1],
					traits: traitsOf(pendingAttributes),
				};
				types.push(type);
				currentClass = type;
				pendingAttributes = [];
				rest = rest.slice(next.match.index + next.match[0].length);
				continue;
			}
			if (
				currentClass &&
				pendingAttributes.some(
					(attribute) => attribute.name === "Fact" || attribute.name === "Theory",
				)
			) {
				const traits = new Map(currentClass.traits);
				for (const [key, value] of traitsOf(pendingAttributes)) {
					traits.set(key, value);
				}
				tests.push({ method: next.match[1], className: currentClass.name, traits });
			}
			pendingAttributes = [];
			break;
		}
	}
	return { namespace, types, tests };
}

/** Directories that never hold suite-authored sources. */
const SKIP_DIRS = new Set([".git", "bin", "obj", "node_modules"]);

/** Recursively lists files under `dir` matching a root-relative glob. */
export function listFiles(dir: string, glob: string): string[] {
	const results: string[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(path);
			} else if (matchesGlob(relative(dir, path).replaceAll("\\", "/"), glob)) {
				results.push(path);
			}
		}
	};
	walk(dir);
	return results.sort();
}

/**
 * Discovers runnable suite tests: files matching `testsGlob` under `testsRoot`,
 * filtered to the suite category trait. Paths are returned repo-relative.
 */
export function discoverSuiteTests(
	repoRoot: string,
	testsRoot: string,
	testsGlob: string,
	category: string,
): DiscoveredTest[] {
	const root = join(repoRoot, testsRoot);
	const discovered: DiscoveredTest[] = [];
	for (const file of listFiles(root, testsGlob)) {
		const parsed = parseTestSource(readFileSync(file, "utf8"));
		const repoFile = relative(repoRoot, file).replaceAll("\\", "/");
		for (const test of parsed.tests) {
			if (test.traits.get("Category") !== category) continue;
			discovered.push({
				id: `${parsed.namespace}.${test.className}.${test.method}`,
				file: repoFile,
				platform: test.traits.get("Platform") ?? "Shared",
				category,
			});
		}
	}
	return discovered.sort((a, b) => a.id.localeCompare(b.id));
}
