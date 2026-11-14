import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Page/header contract resolver (issue #3161).
 *
 * Every document a route family can render — a page.tsx leaf or the root
 * not-found.tsx — must resolve exactly one declared top-bar policy. The
 * declaration is the `data-page-header` attribute produced by
 * components/PageShell.tsx (via `<PageShell header="…">`, the
 * `pageHeader("…")` spread helper, or an explicit attribute) on the
 * outermost element the family mounts under <body>. Deeper layouts inherit
 * the family's declaration; declaring the same policy again is consistent,
 * declaring a different one is ambiguous.
 *
 * This module is the shared, filesystem-driven enumeration both the unit
 * check (tests/unit/app/page-header-policy.test.ts) and the rendered e2e
 * coverage build on — a hand-maintained URL list could silently miss a new
 * route family, which is exactly the omission the contract exists to catch.
 */

export type PageHeaderPolicy = "solid" | "overlay" | "none";

const VALID_POLICIES = new Set<PageHeaderPolicy>(["solid", "overlay", "none"]);

/**
 * Route documents that intentionally resolve no policy. Each entry needs a
 * reason a reviewer can audit; a document that renders real markup may
 * never be added here — it must declare instead.
 */
export const DOCUMENT_EXEMPTIONS: Record<string, string> = {
	"929": "server-side redirect to today's perek — never renders a document",
};

/** Files that render a document under the root chrome when visited. */
const DOCUMENT_FILES = new Set(["page.tsx", "not-found.tsx"]);

/** Depth bound for following `export { default } from "…"` re-exports. */
const REEXPORT_DEPTH = 4;

export interface RouteDocument {
	/** App-relative route directory ("" for the root page / not-found). */
	routeDir: string;
	/** Absolute path of the document file itself. */
	documentFile: string;
	/**
	 * Files whose source may carry the family's declaration, outermost
	 * first: segment layouts between the root layout and the document —
	 * the root layout itself is excluded because it renders the bar and
	 * cannot declare a policy for its children — then the document file.
	 */
	chainFiles: string[];
}

/** Documents found under the app directory, in route order. */
export function discoverDocuments(appDir: string): RouteDocument[] {
	const root = resolve(appDir);
	const documents: RouteDocument[] = [];

	const visit = (dir: string, layouts: string[], routeDir: string) => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		// The root layout (app/layout.tsx) mounts the shared bar itself; a
		// declaration there cannot stand in for a family's own, so it stays
		// out of every chain.
		const layout = join(dir, "layout.tsx");
		const layoutsHere =
			dir !== root && existsSync(layout) ? [...layouts, layout] : layouts;
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(
					path,
					layoutsHere,
					routeDir ? `${routeDir}/${entry.name}` : entry.name,
				);
			} else if (entry.isFile() && DOCUMENT_FILES.has(entry.name)) {
				documents.push({
					routeDir,
					documentFile: path,
					chainFiles: [...layoutsHere, path],
				});
			}
		}
	};
	visit(root, [], "");
	return documents;
}

/** All declaration spellings the contract recognizes, in one place so a
 *  new form fails loudly until it is taught here on purpose. */
const DECLARATION_PATTERNS: RegExp[] = [
	// pageHeader("solid") — the typed spread helper
	/\bpageHeader\(\s*["'`]([\w-]+)["'`]\s*\)/g,
	// <PageShell header="solid">
	/<PageShell\b[^>]*\bheader\s*=\s*["'`]([\w-]+)["'`]/g,
	// data-page-header="solid" — an element spelling it out directly
	/\bdata-page-header\s*=\s*["'`]([\w-]+)["'`]/g,
	// { "data-page-header": "solid" } — object-literal form
	/["'`]data-page-header["'`]\s*:\s*["'`]([\w-]+)["'`]/g,
];

// `export { default } from "./x"` — the root page re-exports the [section]
// document, so its declaration lives in the re-export target.
const REEXPORT_PATTERN =
	/export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*["'`]([^"'`]+)["'`]/;

function resolveReexport(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [
		`${base}.tsx`,
		`${base}.ts`,
		join(base, "page.tsx"),
		join(base, "index.tsx"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** Declared policy literals found in one file (following re-exports). */
function declaredValuesIn(file: string, depth = 0): string[] {
	// Scans repo-owned authored source at unit-test time, never user input;
	// the declaration patterns are linear (no nested quantifiers).
	const source = readFileSync(file, "utf8"); // nosemgrep
	const values: string[] = [];
	for (const pattern of DECLARATION_PATTERNS) {
		for (const match of source.matchAll(pattern)) values.push(match[1]);
	}
	if (values.length > 0 || depth >= REEXPORT_DEPTH) return values;
	const reexport = REEXPORT_PATTERN.exec(source);
	if (!reexport) return values;
	const target = resolveReexport(file, reexport[1]);
	return target ? declaredValuesIn(target, depth + 1) : values;
}

export type PolicyStatus =
	| { kind: "declared"; policy: PageHeaderPolicy; via: string }
	| { kind: "exempt"; reason: string }
	| { kind: "undeclared" }
	| { kind: "invalid"; values: string[]; via: string }
	| { kind: "ambiguous"; policies: PageHeaderPolicy[]; via: string[] };

/** Resolve the single policy a route document declares (or why it cannot). */
export function resolveDocumentPolicy(
	doc: RouteDocument,
	appDir: string,
): PolicyStatus {
	const root = resolve(appDir);
	const invalid = new Set<string>();
	const declared = new Set<PageHeaderPolicy>();
	const declaringFiles = new Set<string>();
	let firstDeclFile: string | null = null;

	for (const file of doc.chainFiles) {
		const values = declaredValuesIn(file);
		if (values.length === 0) continue;
		declaringFiles.add(file);
		firstDeclFile ??= file;
		for (const value of values) {
			if (VALID_POLICIES.has(value as PageHeaderPolicy)) {
				declared.add(value as PageHeaderPolicy);
			} else {
				invalid.add(value);
			}
		}
	}

	const pretty = (file: string) => relative(root, file);
	if (invalid.size > 0) {
		return {
			kind: "invalid",
			values: [...invalid],
			via: pretty(firstDeclFile ?? doc.documentFile),
		};
	}
	if (declared.size > 1) {
		return {
			kind: "ambiguous",
			policies: [...declared],
			via: [...declaringFiles].map(pretty),
		};
	}
	if (declared.size === 1) {
		return {
			kind: "declared",
			policy: [...declared][0],
			via: pretty(firstDeclFile ?? doc.documentFile),
		};
	}
	const reason = DOCUMENT_EXEMPTIONS[doc.routeDir];
	return reason ? { kind: "exempt", reason } : { kind: "undeclared" };
}
