import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pasuk } from "@/data/db/tanah-view-types";
import { parseRecitation } from "./recitation";

/** The original public URL is retained for canonical structured data. */
export async function loadRecitation(perekId: number, pesukim: Pasuk[]) {
	try {
		const raw = await readFile(
			path.join(process.cwd(), "public", "recitation", `${perekId}.json`),
			"utf8",
		);
		return parseRecitation(JSON.parse(raw), perekId, pesukim);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
