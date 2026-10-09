import { getPerekByPerekId } from "@/data/perek-dto";
import { loadRecitation } from "./recitation-loader";

export function recordingUrl(perekId: number) {
	const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
	const region = process.env.S3_REGION || "il-central-1";
	const endpoint = process.env.S3_ENDPOINT;
	const base = endpoint
		? `${endpoint.replace(/\/$/, "")}/${bucket}`
		: `https://${bucket}.s3.${region}.amazonaws.com`;
	return `${base}/recordings/${perekId}_record.mp3`;
}

/** Independent app extension: only approved intervals leave the canonical DB. */
export function recitationPackage() {
	const tracks = [];
	for (let perekId = 1; perekId <= 929; perekId++) {
		const data = loadRecitation(getPerekByPerekId(perekId));
		if (!data) continue;
		tracks.push({
			perekId,
			audioUrl: recordingUrl(perekId),
			audioSha256: data.audioSha256,
			textSha256: data.textSha256,
			durationMs: data.durationMs,
			alignmentStatus: data.alignmentStatus,
			words: data.alignmentStatus === "ready" ? data.words : [],
		});
	}
	return { version: 1, tracks };
}
