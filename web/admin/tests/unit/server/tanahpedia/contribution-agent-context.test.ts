import type { PoolConnection } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChangeInput,
	Contribution,
	ContributionEvent,
	ContributionRevisionSnapshot,
} from "~/lib/tanahpedia/contributions";
import {
	type AgentCatalogue,
	mergeAgentCatalogues,
	readContributionAgentInitialContext,
	readContributionAgentTool,
} from "~/server/tanahpedia/contribution-agent-context.server";
import {
	type ContributionReference,
	REFERENCE_SELECTS,
} from "~/server/tanahpedia/contribution-records.server";

const mocks = vi.hoisted(() => ({
	one: vi.fn(),
	query: vi.fn(),
	item: vi.fn(),
	state: vi.fn(),
	names: vi.fn(),
	source: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	txQueryOne: mocks.one,
	txQuery: mocks.query,
	txExecute: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	readContribution: mocks.item,
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	readChangeState: mocks.state,
	readMetadataNames: mocks.names,
}));
vi.mock("~/server/tanahpedia/contribution-specials.server", () => ({
	readContributionSourceFact: mocks.source,
}));
vi.mock("~/server/tanahpedia/revisions", () => ({
	saveEntryTitleRevisioned: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-service.server", () => ({
	addEvent: vi.fn(),
	assertVersion: vi.fn(),
	createContribution: vi.fn(),
}));

const conn = {} as PoolConnection;
const id = "00000000-0000-0000-0000-000000000001";
const issueId = "00000000-0000-0000-0000-000000000002";
const personId = "00000000-0000-0000-0000-000000000003";
const entityId = "00000000-0000-0000-0000-000000000004";
const nameId = "00000000-0000-0000-0000-000000000005";
const actor = {
	id: "human",
	name: "Reviewer",
	kind: "human",
	isDoradsoft: false,
} as const;
const references = new Map<string, ContributionReference>();
const proposals = new Map<string, Contribution>();
let item: Contribution;
let issue: Contribution;

function event(
	index: number,
	kind: ContributionEvent["kind"] = "comment",
): ContributionEvent {
	return {
		id: `event-${String(index).padStart(3, "0")}`,
		kind,
		actor,
		body: `Complete body ${index}`,
		at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
		revision: 1,
	};
}

function snapshot(revision: number): ContributionRevisionSnapshot {
	return {
		revision,
		version: revision + 1,
		apiVersion: 1,
		author: actor,
		title: `Revision ${revision}`,
		description: `Full revision ${revision}`,
		evidence: [],
		changes: [],
		issueId: null,
		closeIssue: false,
		at: new Date(Date.UTC(2025, 0, 1, 0, 0, revision)).toISOString(),
	};
}

function emptyCatalogue(): AgentCatalogue {
	return { people: [], places: [], entities: [], targets: [], references: {} };
}

function relatedFixture(count: number) {
	item.kind = "issue";
	item.issueId = null;
	const rows = Array.from(
		{ length: count },
		(_, index): Contribution => ({
			...structuredClone(item),
			id: `00000000-0000-0000-0000-${String(10000 + index).padStart(12, "0")}`,
			kind: "pr",
			issueId: id,
			number: 100 + index,
			title: `Related proposal ${index}`,
			changes: [
				{
					kind: "parent_child",
					targetId: personId,
					before: null,
					after: { parentId: personId, childId: personId },
					labels: {},
				},
			],
			evidence: [
				{
					citation: "בראשית א א",
					quote: "Full evidence",
					url: null,
					note: "Retained evidence",
				},
			],
			state: index % 2 ? "merged" : "open",
			events: [event(index)],
		}),
	);
	for (const proposal of rows) proposals.set(proposal.id, proposal);
	const one = mocks.one.getMockImplementation();
	mocks.one.mockImplementation(async (...args) =>
		args[1] ===
		"SELECT COUNT(*) AS total FROM tanahpedia_contribution WHERE kind='pr' AND issue_id=?"
			? { total: rows.length }
			: one?.(...args),
	);
	mocks.query.mockImplementation(async (_conn, sql) => {
		if (
			!sql.startsWith(
				"SELECT id FROM tanahpedia_contribution WHERE kind='pr' AND issue_id=? ORDER BY number,id",
			)
		)
			throw new Error(`Unexpected SQL: ${sql}`);
		const window = / LIMIT (\d+) OFFSET (\d+)$/.exec(sql);
		return (
			window
				? rows.slice(Number(window[2]), Number(window[2]) + Number(window[1]))
				: rows
		).map((proposal) => ({ id: proposal.id }));
	});
	return rows;
}

