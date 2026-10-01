import { getPerekByPerekId } from "@/data/perek-dto";
import { loadRecitation } from "@/lib/recitation-loader";

/** Resolve audio through the same S3/RustFS settings as the rest of the site. */
export async function GET(
	_request: Request,
	context: { params: Promise<{ perekId: string }> },
) {
	const { perekId: rawId } = await context.params;
	if (!/^[1-9]\d{0,2}$/.test(rawId) || Number(rawId) > 929) {
		return Response.json({ error: "Invalid perek" }, { status: 400 });
	}
	const perekId = Number(rawId);
	try {
		const data = await loadRecitation(
			perekId,
			getPerekByPerekId(perekId).pesukim,
		);
		if (!data)
			return Response.json({ error: "Recording unavailable" }, { status: 404 });
		const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
		const region = process.env.S3_REGION || "il-central-1";
		const endpoint = process.env.S3_ENDPOINT;
		const base = endpoint
			? `${endpoint.replace(/\/$/, "")}/${bucket}`
			: `https://${bucket}.s3.${region}.amazonaws.com`;
		return Response.json(
			{ ...data, audioUrl: `${base}/recordings/${perekId}_record.mp3` },
			{
				headers: { "Cache-Control": "public, max-age=300" },
			},
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return Response.json({ error: "Recording unavailable" }, { status: 404 });
		}
		console.error("Recitation metadata could not be loaded", error);
		return Response.json(
			{ error: "Recording metadata unavailable" },
			{ status: 500 },
		);
	}
}
