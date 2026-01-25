import { createServerFn } from "@tanstack/react-start";
import { query } from "./db";

export interface Sefer {
	id: number;
	name: string;
	tanach_us_name: string | null;
}

// Get all sefarim
export const getSefarim = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<Sefer>(
			"SELECT id, name, tanach_us_name FROM tanah_sefer ORDER BY id",
		);
	},
);
