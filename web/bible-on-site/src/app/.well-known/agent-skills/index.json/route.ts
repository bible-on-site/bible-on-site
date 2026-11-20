/**
 * `/.well-known/agent-skills/index.json` - Agent Skills discovery index
 * (issue #3257), v0.2.0 shape: `$schema` marker plus a `skills` array of
 * `skill-md` entries with sha256 digests of the served SKILL.md bodies.
 */
import { NextResponse } from "next/server";
import { agentSkillsIndex } from "@/lib/agent-skills";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

export function GET(): NextResponse {
	return NextResponse.json(agentSkillsIndex(SITE_ORIGIN), {
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
