import "server-only";
import { unstable_cache } from "next/cache";
import { query } from "../api-client";
import {
	type ImageRow,
	imagesFromRows,
	type PerekIllustration,
} from "./perek-illustrations";

/** One cached query for all chapters avoids an extra query per SSG page. */
export const getPerekImagesByChapter = unstable_cache(
	async (): Promise<Record<number, PerekIllustration[]>> => {
		const rows = await query<ImageRow>(`
			SELECT i.id, i.perek_id, i.alt_text, i.caption, i.description,
				i.credit, v.role, v.format, v.width, v.height, v.s3_key
			FROM tanah_perek_image i
			LEFT JOIN tanah_perek_image_variant v ON v.image_id = i.id
			WHERE i.is_active = 1
			ORDER BY i.perek_id, i.sort_order, i.id, v.width
		`);
		return imagesFromRows(rows);
	},
	["perek-images"],
	{ tags: ["perek-images"], revalidate: false },
);
