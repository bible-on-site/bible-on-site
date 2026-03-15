import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "../db";

export interface TanahpediaPerson {
	id: string;
	name: string;
	sex: string | null;
	birth_date: number | null;
	death_date: number | null;
}

export const getPersons = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<TanahpediaPerson>(
			`SELECT p.id, pn.name, ps.sex, pb.birth_date, pd.death_date
			 FROM tanahpedia_person p
			 LEFT JOIN tanahpedia_person_name pn ON pn.person_id = p.id
			   AND pn.name_type_id = (SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1)
			 LEFT JOIN tanahpedia_person_sex ps ON ps.person_id = p.id
			 LEFT JOIN tanahpedia_person_birth_date pb ON pb.person_id = p.id
			 LEFT JOIN tanahpedia_person_death_date pd ON pd.person_id = p.id
			 ORDER BY pn.name`,
		);
	},
);

export const getPerson = createServerFn({ method: "GET" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		const person = await queryOne<TanahpediaPerson>(
			`SELECT p.id, pn.name, ps.sex, pb.birth_date, pd.death_date
			 FROM tanahpedia_person p
			 LEFT JOIN tanahpedia_person_name pn ON pn.person_id = p.id
			   AND pn.name_type_id = (SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1)
			 LEFT JOIN tanahpedia_person_sex ps ON ps.person_id = p.id
			 LEFT JOIN tanahpedia_person_birth_date pb ON pb.person_id = p.id
			 LEFT JOIN tanahpedia_person_death_date pd ON pd.person_id = p.id
			 WHERE p.id = ?`,
			[id],
		);
		if (!person) throw new Error("Person not found");
		return person;
	});

export const createPerson = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			id: string;
			name: string;
			name_id: string;
			name_type_id: string;
			sex?: string;
			sex_id?: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		await execute("INSERT INTO tanahpedia_person (id) VALUES (?)", [data.id]);
		await execute(
			"INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id) VALUES (?, ?, ?, ?)",
			[data.name_id, data.id, data.name, data.name_type_id],
		);
		if (data.sex && data.sex_id) {
			await execute(
				"INSERT INTO tanahpedia_person_sex (id, person_id, sex) VALUES (?, ?, ?)",
				[data.sex_id, data.id, data.sex],
			);
		}
		return { id: data.id };
	});

export const deletePerson = createServerFn({ method: "POST" })
	.inputValidator((data: string) => data)
	.handler(async ({ data: id }) => {
		await execute("DELETE FROM tanahpedia_person WHERE id = ?", [id]);
		return { success: true };
	});
