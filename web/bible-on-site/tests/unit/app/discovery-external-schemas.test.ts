/**
 * @jest-environment node
 *
 * External-spec conformance for the discovery documents (#3497): the unit
 * suite already pins served bytes, digests and local shapes; these tests
 * validate the same documents against the *published* specifications —
 * the vendored ARD v0.91 JSON Schema, a vendored Agent Skills discovery
 * v0.2.0 subset (the canonical schema URI does not resolve), the Agent
 * Skills SKILL.md frontmatter contract, and the llms.txt document shape.
 * Everything runs offline against the pinned schema files under
 * tests/util/discovery/.
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
	absUrl: (path: string) =>
		path.startsWith("http")
			? path
			: `https://canonical.example${path.startsWith("/") ? path : `/${path}`}`,
}));

import { GET as skillGET } from "@/app/.well-known/agent-skills/[name]/SKILL.md/route";
import { GET as indexGET } from "@/app/.well-known/agent-skills/index.json/route";
import { GET as aiCatalogGET } from "@/app/.well-known/ai-catalog.json/route";
import { GET as ardGET } from "@/app/.well-known/ard.json/route";
import { GET as llmsGET } from "@/app/llms.txt/route";
import { agentSkillsIndex, skillByName } from "@/lib/agent-skills";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";
import yaml from "js-yaml";
import agentSkillsSchema from "../../util/discovery/agent-skills-discovery-0.2.0.schema.json";
import ardSchema from "../../util/discovery/ard-entry-0.91.schema.json";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateSkillsIndex = ajv.compile(agentSkillsSchema);
ajv.addSchema(ardSchema);
const validateArdManifest = ajv.getSchema(
	`${ardSchema.$id}#/$defs/ArdManifest`,
);

/** RFC 8615 Agent Skills skill-name rule (spec + vendored schema). */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function frontmatter(body: string): Record<string, unknown> {
	const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match)
		throw new Error("SKILL.md does not open with a YAML frontmatter block");
	// nosemgrep: Semgrep_rules_lgpl_javascript_eval_rule-yaml-deserialize -- the rule predates js-yaml 4: `load` no longer constructs unsafe js/* types, and the input here is our own served SKILL.md, not user data
	const parsed = yaml.load(match[1]);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("SKILL.md frontmatter is not a YAML mapping");
	}
	return parsed as Record<string, unknown>;
}

