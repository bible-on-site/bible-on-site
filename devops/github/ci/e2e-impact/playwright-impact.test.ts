import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
	buildApiSourceMap,
	depsClosure,
	graphqlAllFields,
	graphqlAllFieldsInSource,
	graphqlOperationsInSource,
	graphqlTopLevelFields,
	restPaths,
} from "./api-map.ts";
import {
	collectPlaywrightTree,
	normalizeCoveragePath,
} from "./collect-playwright.ts";
import { SCHEMA_VERSION, type CoverageTree, type SuiteRules } from "./model.ts";
import {
	discoverPlaywrightTests,
	parsePlaywrightSource,
	playwrightTestId,
} from "./playwright-discovery.ts";
import { selectTests } from "./select.ts";

// ── Fixtures ────────────────────────────────────────────────────────────

const WEB_RULES: SuiteRules = {
	schemaVersion: SCHEMA_VERSION,
	suite: "website-e2e",
	collector: "playwright-istanbul",
	collectorVersion: "1.0.0",
	platforms: { web: "Shared" },
	tests: {
		root: "web/site/tests/e2e",
		testDir: "web/site/tests",
		glob: "**/*.test.ts",
		framework: "playwright",
	},
	sources: { root: "web/site", globs: ["src/**"] },
	alwaysRun: ["e2e/health.test.ts :: health :: ok"],
	runAllOnChange: ["web/site/package.json", ".github/**"],
	noImpact: ["docs/**", "**/*.md"],
	scope: ["web/site/**"],
};

const API_RULES: SuiteRules = {
	schemaVersion: SCHEMA_VERSION,
	suite: "api-e2e",
	collector: "api-operations",
	collectorVersion: "1.0.0",
	platforms: { api: "Shared" },
	tests: {
		root: "web/api/tests/e2e",
		glob: "**/*.test.ts",
		framework: "playwright",
	},
	sources: { root: "web/api", globs: ["src/**/*.rs", "entities/src/**/*.rs"] },
	alwaysRun: [],
	runAllOnChange: ["web/api/Cargo.toml"],
	noImpact: ["docs/**"],
	scope: ["web/api/**"],
};

const SNAPSHOT = "1111111111111111111111111111111111111111";
const TESTED = "2222222222222222222222222222222222222222";

function tmpRepo(): string {
	return mkdtempSync(join(tmpdir(), "e2e-impact-pw-"));
}

