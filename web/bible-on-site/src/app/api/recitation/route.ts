import { createHash } from "node:crypto";
import { recitationPackage } from "@/lib/recitation-package";
import packageJson from "../../../../package.json";

export const dynamic = "force-dynamic";

let serializedPackage:
	| { configuration: string; body: string; etag: string }
	| undefined;

function packageResponse() {
	const configuration = JSON.stringify([
		process.env.S3_ENDPOINT,
		process.env.S3_BUCKET,
		process.env.S3_REGION,
	]);
	if (serializedPackage?.configuration === configuration)
		return serializedPackage;

	// Canonical data is immutable for this server process. Validate and serialize
	// it once; repeated health/app requests must not recheck every word at 0.25 CPU.
	// Storage configuration changes rebuild the URLs, and failures are never cached.
	const body = JSON.stringify(recitationPackage());
	const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
	serializedPackage = { configuration, body, etag };
	return serializedPackage;
}

export async function GET(request: Request) {
	try {
		const { body, etag } = packageResponse();
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
