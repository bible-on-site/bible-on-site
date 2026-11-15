import { getPerekByPerekId } from "@/data/perek-dto";
import { assetsUrl } from "./assets-url";
import { loadRecitation } from "./recitation-loader";

export function recordingUrl(perekId: number) {
	return assetsUrl(`recordings/${perekId}_record.mp3`);
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
