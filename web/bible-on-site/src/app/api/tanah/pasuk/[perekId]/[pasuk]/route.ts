import { toLetters } from "gematry";
import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getPerushimByPerekId, getPerushNotes } from "@/lib/perushim";
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
): Promise<string | null> {
	const perushim = await getPerushimByPerekId(perekId);
	const perush = perushim.find((p) => p.name === perushName);
	if (!perush) return null;
	const notes = await getPerushNotes(perush.id, perekId);
	const pasukNotes = notes.filter((n) => n.pasuk === pasukNum);
	if (pasukNotes.length === 0) return null;
	const html = pasukNotes.map((n) => n.noteContent).join("\n");
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
	const pasukLetters = toLetters(pasukNum, { addQuotes: true });
	const perushName = new URL(request.url).searchParams.get("perush")?.trim();
	if (perushName) {
		const noteHtml = await perushNoteSnippet(perushName, perekId, pasukNum);
		if (noteHtml) {
			return NextResponse.json({
				reference: `${perushName} ${perek.sefer} ${perek.perekHeb} ${pasukLetters}`,
				text: pasukPlainText(pasuk),
				noteHtml,
			});
		}
	}
	return NextResponse.json({
		reference: `${perek.sefer} ${perek.perekHeb} ${pasukLetters}`,
		text: pasukPlainText(pasuk),
	});
}
