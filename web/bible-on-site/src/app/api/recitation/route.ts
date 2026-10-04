import { createHash } from "node:crypto";
import { recitationPackage } from "@/lib/recitation-package";
import packageJson from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const body = JSON.stringify(recitationPackage());
		const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
		const headers = {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "public, max-age=300",
			"X-Website-Version": packageJson.version,
			ETag: etag,
		};
		return new Response(
			request.headers.get("If-None-Match") === etag ? null : body,
			{
				status: request.headers.get("If-None-Match") === etag ? 304 : 200,
				headers,
			},
		);
	} catch (error) {
		console.error("Recitation extension could not be loaded", error);
		return Response.json(
			{ error: "Recitation extension unavailable" },
			{ status: 500 },
		);
	}
}
