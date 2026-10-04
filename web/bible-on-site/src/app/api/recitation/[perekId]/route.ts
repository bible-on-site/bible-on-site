import { getPerekByPerekId } from "@/data/perek-dto";
import { loadRecitation } from "@/lib/recitation-loader";
import { recordingUrl } from "@/lib/recitation-package";
import packageJson from "../../../../../package.json";

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
		const data = loadRecitation(getPerekByPerekId(perekId));
		if (!data)
			return Response.json({ error: "Recording unavailable" }, { status: 404 });
		return Response.json(
			{ ...data, audioUrl: recordingUrl(perekId) },
			{
				headers: {
					"Cache-Control": "public, max-age=300",
					"X-Website-Version": packageJson.version,
				},
			},
		);
	} catch (error) {
		console.error("Recitation metadata could not be loaded", error);
		return Response.json(
			{ error: "Recording metadata unavailable" },
			{ status: 500 },
		);
	}
}
