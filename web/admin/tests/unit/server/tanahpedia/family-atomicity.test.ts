import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const driver = vi.hoisted(() => ({
	persisted: {} as Tables,
	pending: null as Tables | null,
	writeCount: 0,
	failAtWrite: 0,
	failCommit: false,
	connection: {
		execute: vi.fn(),
		beginTransaction: vi.fn(),
		commit: vi.fn(),
		rollback: vi.fn(),
		release: vi.fn(),
	},
	poolExecute: vi.fn(),
	invalidate: vi.fn(),
	paths: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
	default: {
		createPool: () => ({
			execute: driver.poolExecute,
			getConnection: async () => driver.connection,
		}),
	},
}));
vi.mock("~/server/db-config", () => ({
	resolveMysqlUrl: () => "mysql://test:test@localhost/test?ssl-mode=DISABLED",
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: driver.invalidate,
}));
vi.mock("~/server/tanahpedia/paths", () => ({
	pediaInvalidationForEntities: driver.paths,
	pediaInvalidationForEntryIds: driver.paths,
	pediaInvalidationForPersons: driver.paths,
}));

// Use the real db.transaction and tx helpers; only the MySQL driver is replaced.
import {
	createFamilyPersonNode,
	createPersonName,
	deleteFamilyPersonNode,
	updateFamilyPersonNode,
	updatePersonName,
} from "~/server/tanahpedia/family";

function initialTables(): Tables {
	return {
		tanahpedia_lookup_name_type: [
			{ id: "main", name: "MAIN" },
			{ id: "additional", name: "ADDITIONAL" },
		],
		tanahpedia_god: [{ id: "god" }],
		tanahpedia_entity: [{ id: "entity", entity_type: "PERSON", name: "Jacob" }],
		tanahpedia_person: [{ id: "person", entity_id: "entity" }],
		tanahpedia_person_name: [
			{ id: "name", person_id: "person", name: "Jacob", name_type_id: "main" },
		],
		tanahpedia_person_sex: [{ id: "sex", person_id: "person", sex: "MALE" }],
		tanahpedia_person_birth_date: [],
		tanahpedia_person_death_date: [],
		tanahpedia_person_death_cause: [],
		tanahpedia_person_birth_place: [],
		tanahpedia_person_role_prophet: [],
		tanahpedia_person_role_king: [],
		tanahpedia_entry_entity: [
			{ id: "entry-link", entry_id: "entry", entity_id: "entity" },
		],
		tanahpedia_person_union: [
			{ id: "union", person1_id: "person", person2_id: "other" },
		],
		tanahpedia_person_parent_child: [
			{ id: "parent-link", parent_id: "person", child_id: "child" },
		],
		tanahpedia_person_name_giver_person: [
			{
				id: "giver-link",
				person_name_id: "name",
				giver_person_id: "old-giver",
			},
		],
		tanahpedia_person_name_giver_god: [],
	};
}

/** Evaluate the equality predicates used by these parameterized mutations. */
function predicate(where: string | undefined, params: unknown[]) {
	if (!where) return () => true;
	let index = 0;
	const alternatives = where.split(" OR ").map((alternative) =>
		alternative.split(" AND ").map((part) => {
			const match = /^(\w+) = (\?|'[^']*')$/.exec(part);
			if (!match) throw new Error(`Unsupported test predicate: ${part}`);
			return {
				key: match[1],
				value: match[2] === "?" ? params[index++] : match[2].slice(1, -1),
			};
		}),
	);
	return (row: Row) =>
		alternatives.some((terms) =>
			terms.every(({ key, value }) => row[key] === value),
		);
}

