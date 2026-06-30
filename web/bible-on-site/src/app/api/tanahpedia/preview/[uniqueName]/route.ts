import { NextResponse } from "next/server";
import {
	toPreviewHtml,
	truncatePreviewSnippet,
} from "@/lib/tanahpedia/preview-format";
import { getEntryByUniqueName } from "@/lib/tanahpedia/service";
import { normalizedUniqueNameFromParam } from "@/lib/tanahpedia/unique-name-param";

const MAX_SNIPPET_LENGTH = 350;

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ uniqueName: string }> },
) {
	const { uniqueName } = await params;
	const entry = await getEntryByUniqueName(
		normalizedUniqueNameFromParam(uniqueName),
	);
	if (!entry) {
		return NextResponse.json(null, { status: 404 });
	}
	const snippet = truncatePreviewSnippet(
		toPreviewHtml(entry.content || ""),
		MAX_SNIPPET_LENGTH,
	);
	return NextResponse.json({
		title: entry.title,
		snippet,
	});
}
