import type { Pasuk } from "@/data/db/tanah-view-types";

export interface RecitationWord {
	pasuk: number;
	segment: number;
	text: string;
	startMs: number;
	endMs: number;
}

export interface AlignmentWord
	extends Omit<RecitationWord, "startMs" | "endMs"> {
	startMs: number | null;
	endMs: number | null;
}

export interface Recitation {
	version: 1;
	perekId: number;
	audioUrl: string;
	audioSha256: string;
	textSha256: string;
	durationMs: number;
	alignmentStatus: "pending" | "needs_review" | "ready";
	words: AlignmentWord[];
}

function validAudioUrl(value: string, perekId: number) {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "https:" ||
				(url.protocol === "http:" &&
					["localhost", "127.0.0.1"].includes(url.hostname))) &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			url.pathname.endsWith(`/recordings/${perekId}_record.mp3`)
		);
	} catch {
		return false;
	}
}

/** Every spoken canonical segment must occur exactly once, even while pending. */
export function parseRecitation(
	value: unknown,
	perekId: number,
	pesukim: Pasuk[],
): Recitation {
	const data = value as Recitation;
	if (
		data?.version !== 1 ||
		typeof data.audioSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.audioSha256) ||
		typeof data.textSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.textSha256) ||
		data.perekId !== perekId ||
		!Number.isSafeInteger(data.durationMs) ||
		data.durationMs <= 0 ||
		!Array.isArray(data.words) ||
		!["pending", "needs_review", "ready"].includes(data.alignmentStatus) ||
		typeof data.audioUrl !== "string" ||
		!validAudioUrl(data.audioUrl, perekId)
	)
		throw new Error("Invalid recitation manifest");
	const expected = pesukim.flatMap((verse, p) =>
		verse.segments.flatMap((segment, s) =>
			segment.type === "qri" && /[א-ת]/.test(segment.value)
				? [{ pasuk: p + 1, segment: s + 1, text: segment.value }]
				: [],
		),
	);
	if (data.words.length !== expected.length)
		throw new Error("Incomplete recitation chapter");
	let previousEnd = 0;
	for (const [index, word] of data.words.entries()) {
		const source = expected[index];
		if (
			!word ||
			word.pasuk !== source.pasuk ||
			word.segment !== source.segment ||
			word.text !== source.text
		)
			throw new Error("Recitation must preserve every canonical word in order");
		if (
			word.startMs === null &&
			word.endMs === null &&
			data.alignmentStatus !== "ready"
		)
			continue;
		if (
			typeof word.startMs !== "number" ||
			typeof word.endMs !== "number" ||
			!Number.isSafeInteger(word.startMs) ||
			!Number.isSafeInteger(word.endMs) ||
			word.startMs < 0 ||
			word.endMs <= word.startMs ||
			word.endMs > data.durationMs ||
			(data.alignmentStatus === "ready" && word.startMs < previousEnd)
		)
			throw new Error("Invalid recitation word timing");
		previousEnd = word.endMs;
	}
	return data;
}

/** Candidates may be inspected, but only a fully accepted chapter is playable. */
export function playableWords(data: Recitation | null): RecitationWord[] {
	return data?.alignmentStatus === "ready"
		? (data.words as RecitationWord[])
		: [];
}

export function verseRange(words: RecitationWord[], pasuk: number) {
	const verse = words.filter((word) => word.pasuk === pasuk);
	return verse.length
		? { startMs: verse[0].startMs, endMs: verse[verse.length - 1].endMs }
		: null;
}
