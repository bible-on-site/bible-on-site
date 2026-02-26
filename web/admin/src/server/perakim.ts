import { createServerFn } from "@tanstack/react-start";
import { query, queryOne } from "./db";

export interface Perek {
	id: number;
	perek_id: number | null;
	sefer_id: number | null;
	sefer_name: string | null;
	perek: number | null;
	perek_in_context: number | null;
	additional_letter: string | null;
}

const PEREK_COLUMNS =
	"id, perek_id, sefer_id, sefer_name, perek, perek_in_context, additional_letter";

// Get all perakim
export const getPerakim = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<Perek>(
			`SELECT ${PEREK_COLUMNS} FROM tanah_perek_view ORDER BY perek_id`,
		);
	},
);

// Get perek by ID
export const getPerek = createServerFn({ method: "GET" })
	.inputValidator((data: number) => data)
	.handler(async ({ data: id }) => {
		const perek = await queryOne<Perek>(
			`SELECT ${PEREK_COLUMNS} FROM tanah_perek_view WHERE perek_id = ?`,
			[id],
		);

		if (!perek) {
			throw new Error("Perek not found");
		}

		return perek;
	});
