import opus from "@/data/recitation/opus-playback.json";

/** MP3 identity stays canonical; this inventory describes derived playback only. */
export function opusPlayback(perekId: number, sourceSha256: string) {
	const asset = (
		opus.tracks as Record<
			string,
			{ sourceSha256: string; sha256: string; key: string }
		>
	)[String(perekId)];
	if (!asset || asset.sourceSha256 !== sourceSha256) return undefined;
	const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
	const region = process.env.S3_REGION || "il-central-1";
	const endpoint = process.env.S3_ENDPOINT;
	const base = endpoint
		? `${endpoint.replace(/\/$/, "")}/${bucket}`
		: `https://${bucket}.s3.${region}.amazonaws.com`;
	return {
		format: "ogg-opus" as const,
		bitrate: 24000,
		audioSha256: asset.sha256,
		audioUrl: `${base}/${asset.key}`,
	};
}