/** Staged rows model a dedicated MySQL transaction, with no autocommit escape. */
async function connectionExecute(rawSql: string, params: unknown[]) {
	const tables = driver.pending;
	if (!tables) throw new Error("SQL escaped its transaction");
	const sql = rawSql
		.replace(/\s+/g, " ")
		.trim()
		.replace(/ LIMIT 1$/, "");
	const read = /^SELECT .+? FROM (\w+)(?: WHERE (.+))?$/.exec(sql);
	if (read) return [tables[read[1]].filter(predicate(read[2], params)), []];

	driver.writeCount++;
	if (driver.writeCount === driver.failAtWrite)
		throw new Error("Interrupted write");
	const insert = /^INSERT INTO (\w+) \((.+)\) VALUES \((.+)\)$/.exec(sql);
	if (insert) {
		let index = 0;
		const values = insert[3]
			.split(", ")
			.map((token) =>
				token === "?"
					? params[index++]
					: token === "NULL"
						? null
						: token.slice(1, -1),
			);
		tables[insert[1]].push(
			Object.fromEntries(
				insert[2].split(", ").map((key, i) => [key, values[i]]),
			),
		);
		return [{ affectedRows: 1 }, []];
	}
	const update = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(sql);
	if (update) {
		const keys = update[2].split(", ").map((set) => set.split(" = ")[0]);
		const rows = tables[update[1]].filter(
			predicate(update[3], params.slice(keys.length)),
		);
		for (const row of rows)
			keys.forEach((key, i) => {
				row[key] = params[i];
			});
		return [{ affectedRows: rows.length }, []];
	}
	const deletion = /^DELETE FROM (\w+) WHERE (.+)$/.exec(sql);
	if (deletion) {
		const before = tables[deletion[1]];
		tables[deletion[1]] = before.filter(
			(row) => !predicate(deletion[2], params)(row),
		);
		return [{ affectedRows: before.length - tables[deletion[1]].length }, []];
	}
	throw new Error(`Unsupported test SQL: ${sql}`);
}

beforeEach(() => {
	vi.resetAllMocks();
	driver.persisted = initialTables();
	driver.pending = null;
	driver.writeCount = 0;
	driver.failAtWrite = 0;
	driver.failCommit = false;
	driver.poolExecute.mockImplementation(() => {
		throw new Error("Unexpected pool SQL outside dedicated connection");
	});
	driver.connection.beginTransaction.mockImplementation(async () => {
		driver.pending = structuredClone(driver.persisted);
	});
	driver.connection.execute.mockImplementation(connectionExecute);
	driver.connection.commit.mockImplementation(async () => {
		if (driver.failCommit) throw new Error("Commit failed");
		if (!driver.pending) throw new Error("No transaction to commit");
		driver.persisted = driver.pending;
		driver.pending = null;
	});
	driver.connection.rollback.mockImplementation(async () => {
		driver.pending = null;
	});
	driver.paths.mockImplementation(async () => {
		expect(driver.pending).toBeNull();
		return [];
	});
	driver.invalidate.mockImplementation(async () => {
		expect(driver.pending).toBeNull();
		expect(driver.connection.commit).toHaveBeenCalledOnce();
		expect(driver.connection.release).toHaveBeenCalledOnce();
	});
});

function expectRolledBack(before: Tables) {
	expect(driver.persisted).toEqual(before);
	expect(driver.pending).toBeNull();
	expect(driver.connection.rollback).toHaveBeenCalledOnce();
	expect(driver.connection.release).toHaveBeenCalledOnce();
	expect(driver.invalidate).not.toHaveBeenCalled();
	expect(driver.poolExecute).not.toHaveBeenCalled();
}

const fullPerson = {
	displayName: "Israel",
	sex: "MALE" as const,
	birthDate: -2000,
	deathDate: -1850,
	deathCause: "old age",
	birthPlaceId: "place",
	isProphet: true,
	isKing: true,
	linkToEntryId: "entry",
};

