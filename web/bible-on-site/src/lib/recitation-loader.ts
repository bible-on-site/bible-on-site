import { createHash } from "node:crypto";
import type { PerekObj } from "@/data/perek-dto";
import { parseRecitation } from "./recitation";

function milliseconds(value: string): number {
	if (
		typeof value !== "string" ||
		!/^\d{2}:[0-5]\d:[0-5]\d(?:\.\d{3})?$/.test(value)
	)
		throw new Error("Invalid recording timestamp");
	const [hours, minutes, seconds] = value.split(":");
	return Math.round(
		(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000,
	);
}

/** Read recording metadata and timings directly from the canonical perakim DB. */
export function loadRecitation(
	perek: Pick<PerekObj, "perekId" | "pesukim" | "recitation">,
) {
	if (!perek.recitation) return null;
	const words = perek.pesukim.flatMap((verse, p) =>
		verse.segments.flatMap((segment, s) => {
			if (segment.type !== "qri" || !/[א-ת]/.test(segment.value)) return [];
			const start = milliseconds(segment.recordingTimeFrame.from);
			const end = milliseconds(segment.recordingTimeFrame.to);
			return [
				{
					pasuk: p + 1,
					segment: s + 1,
					text: segment.value,
					startMs: end > start ? start : null,
					endMs: end > start ? end : null,
				},
			];
		}),
	);
	const hash = createHash("sha256")
		.update(words.map((w) => `${w.pasuk}:${w.segment}:${w.text}`).join("\n"))
		.digest("hex");
	if (hash !== perek.recitation.textSha256)
		throw new Error("Canonical text changed after alignment");
	return parseRecitation(
		{ ...perek.recitation, perekId: perek.perekId, words },
		perek.perekId,
		perek.pesukim,
	);
}
