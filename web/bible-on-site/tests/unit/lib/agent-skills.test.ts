/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { createHash } from "node:crypto";
import { GET as skillGET, generateStaticParams } from "@/app/.well-known/agent-skills/[name]/SKILL.md/route";
import { GET as indexGET } from "@/app/.well-known/agent-skills/index.json/route";
import {
	AGENT_SKILLS,
	agentSkillsIndex,
	skillByName,
	skillDigest,
} from "@/lib/agent-skills";

interface SkillsIndex {
	$schema: string;
	skills: {
		name: string;
		type: string;
		description: string;
		url: string;
		digest: string;
	}[];
}

function parseIndex(body: string): SkillsIndex {
	return JSON.parse(body) as SkillsIndex;
}

describe("agent skills discovery index (issue #3257)", () => {
	it("publishes the v0.2.0 schema with one entry per skill", async () => {
		const index = agentSkillsIndex("https://canonical.example");
		expect(index.$schema).toBe(
			"https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		);
		expect(index.skills).toHaveLength(AGENT_SKILLS.length);
		for (const [position, skill] of index.skills.entries()) {
			expect(skill.name).toBe(AGENT_SKILLS[position].name);
			expect(skill.type).toBe("skill-md");
			expect(skill.description).toBe(AGENT_SKILLS[position].description);
			expect(skill.url).toBe(
				`https://canonical.example/.well-known/agent-skills/${skill.name}/SKILL.md`,
			);
			expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("serves the index as JSON over the route", async () => {
		const response = indexGET();
		expect(response.headers.get("content-type")).toContain(
			"application/json",
		);
		const index = parseIndex(await response.text());
		expect(index.skills.length).toBeGreaterThanOrEqual(3);
	});

	it("digests match the exact bytes the SKILL.md routes serve", async () => {
		const index = agentSkillsIndex("https://canonical.example");
		for (const entry of index.skills) {
			const skill = skillByName(entry.name);
			if (!skill) throw new Error(`index lists unknown skill ${entry.name}`);
			const response = await skillGET(new Request("https://x"), {
				params: Promise.resolve({ name: entry.name }),
			});
			const served = await response.text();
			expect(served).toBe(skill.body);
			expect(entry.digest).toBe(
				`sha256:${createHash("sha256").update(served, "utf8").digest("hex")}`,
			);
			expect(entry.digest).toBe(skillDigest(skill));
		}
	});
});

describe("SKILL.md artifacts", () => {
	it("generates static params for exactly the published skill names", () => {
		expect(generateStaticParams()).toEqual(
			AGENT_SKILLS.map((skill) => ({ name: skill.name })),
		);
	});

	it("serves each skill as UTF-8 markdown with matching frontmatter", async () => {
		const index = agentSkillsIndex("https://canonical.example");
		for (const entry of index.skills) {
			const response = await skillGET(new Request("https://x"), {
				params: Promise.resolve({ name: entry.name }),
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(
				"text/markdown; charset=utf-8",
			);
			const body = await response.text();
			expect(body.startsWith("---\n")).toBe(true);
			// Frontmatter repeats what the index advertises - name and the
			// one-sentence description - so a fetched artifact and the index
			// cannot drift apart.
			expect(body).toContain(`name: ${entry.name}`);
			expect(body).toContain(`description: ${entry.description}`);
		}
	});

	it("404s for a name outside the skill allowlist", async () => {
		const response = await skillGET(new Request("https://x"), {
			params: Promise.resolve({ name: "../../etc/passwd" }),
		});
		expect(response.status).toBe(404);
		const second = await skillGET(new Request("https://x"), {
			params: Promise.resolve({ name: "no-such-skill" }),
		});
		expect(second.status).toBe(404);
	});

	it("covers the three real corpus competencies - no filler skills", () => {
		expect(AGENT_SKILLS.map((skill) => skill.name)).toEqual([
			"tanah-corpus-map",
			"tanah-corpus-search",
			"tanah-corpus-citation",
		]);
	});
});

describe("skill content quality", () => {
	it("maps every canonical URL family including the noindex masora caveat", () => {
		const body = skillByName("tanah-corpus-map")?.body ?? "";
		for (const fragment of [
			"/929/{perekId}",
			"/929/{perekId}/{articleId}",
			"/929/{perekId}/{perushName}",
			"/929/authors",
			"/פרשה/{slug}",
			"/מסורה/{unitId}",
			"/מועדים/{slug}",
			"/pedia/{slug}",
			"/sitemap.xml",
			"noindex, follow",
			"308",
		]) {
			expect(body).toContain(fragment);
		}
	});

	it("describes the real anonymous search contract", () => {
		const body = skillByName("tanah-corpus-search")?.body ?? "";
		for (const fragment of [
			"/api/search?q=",
			"perek,pasuk,perush,author,article,tanahpedia",
			"availability",
			"invalid_query",
			"invalid_limit",
			"invalid_type",
			"search_failed",
			"no-store",
			"414",
		]) {
			expect(body).toContain(fragment);
		}
	});

	it("keeps the attribution and terminology contract", () => {
		const body = skillByName("tanah-corpus-citation")?.body ?? "";
		for (const fragment of [
			"/929/authors/{author}",
			"parshan",
			"/pedia/{slug}",
			"Perek",
			"Pasuk",
			"qri",
			"ktiv",
			"ai-train=yes",
			"/llms.txt",
		]) {
			expect(body).toContain(fragment);
		}
	});
});
