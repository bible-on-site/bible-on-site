import "server-only";
import { unstable_cache } from "next/cache";
import { query } from "../api-client";
import {
	type ImageRangeRow,
	type ImageRow,
	imagesFromRows,
	type PerekIllustration,
} from "./perek-illustrations";

/** Two cached bulk queries avoid per-page queries and variant/range row multiplication. */
export const getPerekImagesByChapter = unstable_cache(
	async (): Promise<Record<number, PerekIllustration[]>> => {
		const [rows, ranges] = await Promise.all([
			query<ImageRow>(`
			SELECT i.id, i.perek_id, i.alt_text, i.caption, i.caption_markdown, i.description,
				i.credit, v.role, v.format, v.width, v.height, v.s3_key
			FROM tanah_perek_image i
			LEFT JOIN tanah_perek_image_variant v ON v.image_id = i.id
			WHERE i.is_active = 1
			ORDER BY i.perek_id, i.sort_order, i.id, v.width
		`),
			query<ImageRangeRow>(`
			SELECT r.image_id, r.perek_id, r.pasuk_from, r.pasuk_to
			FROM tanah_perek_image_range r
			JOIN tanah_perek_image i ON i.id = r.image_id
			WHERE i.is_active = 1
			ORDER BY r.image_id, r.perek_id, r.pasuk_from
		`),
		]);
		return imagesFromRows(rows, ranges);
	},
	["perek-images"],
	{ tags: ["perek-images"], revalidate: false },
);
