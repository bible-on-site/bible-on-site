/**
 * `/.well-known/agent-skills/{name}/SKILL.md` - the skill-md artifacts the
 * index lists (issue #3257). `generateStaticParams` + `dynamicParams =
 * false` bound the served names to the AGENT_SKILLS allowlist: any other
 * name is a build-time 404, never a lookup.
 */
import { NextResponse } from "next/server";
import { AGENT_SKILLS, skillByName } from "@/lib/agent-skills";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { name: string }[] {
	return AGENT_SKILLS.map((skill) => ({ name: skill.name }));
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
	const skill = skillByName((await params).name);
	if (!skill) {
		return new NextResponse("Not Found", { status: 404 });
	}
	return new NextResponse(skill.body, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
