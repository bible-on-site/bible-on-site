import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	DOCUMENT_EXEMPTIONS,
	discoverDocuments,
	resolveDocumentPolicy,
} from "../../util/page-header-policy";

const APP_DIR = resolve(__dirname, "../../../src/app");

/**
 * Route-family coverage for the page/header contract (issue #3161): every
 * document the app can render must resolve one declared top-bar policy.
 * The enumeration walks src/app itself — a new route family that forgets
 * the declaration fails here even if nobody added it to a URL list.
 */
describe("page header contract", () => {
	const results = discoverDocuments(APP_DIR).map((doc) => ({
		doc,
		status: resolveDocumentPolicy(doc, APP_DIR),
	}));
	const byRoute = new Map(results.map((r) => [r.doc.routeDir, r.status]));

	it("discovers every rendered route family", () => {
		const routes = results.map((r) => r.doc.routeDir);
		// Sanity floor — a broken walk that returns a handful of documents
		// must not be able to green-light the contract.
		expect(routes.length).toBeGreaterThanOrEqual(20);
		for (const family of [
			"",
			"[section]",
			"929/[number]",
			"929/[number]/[slug]",
			"929/authors",
			"929/authors/[authorParam]",
			"accessibility",
			"bookshelf",
			"calendar",
			"dev/sefer/[number]",
			"journalism",
			"masora",
			"masora/[unit]",
			"moadim",
			"moadim/[slug]",
			"parasha",
			"parasha/[unit]",
			"pedia",
			"pedia/[slug]",
			"rabbis-blessing",
			"search",
		]) {
			expect(routes).toContain(family);
		}
	});

	it("resolves a declared policy for every rendered document", () => {
		const failures = results
			.filter((r) => r.status.kind !== "declared" && r.status.kind !== "exempt")
			.map(
				(r) =>
					`${r.doc.routeDir || "(root)"}/${r.doc.documentFile.split(/[\\/]/).pop()}: ${JSON.stringify(r.status)}`,
			);
		expect(failures).toEqual([]);
	});

	it("assigns the intended treatment to each family", () => {
		expect(byRoute.get("")).toMatchObject({
			kind: "declared",
			policy: "overlay",
		});
		expect(byRoute.get("[section]")).toMatchObject({
			kind: "declared",
			policy: "overlay",
		});
		expect(byRoute.get("dev/sefer/[number]")).toMatchObject({
			kind: "declared",
			policy: "none",
		});
		for (const solid of [
			"929/[number]",
			"929/[number]/[slug]",
			"929/authors",
			"929/authors/[authorParam]",
			"accessibility",
			"bookshelf",
			"calendar",
			"journalism",
			"masora",
			"masora/[unit]",
			"moadim",
			"moadim/[slug]",
			"parasha",
			"parasha/[unit]",
			"pedia",
			"pedia/[slug]",
			"rabbis-blessing",
			"search",
		]) {
			expect(byRoute.get(solid)).toMatchObject({
				kind: "declared",
				policy: "solid",
			});
		}
	});

	it("keeps the exemption list honest", () => {
		// Only the /929 redirect is exempt; it must still exist and still be
		// needed — a stale or unnecessary exemption fails the check.
		expect(Object.keys(DOCUMENT_EXEMPTIONS)).toEqual(["929"]);
		expect(byRoute.get("929")).toMatchObject({ kind: "exempt" });
	});

	describe("guard rails (negative cases)", () => {
		let fixtureDir: string;
		const writeApp = (files: Record<string, string>) => {
			fixtureDir = mkdtempSync(join(tmpdir(), "page-header-app-"));
			for (const [path, content] of Object.entries(files)) {
				const full = join(fixtureDir, path);
				mkdirSync(join(full, ".."), { recursive: true });
				writeFileSync(full, content);
			}
			return fixtureDir;
		};
		afterEach(() => {
			if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
		});

		it("an unclassified page family fails the check instead of being skipped", () => {
			const app = writeApp({
				"layout.tsx":
					"export default function L({children}: any){return children}",
				"new-feature/page.tsx":
					"export default function Page(){return <main>hi</main>}",
			});
			const docs = discoverDocuments(app);
			const doc = docs.find((d) => d.routeDir === "new-feature");
			expect(doc).toBeDefined();
			expect(doc && resolveDocumentPolicy(doc, app)).toEqual({
				kind: "undeclared",
			});
		});

		it("a family declaring conflicting policies is ambiguous", () => {
			const app = writeApp({
				"feature/layout.tsx": `import {PageShell} from "x";export default function L({children}: any){return <PageShell header="solid">{children}</PageShell>}`,
				"feature/page.tsx": `export default function Page(){return <main data-page-header="overlay">hi</main>}`,
			});
			const [doc] = discoverDocuments(app);
			expect(resolveDocumentPolicy(doc, app).kind).toBe("ambiguous");
		});

		it("a value outside the policy union is invalid", () => {
			const app = writeApp({
				"feature/page.tsx": `export default function Page(){return <main data-page-header="sparkly">hi</main>}`,
			});
			const [doc] = discoverDocuments(app);
			expect(resolveDocumentPolicy(doc, app)).toMatchObject({
				kind: "invalid",
				values: ["sparkly"],
			});
		});

		it("follows a default re-export to the declaring document", () => {
			const app = writeApp({
				"[section]/page.tsx": `export default function Page(){return <main data-page-header="overlay">hi</main>}`,
				"page.tsx": `export { default } from "./[section]/page";`,
			});
			const rootDoc = discoverDocuments(app).find((d) => d.routeDir === "");
			expect(rootDoc).toBeDefined();
			expect(rootDoc && resolveDocumentPolicy(rootDoc, app)).toMatchObject({
				kind: "declared",
				policy: "overlay",
			});
		});

		it("a nested segment layout inherits the family declaration", () => {
			const app = writeApp({
				"feature/layout.tsx": `import {PageShell} from "x";export default function L({children}: any){return <PageShell header="solid">{children}</PageShell>}`,
				"feature/[id]/page.tsx":
					"export default function Page(){return <main>hi</main>}",
			});
			const doc = discoverDocuments(app).find(
				(d) => d.routeDir === "feature/[id]",
			);
			expect(doc).toBeDefined();
			expect(doc && resolveDocumentPolicy(doc, app)).toMatchObject({
				kind: "declared",
				policy: "solid",
			});
		});
	});
});
