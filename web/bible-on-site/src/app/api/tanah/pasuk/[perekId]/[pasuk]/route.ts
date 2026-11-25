import { toLetters } from "gematry";
import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getPerushNotesForPasuk } from "@/lib/perushim";
import { pasukPlainText } from "@/lib/tanach/pasuk-plain-text";
import {
	toPreviewHtml,
	truncatePreviewSnippet,
} from "@/lib/tanahpedia/preview-format";

const MAX_NOTE_SNIPPET_LENGTH = 500;

/** The perush's sanitized note snippet for the pasuk, or null when unavailable. */
async function perushNoteSnippet(
	perushName: string,
	perekId: number,
	pasukNum: number,
	noteIdx?: number,
): Promise<string | null> {
	const pasukNotes = await getPerushNotesForPasuk(
		perushName,
		perekId,
		pasukNum,
	);
	// A `note` param anchors the snippet at the matched hit — the combined
	// snippet truncates at MAX_NOTE_SNIPPET_LENGTH, so starting from note 0
	// could crowd out the note the link actually targets. `note` is a stored
	// noteIdx, not an array offset — perushim numbering is not guaranteed
	// gapless — so match on the field rather than position.
	const ordered =
		noteIdx == null
			? pasukNotes
			: pasukNotes.filter((n) => n.noteIdx >= noteIdx);
	if (ordered.length === 0) return null;
	const html = ordered.map((n) => n.noteContent).join("\n");
	return truncatePreviewSnippet(toPreviewHtml(html), MAX_NOTE_SNIPPET_LENGTH);
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ perekId: string; pasuk: string }> },
) {
	const { perekId: perekIdRaw, pasuk: pasukRaw } = await params;
	const perekId = Number.parseInt(perekIdRaw, 10);
	const pasukNum = Number.parseInt(pasukRaw, 10);
	if (
		!Number.isInteger(perekId) ||
		perekId < 1 ||
		perekId > 929 ||
		!Number.isInteger(pasukNum) ||
		pasukNum < 1
	) {
		return NextResponse.json(null, { status: 404 });
	}
	const perek = getPerekByPerekId(perekId);
	const pasuk = perek.pesukim[pasukNum - 1];
	if (!pasuk) {
		return NextResponse.json(null, { status: 404 });
	}
	const pasukLetters = toLetters(pasukNum);
	const searchParams = new URL(request.url).searchParams;
	const perushName = searchParams.get("perush")?.trim();
	const noteRaw = searchParams.get("note");
	const noteIdx = noteRaw ? Number.parseInt(noteRaw, 10) : undefined;
	if (perushName) {
		const noteHtml = await perushNoteSnippet(
			perushName,
			perekId,
			pasukNum,
			noteIdx,
		);
		if (noteHtml) {
			return NextResponse.json({
				reference: `${perushName} ${perek.source} ${pasukLetters}`,
				text: pasukPlainText(pasuk),
				noteHtml,
			});
		}
	}
	return NextResponse.json({
		reference: `${perek.source} ${pasukLetters}`,
		text: pasukPlainText(pasuk),
	});
}
