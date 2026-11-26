import type { PoolConnection } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	executeMock,
	queryMock,
	queryOneMock,
	randomUUIDMock,
	revalidateWebsiteMock,
} = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
	randomUUIDMock: vi.fn(() => "fixed-uuid"),
	revalidateWebsiteMock: vi.fn(async () => true),
}));

vi.mock("node:crypto", async (importOriginal) => ({
	...(await importOriginal<object>()),
	randomUUID: randomUUIDMock,
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

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
	transaction: <T>(fn: (conn: PoolConnection) => Promise<T>) =>
		fn({} as PoolConnection),
	txExecute: (_conn: PoolConnection, ...args: unknown[]) =>
		executeMock(...args),
	txQueryOne: (_conn: PoolConnection, ...args: unknown[]) =>
		queryOneMock(...args),
}));

// Keep the queue implementation available to the rest of the suite while
// making each write's invocation/skip decision directly observable here.
vi.mock("~/server/website-revalidate", async (importOriginal) => ({
	...(await importOriginal<object>()),
	revalidateWebsite: revalidateWebsiteMock,
}));

// The revalidation surface queries the db for paths; keeping it out of the
// query-mock queue leaves query responses for the function under test.
vi.mock("~/server/tanahpedia/paths", () => ({
	pediaChangesForEntryIds: vi.fn(async (ids: string[]) =>
		ids.length
			? [
					{
						changes: ids.map((id) => ({
							kind: "pedia-entry",
							uniqueName: id,
							entityTypes: [],
							synonymNames: [],
							refPerekIds: [],
						})),
					},
				]
			: [],
	),
	pediaChangesForEntities: vi.fn(async (ids: string[]) =>
		ids.length
			? [
					{
						changes: ids.map((id) => ({
							kind: "pedia-entity",
							entityId: id,
							entryUniqueNames: [],
							refPerekIds: [],
						})),
					},
				]
			: [],
	),
	pediaChangesForPersons: vi.fn(async () => []),
}));

import {
	clearPrimaryImage,
	deleteImageAsset,
	getEntryImageBundle,
	putImageAsset,
	putImageLink,
	removeImageLink,
} from "~/server/tanahpedia/images";
import { __resetRevalidateForTests } from "~/server/website-revalidate";

const ASSET_ROW = {
	imageId: "img-1",
	url: "https://cdn.example.com/a.jpg",
	width: 800,
	height: 600,
	altText: "תיאור",
	caption: "כיתוב",
	creator: "יוצר",
	creditLine: "קרדיט",
	sourceName: "Wikimedia Commons",
	sourceUrl: "https://commons.example.com/f.jpg",
	licenseName: "CC BY-SA 4.0",
	licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
	isPublicDomain: 0,
	modifications: null,
	permissionEvidence: "evidence",
	isPublic: 1,
	revision: 3,
};

const LINK_ROW = {
	id: "link-1",
	ownerId: "owner-1",
	sortOrder: 0,
	isPrimary: 1,
	...ASSET_ROW,
};