function write(root: string, rel: string, content: string): void {
	const path = join(root, ...rel.split("/"));
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

function makeTree(overrides: Partial<CoverageTree> = {}): CoverageTree {
	return {
		schemaVersion: SCHEMA_VERSION,
		suite: "website-e2e",
		platform: "web",
		snapshotSha: SNAPSHOT,
		collectorVersion: "1.0.0",
		collectedAtUtc: "2025-01-01T00:00:00Z",
		complete: true,
		sourceUnits: {},
		sourceFiles: [],
		tests: {},
		...overrides,
	};
}

// ── parsePlaywrightSource ───────────────────────────────────────────────

describe("parsePlaywrightSource", () => {
	test("extracts top-level and nested describe titles", () => {
		const source = `
import { test } from "../fixture";
test.describe("outer", () => {
	test("one", async () => {});
	test.describe("inner", () => {
		test("two", () => {});
	});
});
test("top", () => {});
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [
			["outer", "one"],
			["outer", "inner", "two"],
			["top"],
		]);
	});

	test("modifier chains declare tests and describes", () => {
		const source = `
test.describe.serial("serial", () => { test("s", () => {}); });
test.describe.skip("skipped", () => { test("x", () => {}); });
test.only("only", () => {});
test.fixme("fixme", () => {});
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [
			["serial", "s"],
			["skipped", "x"],
			["only"],
			["fixme"],
		]);
	});

	test("hooks, use, step and describe.configure are not declarations", () => {
		const source = `
test.beforeEach(async () => {});
test.use({ locale: "he" });
test.describe.configure({ mode: "parallel" });
test("a", async ({ page }) => { await test.step("s", () => {}); });
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [["a"]]);
	});

	test("test.skip(cond) and test.slow() config calls are not declarations", () => {
		const source = `
test.skip(process.env.SKIP, "reason");
test.slow();
test("a", () => {});
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [["a"]]);
	});

	test("non-literal title with a callback marks the file dynamic", () => {
		const source = `const name = "x"; test(name, () => {});`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, true);
		assert.deepEqual(parsed.titles, []);
	});

	test("template-literal title marks the file dynamic", () => {
		const parsed = parsePlaywrightSource("test(`t-${1}`, () => {});");
		assert.equal(parsed.dynamic, true);
	});

	test("a non-literal describe suppresses children without phantom ids", () => {
		const source = `
test.describe(dynamicName, () => {
	test("inner", () => {});
});
test("outer", () => {});
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, true);
		assert.deepEqual(parsed.titles, [["outer"]]);
	});

	test("member expressions like foo.test( are ignored", () => {
		const source = `foo.test("x", () => {}); test("y", () => {});`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [["y"]]);
	});

	test("regex literals and comments do not confuse tokenization", () => {
		const source = `
// test("commented", () => {});
const re = /test\\("x"/;
/* test("blocked", () => {}); */
test("real", () => {});
`;
		const parsed = parsePlaywrightSource(source);
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [["real"]]);
	});

	test("todo declarations (no body) record the identity", () => {
		const parsed = parsePlaywrightSource('test("todo");');
		assert.equal(parsed.dynamic, false);
		assert.deepEqual(parsed.titles, [["todo"]]);
	});

	test("unterminated strings mark the file dynamic", () => {
		const parsed = parsePlaywrightSource('test("open, () => {});');
		assert.equal(parsed.dynamic, true);
	});
});

describe("playwrightTestId", () => {
	test("joins file and titles with :: separators", () => {
		assert.equal(
			playwrightTestId("e2e/x.test.ts", ["d", "t"]),
			"e2e/x.test.ts :: d :: t",
		);
	});
});

// ── discoverPlaywrightTests ─────────────────────────────────────────────

describe("discoverPlaywrightTests", () => {
	test("discovers ids relative to testDir and flags dynamic files", () => {
		const root = tmpRepo();
		try {
			write(
				root,
				"web/site/tests/e2e/a.test.ts",
				'test.describe("d", () => { test("t", () => {}); });',
			);
			write(
				root,
				"web/site/tests/e2e/dynamic.test.ts",
				'test(name, () => {});',
			);
			write(root, "web/site/tests/util/helper.ts", 'export const x = 1;');
			const found = discoverPlaywrightTests(
				root,
				"web/site/tests/e2e",
				"**/*.test.ts",
				"web/site/tests",
			);
			assert.deepEqual(
				found.tests.map((t) => t.id),
				["e2e/a.test.ts :: d :: t"],
			);
			assert.equal(found.tests[0].file, "web/site/tests/e2e/a.test.ts");
			assert.equal(found.tests[0].platform, "Shared");
			assert.deepEqual(found.dynamicFiles, [
				"web/site/tests/e2e/dynamic.test.ts",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a file matching the glob with no declarations is dynamic", () => {
		const root = tmpRepo();
		try {
			write(root, "web/site/tests/e2e/empty.test.ts", "// nothing");
			const found = discoverPlaywrightTests(
				root,
				"web/site/tests/e2e",
				"**/*.test.ts",
			);
			assert.deepEqual(found.tests, []);
			assert.deepEqual(found.dynamicFiles, [
				"web/site/tests/e2e/empty.test.ts",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── GraphQL / REST extraction ───────────────────────────────────────────

describe("graphqlTopLevelFields", () => {
	test("extracts depth-1 fields and aliases, skipping nested sets", () => {
		const fields = graphqlTopLevelFields(
			"query GetArticles { articles(perakim: 1) { id name { first } } authors }",
		);
		assert.deepEqual(fields.sort(), ["articles", "authors"]);
	});

	test("bare selection sets and mutations work", () => {
		assert.deepEqual(graphqlTopLevelFields("{ health version }").sort(), [
			"health",
			"version",
		]);
		assert.deepEqual(
			graphqlTopLevelFields("mutation { updateRabbi(id: 5) { ok } }"),
			["updateRabbi"],
		);
	});

	test("no selection set yields nothing", () => {
		assert.deepEqual(graphqlTopLevelFields("query X"), []);
	});
});

describe("restPaths", () => {
	test("collects slash-prefixed string literals, skips protocol URLs", () => {
		const paths = restPaths(
			'request.get("/health"); const u = "https://x/y"; const p = `/api/z`;',
		);
		assert.ok(paths.includes("/health"));
		assert.ok(paths.includes("/api/z"));
	});
});

describe("graphqlOperationsInSource", () => {
	test("collects top-level fields from query/document payloads", () => {
		const ops = graphqlOperationsInSource(
			'request.post("/graphql", { data: { query: "{ articles { id } }" } });',
		);
		assert.deepEqual(ops, ["articles"]);
	});
});

// ── buildApiSourceMap ───────────────────────────────────────────────────

const API_FIXTURE: Record<string, string> = {
	"src/main.rs": "mod resolvers;\nmod common;\nmod dtos;\nmod services;\nmod startup;\nfn main() {}",
	"src/resolvers.rs": "pub mod articles_resolver;",
	"src/resolvers/articles_resolver.rs": `
use crate::services::article_service::ArticleService;
use entities::article::Entity as Article;
pub struct ArticlesQuery;
#[Object]
impl ArticlesQuery {
	async fn articles(&self) -> Vec<Article> { vec![] }
}
`,
	"src/common.rs": "pub mod error_handling;",
	"src/common/error_handling.rs": "pub struct ServiceError;\npub struct AppError;",
	"src/dtos.rs": "pub mod author;",
	// Mirrors web/api: computed fields live in #[ComplexObject] impls, plain
	// members in #[derive(SimpleObject)] structs.
	"src/dtos/author.rs": `
use async_graphql::{ComplexObject, SimpleObject};
#[derive(SimpleObject)]
pub struct AuthorName {
	pub first: String,
}
#[ComplexObject]
impl Author {
	#[graphql(name = "articlesCount")]
	async fn articles_count(&self) -> i64 { 0 }
}
`,
	"src/services.rs": "pub mod article_service;\npub mod article_search;",
	// Mirrors the real multiline nested group: `use crate::{common::x::{..},
	// services::article_search::{self, store}}`.
	"src/services/article_service.rs": `
use crate::{
	common::error_handling::{AppError, ServiceError},
	services::article_search::{self, store},
};
use entities::article::Entity;
pub struct ArticleService;
`,
	"src/services/article_search.rs": "pub mod lsa;\npub mod store;\npub mod text;\npub struct ArticleSearchIndex;",
	"src/services/article_search/lsa.rs": "pub struct LsaModel;",
	"src/services/article_search/store.rs": "pub struct Store;",
	"src/services/article_search/text.rs": "pub fn normalize() {}",
	"src/startup.rs": "pub mod app;",
	"src/startup/app.rs": `
use actix_web::web;
pub fn routes(cfg: &mut web::ServiceConfig) {
	cfg.service(web::resource("/health").to(health));
}
async fn health() -> &'static str { "ok" }
`,
	"entities/src/lib.rs": "pub mod article;",
	"entities/src/article.rs": "pub struct Entity;",
};

describe("buildApiSourceMap", () => {
	test("maps graphql operations to resolver files", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			assert.equal(
				map.operations["articles"],
				"web/api/src/resolvers/articles_resolver.rs",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("maps REST routes to registrar and handler files", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			assert.ok(
				map.routes["/health"].includes("web/api/src/startup/app.rs"),
				"registrar file is on the route",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("use-graph closure reaches entities through crate paths", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			const closure = depsClosure(map.deps, [
				"web/api/src/resolvers/articles_resolver.rs",
			]);
			assert.ok(closure.includes("web/api/src/services/article_service.rs"));
			assert.ok(
				closure.includes("web/api/entities/src/article.rs"),
				`entities dep missing from ${closure.join(",")}`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("graphql rename attributes take precedence over camelCase", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			write(
				root,
				"web/api/src/resolvers/renamed.rs",
				`#[Object]
impl R {
	#[graphql(name = "customName")]
	async fn whatever(&self) -> bool { true }
}
`,
			);
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			assert.equal(
				map.operations["customName"],
				"web/api/src/resolvers/renamed.rs",
			);
			assert.equal(map.operations["whatever"], undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("nested grouped use paths resolve through the brace tree", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			const deps = map.deps["web/api/src/services/article_service.rs"];
			assert.ok(
				deps.includes("web/api/src/common/error_handling.rs"),
				`nested error_handling import missing from ${deps.join(",")}`,
			);
			assert.ok(
				deps.includes("web/api/src/services/article_search.rs"),
				`article_search self import missing from ${deps.join(",")}`,
			);
			assert.ok(
				deps.includes("web/api/src/services/article_search/store.rs"),
				`nested store import missing from ${deps.join(",")}`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("mod declarations create edges so submodule changes select", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			const searchDeps = map.deps["web/api/src/services/article_search.rs"];
			for (const child of ["lsa", "store", "text"]) {
				assert.ok(
					searchDeps.includes(
						`web/api/src/services/article_search/${child}.rs`,
					),
					`mod ${child} edge missing from ${searchDeps.join(",")}`,
				);
			}
			// The resolver's closure reaches the whole search index tree —
			// an lsa.rs ranking change must select the searchArticles tests.
			const closure = depsClosure(map.deps, [
				"web/api/src/resolvers/articles_resolver.rs",
			]);
			for (const child of ["lsa", "store", "text"]) {
				assert.ok(
					closure.includes(
						`web/api/src/services/article_search/${child}.rs`,
					),
					`closure misses article_search/${child}.rs`,
				);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ComplexObject and SimpleObject members join the field map", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			const map = buildApiSourceMap(join(root, "web/api"), "web/api");
			assert.deepEqual(map.fields["articlesCount"], [
				"web/api/src/dtos/author.rs",
			]);
			assert.deepEqual(map.fields["first"], ["web/api/src/dtos/author.rs"]);
			// Top-level resolver ops still map as before.
			assert.equal(
				map.operations["articles"],
				"web/api/src/resolvers/articles_resolver.rs",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("graphqlAllFields", () => {
	test("collects nested field names, skipping args and directives", () => {
		const fields = graphqlAllFields(
			'query Q($id: Int!) { articles(id: $id) @include(if: $flag) { id author { articlesCount } } }',
		);
		assert.ok(fields.includes("articles"));
		assert.ok(fields.includes("id"));
		assert.ok(fields.includes("author"));
		assert.ok(fields.includes("articlesCount"));
		assert.ok(!fields.includes("include"), "directive names are not fields");
		assert.ok(!fields.includes("Q"), "operation name is not a field");
	});

	test("graphqlAllFieldsInSource unions across document literals", () => {
		const names = graphqlAllFieldsInSource(
			'const q = "{ starter { authors { articlesCount } } }"; const r = "{ health }";',
		);
		assert.ok(names.includes("starter"));
		assert.ok(names.includes("articlesCount"));
		assert.ok(names.includes("health"));
	});
});

// ── normalizeCoveragePath ───────────────────────────────────────────────

describe("normalizeCoveragePath", () => {
	test("anchors absolute, url and vite paths at the sources root", () => {
		const root = "web/site";
		assert.equal(
			normalizeCoveragePath("C:/repo/web/site/src/a.ts", root),
			"web/site/src/a.ts",
		);
		assert.equal(
			normalizeCoveragePath("file:///repo/web/site/src/a.ts?import", root),
			"web/site/src/a.ts",
		);
		assert.equal(
			normalizeCoveragePath("http://localhost:3000/src/b.tsx", root),
			"web/site/src/b.tsx",
		);
		assert.equal(
			normalizeCoveragePath("src/c.ts", root),
			"web/site/src/c.ts",
		);
	});

	test("node_modules and unmappable paths return null", () => {
		const root = "web/site";
		assert.equal(
			normalizeCoveragePath("/repo/web/site/node_modules/x/index.js", root),
			null,
		);
		assert.equal(normalizeCoveragePath("other/package/z.ts", root), null);
	});
});

// ── collectPlaywrightTree (istanbul) ────────────────────────────────────

const TEST_SOURCE = 'test.describe("d", () => { test("t", () => {}); });';

function makeIstanbulRepo(): string {
	const root = tmpRepo();
	write(root, "web/site/tests/e2e/a.test.ts", TEST_SOURCE);
	write(root, "web/site/src/used.ts", "export const u = 1;");
	write(root, "web/site/src/unused.ts", "export const v = 1;");
	return root;
}

describe("collectPlaywrightTree", () => {
	test("browser dumps attribute per-test; server dumps go shared", () => {
		const root = makeIstanbulRepo();
		try {
			const artifacts = join(root, "artifacts");
			write(artifacts, "coverage/dump1.json", JSON.stringify({
				id: "e2e/a.test.ts :: d :: t",
				project: "Desktop",
				file: "e2e/a.test.ts",
				titlePath: ["d", "t"],
				realm: "browser",
				coverage: { "/x/web/site/src/used.ts": {} },
			}));
			write(artifacts, "coverage/dump2.json", JSON.stringify({
				id: "e2e/a.test.ts :: d :: t",
				project: "Desktop",
				file: "e2e/a.test.ts",
				titlePath: ["d", "t"],
				realm: "server",
				coverage: { "/x/web/site/src/unused.ts": {} },
			}));
			write(artifacts, "test-results.json", JSON.stringify({
				schema: "e2e-impact-results/1",
				tests: [{ id: "e2e/a.test.ts :: d :: t", project: "Desktop", retry: 0, status: "passed", outcome: "expected" }],
			}));
			write(artifacts, "discovered.json", JSON.stringify({
				schema: "e2e-impact-discovery/1",
				tests: [{ id: "e2e/a.test.ts :: d :: t", project: "Desktop", file: "e2e/a.test.ts", titlePath: ["d", "t"] }],
			}));
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: WEB_RULES,
				platform: "web",
				artifactsDir: artifacts,
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			assert.equal(tree.complete, true);
			const entry = tree.tests["e2e/a.test.ts :: d :: t"];
			assert.deepEqual(entry.files, ["web/site/src/used.ts"]);
			assert.equal(entry.outcome, "passed");
			assert.deepEqual(tree.sharedFiles, ["web/site/src/unused.ts"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a test with no attributable evidence gets the union and a flag", () => {
		const root = makeIstanbulRepo();
		try {
			const artifacts = join(root, "artifacts");
			write(artifacts, "coverage/dump.json", JSON.stringify({
				id: "e2e/a.test.ts :: d :: t",
				realm: "server",
				coverage: { "/x/web/site/src/used.ts": {} },
			}));
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: WEB_RULES,
				platform: "web",
				artifactsDir: artifacts,
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			const entry = tree.tests["e2e/a.test.ts :: d :: t"];
			assert.equal(entry.unattributed, true);
			assert.deepEqual(entry.files, ["web/site/src/used.ts"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("runtime-only dump ids widen into shared coverage, not claims", () => {
		const root = makeIstanbulRepo();
		try {
			const artifacts = join(root, "artifacts");
			write(artifacts, "coverage/dyn.json", JSON.stringify({
				id: "e2e/dynamic.test.ts :: d :: t",
				realm: "browser",
				coverage: { "/x/web/site/src/used.ts": {} },
			}));
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: WEB_RULES,
				platform: "web",
				artifactsDir: artifacts,
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			assert.deepEqual(tree.sharedFiles, ["web/site/src/used.ts"]);
			assert.ok(tree.unmatchedEvidence?.includes("e2e/dynamic.test.ts :: d :: t"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("corrupt evidence marks the tree incomplete", () => {
		const root = makeIstanbulRepo();
		try {
			const artifacts = join(root, "artifacts");
			write(artifacts, "coverage/bad.json", "{not json");
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: WEB_RULES,
				platform: "web",
				artifactsDir: artifacts,
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			assert.equal(tree.complete, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("missing reporter evidence marks the tree incomplete", () => {
		const root = makeIstanbulRepo();
		try {
			const artifacts = join(root, "artifacts");
			write(artifacts, "coverage/dump.json", JSON.stringify({
				id: "e2e/a.test.ts :: d :: t",
				realm: "browser",
				coverage: { "/x/web/site/src/used.ts": {} },
			}));
			// Coverage dumps exist but the reporter wrote neither results nor
			// runtime discovery — outcomes are all unknown and the tree must
			// never be published as a trusted baseline.
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: WEB_RULES,
				platform: "web",
				artifactsDir: artifacts,
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			assert.equal(tree.complete, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the api collector attributes operations statically", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			write(
				root,
				"web/api/tests/e2e/articles.test.ts",
				`test("q", async ({ request }) => {
	await request.post("/graphql", { data: { query: "{ articles { id } }" } });
});`,
			);
			write(
				root,
				"web/api/tests/e2e/health.test.ts",
				'test("h", async ({ request }) => { await request.get("/health"); });',
			);
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: API_RULES,
				platform: "api",
				artifactsDir: join(root, "artifacts"),
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			const articles = tree.tests["articles.test.ts :: q"];
			assert.ok(articles.files.includes("web/api/src/resolvers/articles_resolver.rs"));
			assert.ok(articles.files.includes("web/api/src/services/article_service.rs"));
			assert.ok(articles.files.includes("web/api/entities/src/article.rs"));
			// The use-graph closure widens through nested group imports and
			// mod declarations to the search index children.
			assert.ok(articles.files.includes("web/api/src/common/error_handling.rs"));
			assert.ok(articles.files.includes("web/api/src/services/article_search/lsa.rs"));
			// Route registrar files land in shared coverage, not per-test claims.
			assert.ok(tree.sharedFiles?.includes("web/api/src/startup/app.rs"));
			const health = tree.tests["health.test.ts :: h"];
			// /health is served from the shared registrar, so the test has no
			// per-test attribution — it covers the union and runs on any
			// covered change, never narrowed away (#2085).
			assert.equal(health.unattributed, true);
			assert.ok(health.files.includes("web/api/src/startup/app.rs"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("nested graphql fields attribute DTO impl files", () => {
		const root = tmpRepo();
		try {
			for (const [rel, content] of Object.entries(API_FIXTURE)) {
				write(root, `web/api/${rel}`, content);
			}
			write(
				root,
				"web/api/tests/e2e/starter.test.ts",
				`test("s", async ({ request }) => {
	await request.post("/graphql", { data: { query: "{ articles { author { articlesCount } } }" } });
});`,
			);
			const tree = collectPlaywrightTree({
				repoRoot: root,
				rules: API_RULES,
				platform: "api",
				artifactsDir: join(root, "artifacts"),
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			const entry = tree.tests["starter.test.ts :: s"];
			// `articles` resolves the resolver root; the nested `articlesCount`
			// selection executes the DTO's ComplexObject impl — both attribute.
			assert.ok(
				entry.files.includes("web/api/src/dtos/author.rs"),
				`DTO field file missing from ${entry.files.join(",")}`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── selectTests (playwright framework) ──────────────────────────────────

describe("selectTests playwright", () => {
	const discovered = [
		{ id: "e2e/a.test.ts :: d :: t", file: "web/site/tests/e2e/a.test.ts", platform: "Shared" },
		{ id: "e2e/b.test.ts :: x", file: "web/site/tests/e2e/b.test.ts", platform: "Shared" },
	];

	const baselineTree = makeTree({
		sourceUnits: {
			"web/site/src/a": ["web/site/src/a.ts"],
			"web/site/src/b": ["web/site/src/b.ts"],
		},
		sourceFiles: ["web/site/src/a.ts", "web/site/src/b.ts"],
		tests: {
			"e2e/a.test.ts :: d :: t": {
				file: "web/site/tests/e2e/a.test.ts",
				files: ["web/site/src/a.ts"],
				automationIds: [],
				unmappedIds: [],
				sessions: [],
				outcome: "passed",
			},
			"e2e/b.test.ts :: x": {
				file: "web/site/tests/e2e/b.test.ts",
				files: ["web/site/src/b.ts"],
				automationIds: [],
				unmappedIds: [],
				sessions: [],
				outcome: "passed",
			},
		},
	});

	test("a covered file narrows to covering tests; playwright filter fills", () => {
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree: baselineTree },
			changedFiles: [{ path: "web/site/src/a.ts", status: "modified" }],
			discovered,
			platform: "web",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(
			manifest.selected.map((s) => s.id),
			["e2e/a.test.ts :: d :: t"],
		);
		assert.equal(manifest.filter.vstest, null);
		assert.deepEqual(manifest.filter.playwright, [
			{ file: "web/site/tests/e2e/a.test.ts", titles: ["d t"] },
		]);
	});

	test("a changed test file selects its declared tests only", () => {
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree: baselineTree },
			changedFiles: [
				{ path: "web/site/tests/e2e/b.test.ts", status: "modified" },
			],
			discovered,
			platform: "web",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(
			manifest.selected.map((s) => s.id),
			["e2e/b.test.ts :: x"],
		);
	});

	test("an incomplete baseline tree falls back to the full suite", () => {
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree: makeTree({ ...baselineTree, complete: false }) },
			changedFiles: [{ path: "web/site/src/a.ts", status: "modified" }],
			discovered,
			platform: "web",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(
			manifest.fallbacks.some((f) => f.includes("incompatible-baseline")),
			`expected incompatible-baseline fallback, got ${manifest.fallbacks.join(",")}`,
		);
	});

	test("a dynamic test file change selects everything", () => {
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree: baselineTree },
			changedFiles: [
				{ path: "web/site/tests/e2e/dyn.test.ts", status: "modified" },
			],
			discovered,
			platform: "web",
			testedSha: TESTED,
			dynamicTestFiles: new Set(["web/site/tests/e2e/dyn.test.ts"]),
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.includes("dynamic-test-file")));
	});

	test("a non-glob file under the test root selects everything", () => {
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree: baselineTree },
			changedFiles: [
				{ path: "web/site/tests/e2e/fixture.ts", status: "modified" },
			],
			discovered,
			platform: "web",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.includes("changed-test-harness")));
	});

	test("shared coverage widens to the whole suite", () => {
		const tree = makeTree({
			...baselineTree,
			sharedFiles: ["web/site/src/used.ts"],
		});
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: "web/site/src/used.ts", status: "modified" }],
			discovered,
			platform: "web",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.includes("shared-coverage")));
	});

	test("unattributed entries run on any covered change", () => {
		const tree = makeTree({
			...baselineTree,
			tests: {
				...baselineTree.tests,
				"e2e/mystery.test.ts :: m": {
					file: "web/site/tests/e2e/mystery.test.ts",
					files: ["web/site/src/a.ts", "web/site/src/b.ts"],
					unattributed: true,
					automationIds: [],
					unmappedIds: [],
					sessions: [],
					outcome: "passed",
				},
			},
		});
		const manifest = selectTests({
			rules: WEB_RULES,
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: "web/site/src/a.ts", status: "modified" }],
			discovered: [
				...discovered,
				{ id: "e2e/mystery.test.ts :: m", file: "web/site/tests/e2e/mystery.test.ts", platform: "Shared" },
			],
			platform: "web",
			testedSha: TESTED,
		});
		assert.deepEqual(
			manifest.selected.map((s) => s.id),
			["e2e/a.test.ts :: d :: t", "e2e/mystery.test.ts :: m"],
		);
	});
});