describe("family mutation atomicity", () => {
	it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
		"rolls back every created person row when write %i fails",
		async (write) => {
			const before = structuredClone(driver.persisted);
			driver.failAtWrite = write;
			await expect(
				createFamilyPersonNode({ data: fullPerson }),
			).rejects.toThrow("Interrupted write");
			expect(driver.writeCount).toBe(write);
			expectRolledBack(before);
		},
	);

	it("restores names, sex, facts and roles when a later person update fails", async () => {
		const before = structuredClone(driver.persisted);
		driver.failAtWrite = 9;
		await expect(
			updateFamilyPersonNode({ data: { ...fullPerson, entityId: "entity" } }),
		).rejects.toThrow("Interrupted write");
		expect(driver.writeCount).toBe(9);
		expectRolledBack(before);
	});

	it("restores deleted relationships and names when the final entity delete fails", async () => {
		const before = structuredClone(driver.persisted);
		driver.failAtWrite = 7;
		await expect(
			deleteFamilyPersonNode({ data: { entityId: "entity" } }),
		).rejects.toThrow("Interrupted write");
		expect(driver.writeCount).toBe(7);
		expectRolledBack(before);
	});

	it.each([false, true])(
		"rolls back a new name if its giver insert fails (God-given: %s)",
		async (isGodGiven) => {
			const before = structuredClone(driver.persisted);
			driver.failAtWrite = 2;
			await expect(
				createPersonName({
					data: {
						personId: "person",
						name: "Israel",
						nameType: "ADDITIONAL",
						...(isGodGiven ? { isGodGiven: true } : { giverPersonId: "giver" }),
					},
				}),
			).rejects.toThrow("Interrupted write");
			expectRolledBack(before);
		},
	);

	it.each([false, true])(
		"restores the prior name and giver if replacement fails (God-given: %s)",
		async (isGodGiven) => {
			const before = structuredClone(driver.persisted);
			driver.failAtWrite = 4;
			await expect(
				updatePersonName({
					data: {
						id: "name",
						name: "Israel",
						...(isGodGiven
							? { isGodGiven: true }
							: { giverPersonId: "new-giver" }),
					},
				}),
			).rejects.toThrow("Interrupted write");
			expectRolledBack(before);
		},
	);

	it("does not invalidate when commit fails", async () => {
		const before = structuredClone(driver.persisted);
		driver.failCommit = true;
		await expect(createFamilyPersonNode({ data: fullPerson })).rejects.toThrow(
			"Commit failed",
		);
		expectRolledBack(before);
	});

	it("publishes only fully committed person rows before invalidating", async () => {
		const result = await createFamilyPersonNode({ data: fullPerson });
		expect(driver.persisted.tanahpedia_entity).toContainEqual({
			id: result.entityId,
			entity_type: "PERSON",
			name: "Israel",
		});
		expect(driver.persisted.tanahpedia_person).toContainEqual({
			id: result.personId,
			entity_id: result.entityId,
		});
		expect(driver.persisted.tanahpedia_entry_entity).toContainEqual({
			id: result.linkId,
			entry_id: "entry",
			entity_id: result.entityId,
		});
		expect(driver.connection.rollback).not.toHaveBeenCalled();
		expect(driver.invalidate).toHaveBeenCalledOnce();
		expect(driver.poolExecute).not.toHaveBeenCalled();
	});

	it("commits a name and its replacement giver before invalidating", async () => {
		await updatePersonName({
			data: { id: "name", name: "Israel", isGodGiven: true },
		});
		expect(driver.persisted.tanahpedia_person_name[0].name).toBe("Israel");
		expect(driver.persisted.tanahpedia_person_name_giver_person).toEqual([]);
		expect(driver.persisted.tanahpedia_person_name_giver_god).toHaveLength(1);
		expect(driver.invalidate).toHaveBeenCalledOnce();
	});

	it("keeps the committed data if the later network invalidation fails", async () => {
		driver.invalidate.mockRejectedValueOnce(new Error("Network unavailable"));
		await expect(
			updatePersonName({ data: { id: "name", name: "Israel" } }),
		).rejects.toThrow("Network unavailable");
		expect(driver.persisted.tanahpedia_person_name[0].name).toBe("Israel");
		expect(driver.connection.commit).toHaveBeenCalledOnce();
		expect(driver.connection.rollback).not.toHaveBeenCalled();
		expect(driver.pending).toBeNull();
	});
});
