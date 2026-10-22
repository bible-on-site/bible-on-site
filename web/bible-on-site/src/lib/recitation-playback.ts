import opus from "@/data/recitation/opus-playback.json";
import { assetsUrl } from "./assets-url";

/** MP3 identity stays canonical; this inventory describes derived playback only. */
export function opusPlayback(perekId: number, sourceSha256: string) {
	const asset = (
		opus.tracks as Record<
			string,
			{ sourceSha256: string; sha256: string; key: string }
		>
	)[String(perekId)];
	if (!asset || asset.sourceSha256 !== sourceSha256) return undefined;
	return {
		format: "ogg-opus" as const,
		bitrate: 24000,
		audioSha256: asset.sha256,
		audioUrl: assetsUrl(asset.key),
	};
}
