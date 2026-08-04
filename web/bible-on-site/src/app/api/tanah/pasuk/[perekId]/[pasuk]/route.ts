import { toLetters } from "gematry";
import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";
import { pasukPlainText } from "@/lib/tanach/pasuk-plain-text";

export async function GET(
	_request: Request,
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
	return NextResponse.json({
		reference: `${perek.sefer} ${perek.perekHeb} ${toLetters(pasukNum, { addQuotes: true })}`,
		text: pasukPlainText(pasuk),
	});
}
