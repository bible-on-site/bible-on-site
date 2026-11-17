import type { PoolConnection } from "mysql2/promise";
import {
	type CataloguePerek,
	cataloguePerekLabel,
} from "~/lib/article-linking/catalogue";
import { searchCataloguePerakim } from "~/lib/article-linking/perek-search";
import { txQuery, txQueryOne } from "../db";

/** Physical label dependencies only: no unrelated calendar/date joins or broad locks. */
export const CONTRIBUTION_PEREK_SELECT =
	"SELECT p.id,s.name AS seferName,a.letter AS additionalLetter,CASE WHEN a.id IS NOT NULL THEN p.id-a.perek_from+1 ELSE p.id-s.perek_id_from+1 END AS perekInContext,p.pasuk_count AS pasukCount,CONCAT(s.name,' ',CASE WHEN a.id IS NOT NULL THEN p.id-a.perek_from+1 ELSE p.id-s.perek_id_from+1 END) AS name FROM tanah_perek p JOIN tanah_sefer s ON p.id BETWEEN s.perek_id_from AND s.perek_id_to LEFT JOIN tanah_additional a ON a.sefer_id=s.id AND p.id BETWEEN a.perek_from AND a.perek_to";
export async function readAgentPerek(
	conn: PoolConnection,
	id: string | number,
	lock: boolean,
) {
	const row = await txQueryOne<CataloguePerek>(
		conn,
		`${CONTRIBUTION_PEREK_SELECT} WHERE p.id=?${lock ? " FOR UPDATE NOWAIT" : ""}`,
		[id],
	);
	return row
		? {
				id: row.id,
				name: cataloguePerekLabel(row),
				coordinates: {
					seferName: row.seferName,
					additionalLetter: row.additionalLetter,
					perekInContext: row.perekInContext,
					pasukCount: row.pasukCount,
				},
			}
		: null;
}
export async function searchAgentPerakim(conn: PoolConnection, query: string) {
	const rows = await txQuery<CataloguePerek>(
		conn,
		`${CONTRIBUTION_PEREK_SELECT} ORDER BY p.id`,
	);
	return searchCataloguePerakim(rows, query);
}