beforeEach(() => {
	vi.resetAllMocks();
	references.clear();
	proposals.clear();
	item = {
		id,
		number: 1,
		kind: "pr",
		state: "open",
		title: "Proposal",
		description: "Current description",
		author: actor,
		assignee: { kind: "unassigned" },
		evidence: [],
		changes: [],
		issueId,
		revision: 1,
		version: 2,
		events: [],
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		closeIssue: false,
		provenance: null,
	};
	issue = {
		...structuredClone(item),
		id: issueId,
		number: 2,
		kind: "issue",
		issueId: null,
		title: "Linked issue",
	};
	mocks.item.mockImplementation(async (_conn, requestedId) =>
		structuredClone(
			proposals.get(requestedId) ?? (requestedId === issueId ? issue : item),
		),
	);
	mocks.state.mockResolvedValue(null);
	mocks.names.mockResolvedValue([]);
	mocks.source.mockResolvedValue(null);
	mocks.query.mockResolvedValue([]);
	mocks.one.mockImplementation(async (_conn, sql, args) => {
		for (const [kind, select] of Object.entries(REFERENCE_SELECTS)) {
			if (
				sql ===
				`SELECT candidate.* FROM (${select}) candidate WHERE candidate.id=?`
			)
				return references.get(`${kind}:${args[0]}`) ?? null;
		}
		throw new Error(`Unexpected SQL: ${sql}`);
	});
});