describe("tanahpedia images api (#3769)", () => {
	beforeEach(() => {
		__resetRevalidateForTests();
		executeMock.mockReset().mockResolvedValue({ affectedRows: 1 });
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		randomUUIDMock.mockClear().mockReturnValue("fixed-uuid");
		revalidateWebsiteMock.mockReset().mockResolvedValue(true);
	});

	it("bundles entry links and a group per linked entity", async () => {
		queryMock
			// linkRows(ENTRY)
			.mockResolvedValueOnce([LINK_ROW])
			// entities of the entry
			.mockResolvedValueOnce([
				{ entityId: "en-1", entityType: "PERSON", entityName: "אברהם" },
				{ entityId: "en-2", entityType: "PLACE", entityName: "חברון" },
			])
			// entity image rows joined through entry_entity
			.mockResolvedValueOnce([
				{ ...LINK_ROW, id: "link-2", ownerId: "en-1", entityType: "PERSON", entityName: "אברהם" },
			]);

		const bundle = await getEntryImageBundle({ data: "entry-1" });

		expect(bundle.entryLinks).toHaveLength(1);
		expect(bundle.entryLinks[0].ownerKind).toBe("ENTRY");
		expect(bundle.entryLinks[0].isPrimary).toBe(true);
		expect(bundle.entityGroups).toHaveLength(2);
		const group = bundle.entityGroups.find((g) => g.entityId === "en-1");
		expect(group?.entityName).toBe("אברהם");
		expect(group?.links).toHaveLength(1);
		expect(group?.links[0].ownerKind).toBe("ENTITY");
		expect(group?.links[0].image.imageId).toBe("img-1");
		// An entity with no links still gets a group so the panel offers attach.
		expect(
			bundle.entityGroups.find((g) => g.entityId === "en-2")?.links,
		).toEqual([]);
	});

	it("reads an empty bundle while the image tables are undeployed", async () => {
		queryMock.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });

		await expect(getEntryImageBundle({ data: "entry-1" })).resolves.toEqual({
			entryLinks: [],
			entityGroups: [],
		});
	});

	it("validates required asset fields before writing", async () => {
		await expect(
			putImageAsset({ data: { url: " ", altText: "alt" } }),
		).rejects.toThrow("VALIDATION");
		await expect(
			putImageAsset({ data: { url: "u", altText: "" } }),
		).rejects.toThrow("VALIDATION");
		// Publishing requires recorded permission/public-domain evidence.
		await expect(
			putImageAsset({
				data: { url: "u", altText: "a", isPublic: true },
			}),
		).rejects.toThrow("VALIDATION");
		// An update id that matches no row is a validation error, not an insert.
		queryOneMock.mockResolvedValueOnce(null);
		await expect(
			putImageAsset({
				data: { id: "ghost", url: "u", altText: "a" },
			}),
		).rejects.toThrow("VALIDATION");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("inserts a new asset, resolves owners for revalidation, returns the row", async () => {
		queryMock
			// assetOwners: entry links then entity links
			.mockResolvedValueOnce([{ entry_id: "entry-1" }])
			.mockResolvedValueOnce([{ entity_id: "en-1" }]);
		queryOneMock.mockResolvedValueOnce(ASSET_ROW);

		const asset = await putImageAsset({
			data: {
				url: " https://cdn.example.com/a.jpg ",
				altText: "תיאור",
				isPublic: true,
				permissionEvidence: "evidence",
			},
		});

		expect(executeMock).toHaveBeenCalledTimes(1);
		const [sql, params] = executeMock.mock.calls[0];
		expect(sql).toContain("INSERT INTO tanahpedia_image");
		expect(params[0]).toBe("fixed-uuid");
		// is_public flag rides last in the column list.
		expect(params.at(-1)).toBe(1);
		expect(asset.imageId).toBe("img-1");
		expect(asset.isPublic).toBe(true);
		expect(asset.permissionEvidence).toBe("evidence");
	});

	it("updates an existing asset with the current revision and increments it", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "img-1", revision: 7 }) // existing check
			.mockResolvedValueOnce(ASSET_ROW); // re-read
		queryMock.mockResolvedValue([]);

		await putImageAsset({
			data: { id: "img-1", url: "u", altText: "a", revision: 7 },
		});

		expect(executeMock).toHaveBeenCalledTimes(1);
		const [sql, params] = executeMock.mock.calls[0];
		expect(sql).toContain("UPDATE tanahpedia_image");
		expect(sql).toContain("revision = revision + 1");
		expect(sql).toContain("WHERE id = ? AND revision = ?");
		expect(params.slice(-2)).toEqual(["img-1", 7]);
	});

	it("rejects a stale asset revision before any write", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "img-1", revision: 8 });

		await expect(
			putImageAsset({
				data: { id: "img-1", url: "u", altText: "a", revision: 7 },
			}),
		).rejects.toThrow("התמונה נערכה במקום אחר");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects an update when the revision guard loses a concurrent-write race", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "img-1", revision: 7 });
		executeMock.mockResolvedValueOnce({ affectedRows: 0 });

		await expect(
			putImageAsset({
				data: { id: "img-1", url: "u", altText: "a", revision: 7 },
			}),
		).rejects.toThrow("התמונה נערכה במקום אחר");
		expect(queryMock).not.toHaveBeenCalled();
	});

	it("deletes an asset and reports whether a row went away", async () => {
		queryMock.mockResolvedValue([]);
		executeMock.mockResolvedValueOnce({ affectedRows: 1 });
		await expect(deleteImageAsset({ data: "img-1" })).resolves.toEqual({
			deleted: true,
		});

		executeMock.mockResolvedValueOnce({ affectedRows: 0 });
		await expect(deleteImageAsset({ data: "img-1" })).resolves.toEqual({
			deleted: false,
		});
	});

	it("rejects link writes with blank owner or missing image on attach", async () => {
		await expect(
			putImageLink({
				data: { ownerKind: "ENTRY", ownerId: " ", imageId: "img" },
			}),
		).rejects.toThrow("VALIDATION");
		await expect(
			putImageLink({
				data: { ownerKind: "ENTITY", ownerId: "en-1", imageId: "" },
			}),
		).rejects.toThrow("VALIDATION");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("attaches with the next sort order and clears sibling primaries", async () => {
		queryOneMock
			// assertOwnerExists → entity row
			.mockResolvedValueOnce({ id: "en-1" })
			// attach: image asset must exist
			.mockResolvedValueOnce({ id: "img-1" })
			// MAX(sort_order) + 1
			.mockResolvedValueOnce({ next: 3 });
		// linkRows re-read after commit
		queryMock.mockResolvedValueOnce([
			{ ...LINK_ROW, id: "fixed-uuid", ownerId: "en-1" },
		]);

		const link = await putImageLink({
			data: {
				ownerKind: "ENTITY",
				ownerId: "en-1",
				imageId: "img-1",
				isPrimary: true,
			},
		});

		// The incumbent primary clears before INSERT: the generated unique
		// index rejects even a transient second primary.
		expect(executeMock).toHaveBeenCalledTimes(2);
		expect(executeMock.mock.calls[0][0]).toContain("is_primary = 0");
		const [insertSql, insertParams] = executeMock.mock.calls[1];
		expect(insertSql).toContain("INSERT INTO tanahpedia_entity_image");
		expect(insertParams).toEqual(["fixed-uuid", "en-1", "img-1", 3, 1]);
		expect(link.id).toBe("fixed-uuid");
		expect(link.ownerKind).toBe("ENTITY");
	});

	it("updates an existing link and errors when the row is gone", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "entry-1" });
		queryMock.mockResolvedValueOnce([LINK_ROW]);

		const link = await putImageLink({
			data: {
				id: "link-1",
				ownerKind: "ENTRY",
				ownerId: "entry-1",
				sortOrder: 4,
			},
		});

		expect(link.id).toBe("link-1");
		// Update must not check the image table or compute a MAX.
		expect(executeMock).toHaveBeenCalledTimes(1);

		queryOneMock.mockResolvedValueOnce({ id: "entry-1" });
		executeMock.mockResolvedValueOnce({ affectedRows: 0 });
		await expect(
			putImageLink({
				data: { id: "ghost", ownerKind: "ENTRY", ownerId: "entry-1" },
			}),
		).rejects.toThrow("VALIDATION");
	});

	it("stores null license fields when the asset is public domain", async () => {
		queryMock.mockResolvedValue([]);
		queryOneMock.mockResolvedValueOnce({ ...ASSET_ROW, isPublicDomain: 1 });

		await putImageAsset({
			data: {
				url: "u",
				altText: "a",
				isPublicDomain: true,
				licenseName: "CC BY-SA 4.0",
				licenseUrl: "https://x",
			},
		});

		const [, params] = executeMock.mock.calls[0];
		// license_name, license_url positions in the INSERT column order
		expect(params[10]).toBeNull();
		expect(params[11]).toBeNull();
		expect(params[12]).toBe(1);
	});

	it("fails when the written asset cannot be read back", async () => {
		queryMock.mockResolvedValue([]);
		queryOneMock.mockResolvedValueOnce(null);

		await expect(
			putImageAsset({ data: { url: "u", altText: "a" } }),
		).rejects.toThrow("Image asset disappeared after write");
	});

	it("rejects attaching an image asset that does not exist", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "entry-1" }) // owner exists
			.mockResolvedValueOnce(null); // image missing

		await expect(
			putImageLink({
				data: { ownerKind: "ENTRY", ownerId: "entry-1", imageId: "ghost" },
			}),
		).rejects.toThrow("התמונה לא נמצאה");
	});

	it("rejects a link write whose owner row is missing", async () => {
		queryOneMock.mockResolvedValueOnce(null); // assertOwnerExists finds nothing

		await expect(
			putImageLink({
				data: { ownerKind: "ENTITY", ownerId: "ghost", imageId: "img" },
			}),
		).rejects.toThrow("הישות לא נמצאה");
	});

	it("falls back to sort order 0 when the owner has no links", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "en-1" }) // owner
			.mockResolvedValueOnce({ id: "img-1" }) // image
			.mockResolvedValueOnce(null); // MAX(sort_order) + 1 → null → 0
		queryMock.mockResolvedValueOnce([
			{ ...LINK_ROW, id: "fixed-uuid", ownerId: "en-1", sortOrder: 0 },
		]);

		await putImageLink({
			data: { ownerKind: "ENTITY", ownerId: "en-1", imageId: "img-1" },
		});

		const [insertSql, insertParams] = executeMock.mock.calls[0];
		expect(insertSql).toContain("INSERT INTO tanahpedia_entity_image");
		expect(insertParams[3]).toBe(0);
	});

	it("fails when the written link cannot be read back", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "entry-1" });
		queryMock.mockResolvedValueOnce([]); // linkRows → nothing matches

		await expect(
			putImageLink({
				data: {
					id: "link-1",
					ownerKind: "ENTRY",
					ownerId: "entry-1",
					sortOrder: 1,
				},
			}),
		).rejects.toThrow("Image link disappeared after write");
	});

	it("skips revalidation when a link remove clears nothing or loses its owner", async () => {
		queryOneMock.mockResolvedValueOnce({ ownerId: "en-1" });
		executeMock.mockResolvedValueOnce({ affectedRows: 0 });
		await expect(
			removeImageLink({ data: { ownerKind: "ENTITY", id: "ghost" } }),
		).resolves.toEqual({ removed: false });
		expect(revalidateWebsiteMock).not.toHaveBeenCalled();

		queryOneMock.mockResolvedValueOnce(null); // owner row not resolvable
		executeMock.mockResolvedValueOnce({ affectedRows: 1 });
		await expect(
			removeImageLink({ data: { ownerKind: "ENTITY", id: "link-9" } }),
		).resolves.toEqual({ removed: true });
		expect(revalidateWebsiteMock).not.toHaveBeenCalled();
	});

	it("reports cleared:false when no primary was set", async () => {
		executeMock.mockResolvedValueOnce({ affectedRows: 0 });
		await expect(
			clearPrimaryImage({
				data: { ownerKind: "ENTRY", ownerId: "entry-1" },
			}),
		).resolves.toEqual({ cleared: false });
	});

	it("removes a link and clears primaries, reporting row counts", async () => {
		queryOneMock.mockResolvedValueOnce({ ownerId: "entry-1" });
		await expect(
			removeImageLink({ data: { ownerKind: "ENTRY", id: "link-1" } }),
		).resolves.toEqual({ removed: true });
		expect(executeMock.mock.calls[0][0]).toContain(
			"DELETE FROM tanahpedia_entry_image",
		);
		expect(revalidateWebsiteMock).toHaveBeenNthCalledWith(1, [
			{
				changes: [
					{
						kind: "pedia-entry",
						uniqueName: "entry-1",
						entityTypes: [],
						synonymNames: [],
						refPerekIds: [],
					},
				],
			},
		]);

		await expect(
			clearPrimaryImage({
				data: { ownerKind: "ENTITY", ownerId: "en-1" },
			}),
		).resolves.toEqual({ cleared: true });
		expect(executeMock.mock.calls[1][0]).toContain(
			"tanahpedia_entity_image",
		);
		expect(revalidateWebsiteMock).toHaveBeenNthCalledWith(2, [
			{
				changes: [
					{
						kind: "pedia-entity",
						entityId: "en-1",
						entryUniqueNames: [],
						refPerekIds: [],
					},
				],
			},
		]);
	});
});