describe("Agent Skills discovery index - RFC v0.2.0", () => {
	it("validates against the vendored v0.2.0 schema (function output)", () => {
		const index = agentSkillsIndex("https://canonical.example");
		expect(validateSkillsIndex(index)).toBe(true);
		if (!validateSkillsIndex(index)) {
			throw new Error(ajv.errorsText(validateSkillsIndex.errors));
		}
	});

	it("validates against the vendored v0.2.0 schema (served route body)", async () => {
		const index = JSON.parse(await indexGET().text());
		expect(validateSkillsIndex(index)).toBe(true);
		if (!validateSkillsIndex(index)) {
			throw new Error(ajv.errorsText(validateSkillsIndex.errors));
		}
	});

	it("URLs resolve per the RFC convention: absolute https to {name}/SKILL.md", () => {
		for (const entry of agentSkillsIndex("https://canonical.example").skills) {
			expect(entry.url).toMatch(/^https:\/\//);
			expect(entry.url.endsWith(`/${entry.name}/SKILL.md`)).toBe(true);
		}
	});
});

describe("SKILL.md frontmatter - Agent Skills specification", () => {
	it("every published skill has spec-conformant YAML frontmatter", () => {
		for (const entry of agentSkillsIndex("https://canonical.example").skills) {
			const skill = skillByName(entry.name);
			if (!skill) throw new Error(`index lists unknown skill ${entry.name}`);
			const fm = frontmatter(skill.body);
			// Required fields per the spec.
			expect(typeof fm.name).toBe("string");
			expect(typeof fm.description).toBe("string");
			// name: 1-64 chars, lowercase alphanumeric + hyphens, no
			// leading/trailing/consecutive hyphens - and it must equal the
			// parent skill directory name, which for us is the route segment.
			expect(fm.name).toBe(entry.name);
			expect(entry.name).toMatch(SKILL_NAME);
			expect(entry.name.length).toBeLessThanOrEqual(64);
			// description: 1-1024 chars, and it must repeat what the index
			// advertises (spec: SHOULD match).
			expect(String(fm.description).length).toBeGreaterThan(0);
			expect(String(fm.description).length).toBeLessThanOrEqual(1024);
			expect(fm.description).toBe(entry.description);
		}
	});

	it("the served artifacts' frontmatter conforms too", async () => {
		for (const entry of agentSkillsIndex("https://canonical.example").skills) {
			const response = await skillGET(new Request("https://x"), {
				params: Promise.resolve({ name: entry.name }),
			});
			const body = await response.text();
			const fm = frontmatter(body);
			expect(fm.name).toBe(entry.name);
			expect(fm.description).toBe(entry.description);
			// Body after frontmatter is the unrestricted Markdown section —
			// it must not be empty.
			const markdown = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
			expect(markdown.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("ARD / AI Catalog manifest - ARD v0.91", () => {
	it("validates the ArdManifest at /.well-known/ard.json", async () => {
		const manifest = await ardGET().json();
		if (validateArdManifest && !validateArdManifest(manifest)) {
			throw new Error(ajv.errorsText(validateArdManifest.errors));
		}
		expect(validateArdManifest?.(manifest)).toBe(true);
	});

	it("validates the same entries at the predecessor ai-catalog path", async () => {
		const manifest = await aiCatalogGET().json();
		expect(validateArdManifest?.(manifest)).toBe(true);
	});

	it("keeps the D.2 discovery constraints the schema deliberately leaves open", async () => {
		const manifest = (await ardGET().json()) as {
			entries: {
				identifier: string;
				representativeQueries?: string[];
				url?: string;
				data?: unknown;
			}[];
		};
		// §D.2: representativeQueries present with 2-5 examples — a warning
		// upstream, but this origin treats it as a hard requirement because
		// entries without it are unfindable by registry search.
		for (const entry of manifest.entries) {
			expect(entry.representativeQueries?.length).toBeGreaterThanOrEqual(2);
			expect(entry.representativeQueries?.length).toBeLessThanOrEqual(5);
			// §4.3 value-or-reference: exactly one of url/data (the schema's
			// oneOf also checks this; keep the intent explicit).
			expect((entry.url ? 1 : 0) + (entry.data ? 1 : 0)).toBe(1);
		}
	});
});

describe("/llms.txt - llmstxt.org document shape", () => {
	it("opens with the required H1 title and a blockquote summary", async () => {
		const body = await llmsGET().text();
		const lines = body.split("\n");
		// The spec requires the file to start with an H1 naming the project.
		expect(lines[0]).toMatch(/^# .+/);
		// The optional (and here used) summary is a markdown blockquote.
		expect(body).toMatch(/^# .+\n\n(> .+\n?)+/);
	});

	it("organizes content under H2 sections, per the spec's structure", async () => {
		const body = await llmsGET().text();
		const h2Count = (body.match(/^## /gm) ?? []).length;
		expect(h2Count).toBeGreaterThanOrEqual(3);
		// No heading may skip a level (H3 without a parent H2 is a spec smell).
		expect(body).not.toMatch(/^#{4,} /gm);
	});

	it("uses well-formed markdown link syntax for the resource lists it publishes", async () => {
		const body = await llmsGET().text();
		// Every published discovery URL the llms spec expects agents to reach
		// must appear inside a valid Markdown link target or an inline-code
		// span — a raw substring check could be satisfied by text inside a
		// malformed link (an unbalanced "[x](/path" yields no "](" target).
		const linkTargets = new Set(
			[...body.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)].map((m) => m[1]),
		);
		const codeSpans = [...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
		const unrepresented = [
			"/.well-known/api-catalog",
			"/.well-known/ard.json",
			"/.well-known/ai-catalog.json",
			"/.well-known/agent-skills/index.json",
			"/openapi.json",
			"/sitemap.xml",
			"/robots.txt",
			"/api/search",
		].filter(
			(resource) =>
				!linkTargets.has(resource) &&
				!codeSpans.some(
					(span) =>
						span === resource ||
						span.startsWith(`${resource}?`) ||
						span.startsWith(`${resource}/`),
				),
		);
		expect(unrepresented).toEqual([]);
		// No broken markdown links: every "[" starting a link text has a
		// matching "](" pair somewhere — cheap balance check against drift.
		const linkText = body.match(/\[[^\]]+\]\([^)]+\)/g) ?? [];
		expect(linkText.length).toBeGreaterThan(0);
		for (const link of linkText) {
			expect(link).toMatch(/^\[[^\]\n]+\]\([^)\s]+\)$/);
		}
	});
});