describe("complete contribution agent context", () => {
	it("pages all discussion events, including reviews and authors, beyond the old last-20 window", async () => {
		item.events = Array.from({ length: 71 }, (_, index) =>
			event(index, index % 2 ? "changes_requested" : "comment"),
		).reverse();
		const first = await readContributionAgentTool(conn, item, "discussion", {
			source: "item",
			limit: 50,
		});
		const last = await readContributionAgentTool(conn, item, "discussion", {
			source: "item",
			cursor: 50,
			limit: 50,
		});
		expect(first.data).toEqual({
			items: [...item.events].reverse().slice(0, 50),
			total: 71,
			nextCursor: 50,
		});
		expect(last.data).toEqual({
			items: [...item.events].reverse().slice(50),
			total: 71,
			nextCursor: null,
		});
	});

	it("rereads the linked issue and returns complete event data on every tool call", async () => {
		issue.events = [event(0)];
		await readContributionAgentTool(conn, item, "discussion", {
			source: "issue",
		});
		issue.events.push({ ...event(1, "approved"), body: "A fresh review" });
		const fresh = await readContributionAgentTool(conn, item, "discussion", {
			source: "issue",
		});
		expect(fresh.data).toMatchObject({
			total: 2,
			items: [event(0), { body: "A fresh review", actor }],
		});
		expect(mocks.item.mock.calls.map((call) => call[1])).toEqual([
			id,
			issueId,
			id,
			issueId,
		]);
	});

	it("pages every historical revision in stable order without a UI history cap", async () => {
		item.revisionHistory = Array.from({ length: 73 }, (_, index) =>
			snapshot(index),
		).reverse();
		const result = await readContributionAgentTool(conn, item, "history", {
			cursor: 50,
			limit: 50,
		});
		expect(result.data).toEqual({
			items: Array.from({ length: 23 }, (_, index) => snapshot(index + 50)),
			total: 73,
			nextCursor: null,
		});
	});

	it("returns an explicit empty page when an issue has no linked discussion", async () => {
		item.issueId = null;
		expect(
			(
				await readContributionAgentTool(conn, item, "discussion", {
					source: "issue",
					cursor: 90,
				})
			).data,
		).toEqual({ items: [], total: 0, nextCursor: null });
	});

	it("indexes existing linked PRs and pages their full proposals beyond the UI's 100-item cap", async () => {
		const related = relatedFixture(131);
		const initial = await readContributionAgentInitialContext(conn, item);
		expect(initial.data).toMatchObject({
			related: { total: 131, nextCursor: 10 },
		});
		const index = (initial.data as { related: { items: unknown[] } }).related
			.items;
		expect(index).toHaveLength(10);
		expect(index[0]).toMatchObject({
			id: related[0].id,
			state: "open",
			eventCount: 1,
		});
		const result = await readContributionAgentTool(conn, item, "related", {
			cursor: 100,
			limit: 25,
		});
		expect(result.data).toMatchObject({ total: 131, nextCursor: 125 });
		const items = (result.data as { items: unknown[] }).items;
		expect(items).toHaveLength(25);
		expect(items[0]).toMatchObject({
			id: related[100].id,
			title: related[100].title,
			state: related[100].state,
			changes: related[100].changes,
			evidence: related[100].evidence,
			eventCount: 1,
		});
		expect(mocks.query).toHaveBeenLastCalledWith(
			conn,
			"SELECT id FROM tanahpedia_contribution WHERE kind='pr' AND issue_id=? ORDER BY number,id LIMIT 25 OFFSET 100",
			[id],
		);
		const last = await readContributionAgentTool(conn, item, "related", {
			cursor: 125,
			limit: 25,
		});
		expect(last.data).toMatchObject({ total: 131, nextCursor: null });
	});

	it("provides every linked PR discussion event and history snapshot through exact relation-checked pages", async () => {
		const [proposal] = relatedFixture(1);
		proposal.events = Array.from({ length: 70 }, (_, index) =>
			event(index, "changes_requested"),
		).reverse();
		proposal.revisionHistory = Array.from({ length: 70 }, (_, index) =>
			snapshot(index),
		).reverse();
		const discussion = await readContributionAgentTool(conn, item, "related", {
			id: proposal.id,
			section: "discussion",
			cursor: 50,
			limit: 50,
		});
		const history = await readContributionAgentTool(conn, item, "related", {
			id: proposal.id,
			section: "history",
			cursor: 50,
			limit: 50,
		});
		expect(discussion.data).toEqual({
			total: 70,
			nextCursor: null,
			items: [...proposal.events].reverse().slice(50),
		});
		expect(history.data).toEqual({
			total: 70,
			nextCursor: null,
			items: [...proposal.revisionHistory].reverse().slice(50),
		});
		proposal.events.push(event(71));
		expect(
			(
				await readContributionAgentTool(conn, item, "related", {
					id: proposal.id,
					section: "discussion",
					cursor: 70,
				})
			).data,
		).toMatchObject({ total: 71, items: [event(71)] });
	});

	it("rejects exact discussion and history reads once a proposal is not related to the current issue", async () => {
		const [proposal] = relatedFixture(1);
		proposal.issueId = issueId;
		await expect(
			readContributionAgentTool(conn, item, "related", {
				id: proposal.id,
				section: "discussion",
			}),
		).rejects.toThrow("not linked");
		proposal.issueId = id;
		proposal.kind = "issue";
		await expect(
			readContributionAgentTool(conn, item, "related", {
				id: proposal.id,
				section: "history",
			}),
		).rejects.toThrow("not linked");
		await expect(
			readContributionAgentInitialContext(conn, item),
		).rejects.toThrow("no longer belongs");
	});

	it("pins all linked PR semantics and comments beyond the small initial index", async () => {
		const related = relatedFixture(131);
		const first = await readContributionAgentInitialContext(conn, item);
		related[130].version++;
		related[130].updatedAt = "New lease timestamp";
		expect((await readContributionAgentInitialContext(conn, item)).hash).toBe(
			first.hash,
		);
		related[130].events[0].body = "A new human concern on the last related PR";
		const changed = await readContributionAgentInitialContext(conn, item);
		expect(changed.hash).not.toBe(first.hash);
		related[130].state = "closed";
		expect(
			(await readContributionAgentInitialContext(conn, item)).hash,
		).not.toBe(changed.hash);
	});

	it("shares related proposal access with the linked issue when the current item is a PR", async () => {
		const [proposal] = relatedFixture(1);
		const parentIssueId = item.id;
		item = {
			...structuredClone(item),
			id: issueId,
			kind: "pr",
			issueId: parentIssueId,
		};
		mocks.item.mockImplementation(async (_conn, requestedId) =>
			structuredClone(proposals.get(requestedId) ?? item),
		);
		const result = await readContributionAgentTool(conn, item, "related", {
			id: proposal.id,
			section: "discussion",
		});
		expect(result.data).toMatchObject({
			total: 1,
			items: [proposal.events[0]],
		});
	});

	it("returns a complete empty related page when a PR has no linked issue", async () => {
		item.issueId = null;
		expect(
			(await readContributionAgentTool(conn, item, "related", {})).data,
		).toEqual({ items: [], total: 0, nextCursor: null });
		await expect(
			readContributionAgentTool(conn, item, "related", {
				id,
				section: "discussion",
			}),
		).rejects.toThrow("not linked");
	});

	it("searches SQL beyond the old 4000-record catalogue and binds escaped text", async () => {
		const row = { id: entityId, name: "Far beyond the UI cap" };
		references.set(`entity:${entityId}`, row);
		const one = mocks.one.getMockImplementation();
		mocks.one.mockImplementation(async (...args) =>
			args[1].startsWith("SELECT COUNT(*)") ? { total: 4031 } : one?.(...args),
		);
		mocks.query.mockResolvedValue([row]);
		const result = await readContributionAgentTool(conn, item, "search", {
			kind: "entity",
			query: "50%_='",
			cursor: 4000,
			limit: 1,
		});
		expect(result.data).toMatchObject({
			items: [row],
			total: 4031,
			nextCursor: 4001,
		});
		expect(result.catalogue.entities).toEqual([row]);
		expect(mocks.query).toHaveBeenCalledWith(
			conn,
			expect.stringContaining(
				"ORDER BY candidate.name,candidate.id LIMIT 1 OFFSET 4000",
			),
			["%50=%=_=='%", "%50=%=_=='%"],
		);
		expect(mocks.query.mock.calls[0][1]).not.toContain("50%");
	});

	it("distinguishes place references from place identification targets", async () => {
		references.set(`place:${personId}`, {
			id: personId,
			name: "A place",
			ownerId: entityId,
		});
		references.set(`entity:${entityId}`, {
			id: entityId,
			name: "Place entity",
		});
		mocks.state.mockResolvedValue({
			placeId: personId,
			modernName: "Modern name",
			latitude: null,
			longitude: null,
			altGroupId: null,
		});
		const reference = await readContributionAgentTool(conn, item, "record", {
			kind: "place",
			id: personId,
		});
		const target = await readContributionAgentTool(conn, item, "record", {
			kind: "target:place",
			id,
		});
		expect(reference.catalogue.targets).toEqual([]);
		expect(reference.catalogue.places).toEqual([
			{ id: personId, name: "A place" },
		]);
		expect(target.catalogue.targets).toEqual([
			{
				kind: "place",
				id,
				current: {
					placeId: personId,
					modernName: "Modern name",
					latitude: null,
					longitude: null,
					altGroupId: null,
				},
			},
		]);
		expect(target.catalogue.entities).toEqual([
			{ id: entityId, name: "Place entity" },
		]);
	});

	it("searches structured targets using fixed schema labels and reads their authoritative state", async () => {
		const one = mocks.one.getMockImplementation();
		mocks.one.mockImplementation(async (...args) =>
			args[1].startsWith("SELECT COUNT(*)") ? { total: 1 } : one?.(...args),
		);
		mocks.query.mockResolvedValue([{ id: nameId, name: "Person / nickname" }]);
		mocks.state.mockResolvedValue({
			personId,
			name: "Nickname",
			nameType: "NICKNAME",
			altGroupId: null,
		});
		const result = await readContributionAgentTool(conn, item, "search", {
			kind: "target:person_name",
			query: "nickname",
			limit: 50,
		});
		expect(result.data).toMatchObject({
			items: [
				{ id: nameId, kind: "person_name", current: { name: "Nickname" } },
			],
			total: 1,
			nextCursor: null,
		});
		expect(mocks.state).toHaveBeenCalledWith(
			conn,
			"person_name",
			nameId,
			undefined,
		);
		expect(mocks.query.mock.calls[0][1]).toContain(
			"FROM tanahpedia_person_name r WHERE name_type_id IN",
		);
		expect(mocks.query.mock.calls[0][1]).toContain(
			"FROM tanahpedia_lookup_name_type WHERE id=r.name_type_id",
		);
	});

	it("ends an empty SQL page even if records disappear after its count", async () => {
		mocks.one.mockResolvedValue({ total: 4001 });
		expect(
			(
				await readContributionAgentTool(conn, item, "search", {
					kind: "entity",
					query: "",
					cursor: 4000,
				})
			).data,
		).toMatchObject({ items: [], total: 4001, nextCursor: null });
	});

	it("loads alias destinations and direct source root references exactly", async () => {
		references.set(`entry:${entityId}`, {
			id: entityId,
			name: "Exact destination",
		});
		mocks.state.mockResolvedValue({
			name: "Alias",
			targets: [{ entryId: entityId, label: "Meaning" }],
		});
		const alias = await readContributionAgentTool(conn, item, "record", {
			kind: "target:alias_mapping",
			id,
		});
		expect(alias.catalogue.references.entry).toEqual([
			{ id: entityId, name: "Exact destination" },
		]);
		references.set(`person:${personId}`, {
			id: personId,
			name: "Direct source person",
		});
		mocks.state.mockResolvedValue({
			targetKind: "person",
			targetId: personId,
			perekId: null,
			perushId: null,
		});
		const source = await readContributionAgentTool(conn, item, "record", {
			kind: "target:source_reference",
			id,
		});
		expect(source.catalogue.people).toEqual([
			{ id: personId, name: "Direct source person" },
		]);
		expect(mocks.source).not.toHaveBeenCalled();
	});

	it("loads exact existing PR targets and referenced owners outside all UI catalogues", async () => {
		item.changes = [
			{
				kind: "parent_child",
				targetId: id,
				before: { parentId: personId, childId: personId },
				after: {
					parentId: personId,
					childId: personId,
					sourceCitation: "בראשית א א",
				},
				labels: {},
			},
		];
		mocks.state.mockResolvedValue({
			parentId: personId,
			childId: personId,
			sourceCitation: "Old",
		});
		references.set(`person:${personId}`, {
			id: personId,
			name: "Exact person",
			ownerId: entityId,
		});
		references.set(`entity:${entityId}`, {
			id: entityId,
			name: "Exact entity",
		});
		const result = await readContributionAgentInitialContext(conn, item);
		expect(result.catalogue.targets).toMatchObject([
			{ id, kind: "parent_child", current: { sourceCitation: "Old" } },
		]);
		expect(result.catalogue.people).toEqual([
			{ id: personId, name: "Exact person" },
		]);
		expect(result.catalogue.entities).toEqual([
			{ id: entityId, name: "Exact entity" },
		]);
		expect(result.catalogue.references.alternative).toEqual([
			{ id: issueId, name: "קבוצת דעות חדשה לפנייה" },
		]);
		expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
			conn,
			"SELECT id FROM tanahpedia_contribution WHERE kind='pr' AND issue_id=? ORDER BY number,id",
			[issueId],
		);
	});

	it("retains an existing proposal's creation ID while exact missing reads authorize nothing", async () => {
		item.changes = [
			{
				kind: "parent_child",
				targetId: id,
				before: null,
				after: { parentId: personId, childId: personId },
				labels: {},
			},
		];
		const initial = await readContributionAgentInitialContext(conn, item);
		const exact = await readContributionAgentTool(conn, item, "record", {
			kind: "target:parent_child",
			id,
		});
		expect(initial.catalogue.targets).toEqual([{ id, kind: "parent_child" }]);
		expect(initial.data).toMatchObject({
			currentRecords: expect.arrayContaining([
				{ kind: "target:parent_child", id, current: null },
			]),
		});
		expect(exact.catalogue.targets).toEqual([]);
	});

	it("loads source fact context and its referenced name, person, entity and numeric scripture", async () => {
		mocks.state.mockResolvedValue({
			targetKind: "person_name",
			targetId: nameId,
			perekId: 929,
			perushId: null,
		});
		mocks.source.mockResolvedValue({ personId, name: "Source name" });
		references.set(`person:${personId}`, {
			id: personId,
			name: "Person",
			ownerId: entityId,
		});
		references.set(`entity:${entityId}`, { id: entityId, name: "Entity" });
		references.set("perek:929", { id: 929, name: "דברי הימים ב לו" });
		const result = await readContributionAgentTool(conn, item, "record", {
			kind: "target:source_reference",
			id,
		});
		expect(mocks.source).toHaveBeenCalledWith(conn, "person_name", nameId);
		expect(result.catalogue.targets).toMatchObject([
			{ kind: "source_reference" },
			{ kind: "person_name", id: nameId },
		]);
		expect(result.catalogue.references.perek).toEqual([
			{ id: 929, name: "דברי הימים ב לו" },
		]);
		expect(result.catalogue.people).toEqual([{ id: personId, name: "Person" }]);
	});

	it.each(["place_identification", "person_name"])(
		"authorizes source attachments from an exact %s reference without granting edits",
		async (kind) => {
			const row = { id: nameId, name: "Source fact reference" };
			if (kind === "person_name") references.set(`${kind}:${nameId}`, row);
			else mocks.one.mockResolvedValue(row);
			const result = await readContributionAgentTool(conn, item, "record", {
				kind,
				id: nameId,
			});
			const { assertGeneratedReferences, contributionOutputSchema } =
				await import("~/server/tanahpedia/contribution-llm.server");
			const source = {
				targetKind: kind,
				targetId: nameId,
				sourceType: "other" as const,
				sourceText: "Authoritative source",
				perekId: null,
				pasukNumber: null,
				perushId: null,
			};
			const change: ChangeInput = { kind: "source_reference", after: source };
			expect(() =>
				assertGeneratedReferences([change], result.catalogue),
			).not.toThrow();
			expect(() =>
				assertGeneratedReferences(
					[{ ...change, after: { ...source, targetId: personId } }],
					result.catalogue,
				),
			).toThrow("source target");
			expect(result.catalogue.targets).toEqual([]);
			expect(
				contributionOutputSchema(result.catalogue, 1).properties.pullRequests
					.items.properties.changes.items.oneOf,
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						properties: expect.objectContaining({
							kind: { const: "source_reference" },
							after: expect.objectContaining({
								properties: expect.objectContaining({
									targetKind: { const: kind },
									targetId: { enum: [nameId] },
								}),
							}),
						}),
					}),
				]),
			);
		},
	);

	it("includes metadata MAIN-name dependencies in freshness receipts", async () => {
		item.changes = [
			{
				kind: "metadata",
				targetId: entityId,
				before: { displayName: "Old" },
				after: { displayName: "New" },
				labels: {},
			},
		];
		mocks.state.mockResolvedValue({ displayName: "Old" });
		mocks.names.mockResolvedValue([{ id: nameId, name: "Original MAIN" }]);
		references.set(`person_name:${nameId}`, {
			id: nameId,
			name: "Original MAIN",
			ownerId: personId,
		});
		const first = await readContributionAgentInitialContext(conn, item);
		mocks.names.mockResolvedValue([{ id: nameId, name: "Changed MAIN" }]);
		const second = await readContributionAgentInitialContext(conn, item);
		expect(first.catalogue.references.person_name).toMatchObject([
			{ id: nameId, ownerId: personId },
		]);
		expect(second.hash).not.toBe(first.hash);
	});

	it.each([
		["metadata", "entity"],
		["entry", "entry"],
	])(
		"authorizes the exact %s target's own reference on a tool read",
		async (kind, family) => {
			mocks.state.mockResolvedValue({ displayName: "Exact target" });
			references.set(`${family}:${entityId}`, {
				id: entityId,
				name: "Exact target",
			});
			const result = await readContributionAgentTool(conn, item, "record", {
				kind: `target:${kind}`,
				id: entityId,
			});
			expect(result.catalogue.references[family]).toEqual([
				{ id: entityId, name: "Exact target" },
			]);
			if (family === "entity")
				expect(result.catalogue.entities).toEqual([
					{ id: entityId, name: "Exact target" },
				]);
		},
	);

	it("returns pending human comments and change requests using immutable response receipts", async () => {
		item.events = [
			event(0),
			event(1, "changes_requested"),
			event(2),
			{ ...event(3), actor: { ...actor, kind: "local_llm" } },
			{
				...event(4, "agent_response"),
				responses: [
					{ commentId: "event-000", status: "addressed", body: "Done" },
				],
			},
		];
		const result = await readContributionAgentInitialContext(conn, item);
		expect(result.data).toMatchObject({
			pendingCommentIds: ["event-001", "event-002"],
			item: { eventCount: 5 },
		});
		expect(
			JSON.stringify((result.data as { item: unknown }).item),
		).not.toContain("Complete body");
	});

	it("shows a fresh PR correction directly even when the linked issue asks for the opposite work", async () => {
		issue.description = "Create a new article about the original subject";
		item.title = "Existing implementation";
		item.description = "Replace the current proposal's title only";
		const feedback = {
			...event(1),
			body: "Do not create another article. Change this PR's title to the requested wording.",
		};
		item.events = [event(0, "created"), feedback];
		const initial = await readContributionAgentInitialContext(conn, item);
		expect(initial.data).toMatchObject({
			item: { id, description: item.description },
			issue: { id: issueId, description: issue.description },
			pendingFeedback: {
				items: [{ ...feedback, latestResponse: null }],
				total: 1,
				nextCursor: null,
				readLocator: {
					tool: "discussion",
					arguments: {
						source: "item",
						filter: "pending_feedback",
						cursor: 0,
						limit: 10,
					},
				},
			},
		});
	});

	it("pages newest pending feedback with its actual discussion read locator and complete author/body/status", async () => {
		item.events = Array.from({ length: 63 }, (_, index) => event(index));
		item.events.push({
			...event(70, "agent_response"),
			responses: [
				{
					commentId: "event-030",
					status: "addressed",
					body: "Already handled",
				},
				{
					commentId: "event-000",
					status: "needs_input",
					body: "Need source details",
				},
			],
		});
		const initial = await readContributionAgentInitialContext(conn, item);
		const feedback = (
			initial.data as {
				pendingFeedback: {
					items: unknown[];
					total: number;
					nextCursor: number;
					readLocator: { tool: string; arguments: Record<string, unknown> };
				};
			}
		).pendingFeedback;
		expect(feedback.total).toBe(62);
		expect(feedback.nextCursor).toBe(10);
		expect(feedback.items).toHaveLength(10);
		expect(feedback.items[0]).toEqual({ ...event(62), latestResponse: null });
		const first = await readContributionAgentTool(
			conn,
			item,
			feedback.readLocator.tool,
			feedback.readLocator.arguments,
		);
		expect(first.data).toEqual({
			items: feedback.items,
			total: 62,
			nextCursor: 10,
		});
		const next = await readContributionAgentTool(conn, item, "discussion", {
			...feedback.readLocator.arguments,
			cursor: feedback.nextCursor,
			limit: 50,
		});
		expect(next.data).toMatchObject({ total: 62, nextCursor: 60 });
		const last = await readContributionAgentTool(conn, item, "discussion", {
			source: "item",
			filter: "pending_feedback",
			cursor: 60,
			limit: 50,
		});
		expect(last.data).toEqual({
			total: 62,
			nextCursor: null,
			items: [
				{ ...event(1), latestResponse: null },
				{
					...event(0),
					latestResponse: {
						commentId: "event-000",
						status: "needs_input",
						body: "Need source details",
					},
				},
			],
		});
		const all = await readContributionAgentTool(conn, item, "discussion", {
			source: "item",
			filter: "all",
			cursor: 50,
			limit: 50,
		});
		expect(all.data).toMatchObject({ total: 64, nextCursor: null });
		const before = initial.hash;
		item.events[62].body = "The fresh request was edited";
		expect(
			(await readContributionAgentInitialContext(conn, item)).hash,
		).not.toBe(before);
	});

	it("filters linked issue feedback freshly without replacing the current PR's pending request", async () => {
		item.events = [{ ...event(1), body: "Current PR feedback" }];
		issue.events = [{ ...event(2), body: "Linked issue feedback" }];
		const initial = await readContributionAgentInitialContext(conn, item);
		expect(initial.data).toMatchObject({
			pendingFeedback: { items: [{ body: "Current PR feedback" }] },
		});
		const first = await readContributionAgentTool(conn, item, "discussion", {
			source: "issue",
			filter: "pending_feedback",
		});
		expect(first.data).toMatchObject({
			total: 1,
			items: [{ body: "Linked issue feedback", actor }],
		});
		issue.events[0].body = "Edited linked issue feedback";
		expect(
			(
				await readContributionAgentTool(conn, item, "discussion", {
					source: "issue",
					filter: "pending_feedback",
				})
			).data,
		).toMatchObject({ items: [{ body: "Edited linked issue feedback" }] });
	});

	it("prioritizes the last appended feedback even when timestamps tie and identifiers sort the opposite way", async () => {
		const older = { ...event(0), id: "z-older", body: "Older instruction" };
		const latest = {
			...event(0),
			id: "a-latest",
			body: "Latest appended correction",
		};
		item.events = [older, latest];
		const initial = await readContributionAgentInitialContext(conn, item);
		expect(initial.data).toMatchObject({
			pendingFeedback: {
				items: [
					{ ...latest, latestResponse: null },
					{ ...older, latestResponse: null },
				],
			},
		});
		expect(
			(
				await readContributionAgentTool(conn, item, "discussion", {
					source: "item",
					filter: "pending_feedback",
					limit: 1,
				})
			).data,
		).toMatchObject({
			items: [{ id: latest.id, body: latest.body }],
			total: 2,
			nextCursor: 1,
		});
	});

	it("exposes actual current review, API and rebase state and fingerprints changes to each", async () => {
		const reviewer = { ...actor, id: "dorad", isDoradsoft: true };
		item.revision = 3;
		item.revisionAuthor = { ...actor, kind: "local_llm" };
		item.events = [{ ...event(0, "approved"), actor: reviewer, revision: 2 }];
		item.domainConflict = "The referenced content changed";
		item.rebasePending = true;
		item.deferredContentMerge = { id: issueId, number: 41 };
		item.apiVersion = 0;
		item.apiMigration = {
			id: "migration",
			status: "failed",
			from: 0,
			to: 1,
			at: "2025-01-01T00:00:00Z",
			steps: [],
			error: "Needs manual conversion",
			sequence: "Raw failed operation",
		};
		item.apiMigrationHistory = [item.apiMigration];
		const required = await readContributionAgentInitialContext(conn, item);
		expect(required.data).toMatchObject({
			item: {
				revision: 3,
				revisionAuthor: item.revisionAuthor,
				reviewStatus: "required",
				domainConflict: item.domainConflict,
				rebasePending: true,
				deferredContentMerge: item.deferredContentMerge,
				apiVersion: 0,
				apiMigration: item.apiMigration,
				apiMigrationHistory: item.apiMigrationHistory,
				closeIssue: false,
			},
		});
		item.events.push({
			...event(1, "changes_requested"),
			actor: reviewer,
			revision: 3,
		});
		const requested = await readContributionAgentInitialContext(conn, item);
		expect(requested.data).toMatchObject({
			item: { reviewStatus: "changes_requested" },
		});
		expect(requested.hash).not.toBe(required.hash);
		item.events.push({ ...event(2, "approved"), actor: reviewer, revision: 3 });
		const approved = await readContributionAgentInitialContext(conn, item);
		expect(approved.data).toMatchObject({ item: { reviewStatus: "approved" } });
		expect(approved.hash).not.toBe(requested.hash);
		let previous = approved;
		for (const mutate of [
			() => {
				item.domainConflict = "Another conflict";
			},
			() => {
				item.rebasePending = false;
			},
			() => {
				item.deferredContentMerge = { id: issueId, number: 42 };
			},
			() => {
				item.apiMigration = {
					...item.apiMigration,
					error: "Another migration error",
				} as Contribution["apiMigration"];
			},
			() => {
				item.revision++;
			},
		]) {
			mutate();
			const fresh = await readContributionAgentInitialContext(conn, item);
			expect(fresh.hash).not.toBe(previous.hash);
			previous = fresh;
		}
		expect(previous.data).toMatchObject({ item: { reviewStatus: "required" } });
		item.revisionAuthor = reviewer;
		expect(
			(await readContributionAgentInitialContext(conn, item)).data,
		).toMatchObject({ item: { reviewStatus: "exempt" } });
	});

	it("uses only the latest immutable agent response status for pending human comments", async () => {
		item.events = [
			event(0),
			{
				...event(1, "agent_response"),
				responses: [
					{
						commentId: "event-000",
						status: "addressed",
						body: "Addressed before",
					},
				],
			},
			{
				...event(2, "agent_response"),
				responses: [
					{
						commentId: "event-000",
						status: "needs_input",
						body: "Still needs clarification",
					},
				],
			},
			{
				...event(3),
				actor: { ...actor, kind: "system" },
				responses: [
					{
						commentId: "event-000",
						status: "addressed",
						body: "Not an agent_response receipt",
					},
				],
			},
		];
		expect(
			(await readContributionAgentInitialContext(conn, item)).data,
		).toMatchObject({ pendingCommentIds: ["event-000"] });
		item.events.push({
			...event(4, "agent_response"),
			responses: [
				{ commentId: "event-000", status: "addressed", body: "Now addressed" },
			],
		});
		expect(
			(await readContributionAgentInitialContext(conn, item)).data,
		).toMatchObject({ pendingCommentIds: [] });
	});

	it("hashes old events, all history, fresh linked issue and authoritative target state", async () => {
		item.events = Array.from({ length: 80 }, (_, index) => event(index));
		item.revisionHistory = Array.from({ length: 80 }, (_, index) =>
			snapshot(index),
		);
		const oldestRevision = item.revisionHistory[0];
		item.changes = [
			{
				kind: "parent_child",
				targetId: id,
				before: { sourceCitation: "Old" },
				after: { sourceCitation: "New" },
				labels: {},
			},
		];
		mocks.state.mockResolvedValue({ sourceCitation: "Database" });
		let previous = await readContributionAgentInitialContext(conn, item);
		for (const mutate of [
			() => {
				item.events[0].body = "Old comment edited";
			},
			() => {
				oldestRevision.description = "Old history edited";
			},
			() => {
				issue.description = "Fresh issue changed";
			},
			() => {
				mocks.state.mockResolvedValue({ sourceCitation: "Database changed" });
			},
		]) {
			mutate();
			const fresh = await readContributionAgentInitialContext(conn, item);
			expect(fresh.hash).not.toBe(previous.hash);
			previous = fresh;
		}
	});

	it("ignores lease-only bookkeeping without hiding semantic snapshots", async () => {
		item.revisionHistory = [snapshot(1)];
		const eventSnapshot = snapshot(1);
		item.events = [{ ...event(0, "edited"), snapshot: eventSnapshot }];
		const first = await readContributionAgentInitialContext(conn, item);
		item.version++;
		item.updatedAt = "2025-02-01T00:00:00Z";
		item.generation = {
			id: "job",
			status: "running",
			worker: "new lease",
		} as Contribution["generation"];
		item.revisionHistory[0].version++;
		eventSnapshot.version++;
		expect((await readContributionAgentInitialContext(conn, item)).hash).toBe(
			first.hash,
		);
		eventSnapshot.description = "Semantic revision changed";
		expect(
			(await readContributionAgentInitialContext(conn, item)).hash,
		).not.toBe(first.hash);
	});

	it("exposes migration-blocked unknown operations without routing them to a SQL reader", async () => {
		const legacy = {
			kind: "legacy_raw_operation",
			targetId: id,
			before: null,
			after: { original: "Untouched input" },
			labels: {},
		};
		item.changes = [legacy] as unknown as Contribution["changes"];
		item.apiVersion = 0;
		item.apiMigration = {
			id: "migration",
			status: "failed",
			from: 0,
			to: 1,
			at: "2025-01-01T00:00:00Z",
			steps: [],
			error: "Unknown legacy operation",
			sequence: JSON.stringify([legacy]),
		};
		const result = await readContributionAgentInitialContext(conn, item);
		expect(result.data).toMatchObject({
			item: {
				changes: [legacy],
				apiVersion: 0,
				apiMigration: item.apiMigration,
			},
			currentRecords: [{ kind: "alternative", id: issueId }],
		});
		expect(mocks.state).not.toHaveBeenCalled();
		expect(mocks.one).not.toHaveBeenCalled();
		expect(result.catalogue.targets).toEqual([]);
		await expect(
			readContributionAgentTool(conn, item, "record", {
				kind: "target:legacy_raw_operation",
				id,
			}),
		).rejects.toThrow("Unsupported contribution target kind");
		const firstHash = result.hash;
		item.changes[0].after = { original: "Changed legacy input" };
		expect(
			(await readContributionAgentInitialContext(conn, item)).hash,
		).not.toBe(firstHash);
	});

	it.each([
		["arbitrary_sql", {}],
		["record", { kind: "__proto__", id }],
		["record", { kind: "target:constructor", id }],
		["record", { kind: "person", id: "" }],
		["record", { kind: "target:parent_child", id: 3 }],
		["search", { kind: "person", query: "", cursor: -1 }],
		["search", { kind: "person", query: "", limit: 51 }],
		["search", { kind: "person", query: "", cursor: 0.5 }],
		["search", { kind: "person", query: null }],
		["discussion", { source: "elsewhere" }],
		["discussion", { source: "item", filter: "unsupported" }],
		["discussion", { source: "item", filter: null }],
		["history", { sql: "DROP TABLE" }],
		["history", []],
		["related", { section: "elsewhere" }],
		["related", { id, section: "items" }],
		["related", { section: "discussion" }],
		["related", { cursor: -1 }],
	])(
		"rejects unsupported tool arguments without executing user SQL: %s %j",
		async (name, args) => {
			await expect(
				readContributionAgentTool(conn, item, name, args),
			).rejects.toThrow();
			expect(mocks.query).not.toHaveBeenCalled();
			expect(mocks.one).not.toHaveBeenCalled();
		},
	);

	it("merges by family and case-insensitive ID, retaining latest values without mutating inputs", () => {
		const first = emptyCatalogue();
		first.people = [{ id: "PERSON", name: "Old" }];
		first.references.person = [{ id: "PERSON", name: "Old" }];
		first.targets = [{ id, kind: "place", current: { modernName: "Old" } }];
		const second = emptyCatalogue();
		second.people = [{ id: "person", name: "New" }];
		second.references.person = [
			{ id: "person", name: "New", ownerId: entityId },
		];
		second.references.entity = [{ id: entityId, name: "Entity" }];
		second.targets = [
			{ id, kind: "place", current: { modernName: "New" } },
			{ id, kind: "metadata", current: { displayName: "Different kind" } },
		];
		const before = structuredClone([first, second]);
		const merged = mergeAgentCatalogues(first, second);
		expect(merged.people).toEqual(second.people);
		expect(merged.references).toEqual(second.references);
		expect(merged.targets).toEqual(second.targets);
		expect([first, second]).toEqual(before);
		expect(mergeAgentCatalogues()).toEqual(emptyCatalogue());
	});
});
