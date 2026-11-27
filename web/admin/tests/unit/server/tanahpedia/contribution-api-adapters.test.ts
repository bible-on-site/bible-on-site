import { beforeEach, expect, it, vi } from "vitest";
import { convertApiVersionAsync } from "~/lib/tanahpedia/api-versions";
import {
	CONTRIBUTION_API_VERSION,
	validateApiSequence,
} from "~/lib/tanahpedia/contribution-api";
import { currentContributionApiContract } from "~/server/tanahpedia/contribution-api-adapters.server";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	names: vi.fn(),
	source: vi.fn(),
	sourceLabels: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	readChangeState: mocks.read,
	readMetadataNames: mocks.names,
}));
vi.mock("~/server/tanahpedia/contribution-specials.server", () => ({
	captureContributionSourceTarget: mocks.source,
	sourceReferenceLabels: mocks.sourceLabels,
}));
const id = "00000000-0000-4000-8000-000000000001",
	nameId = "00000000-0000-4000-8000-000000000002";
it("rejects mixed article aggregates, extra base fields and a non-null new-entry base", () => {
	const article = {
		kind: "article_links",
		targetId: "27",
		before: {
			contentHash: "a".repeat(32),
			sourceHash: "b".repeat(64),
			perekId: 1,
			authorId: 2,
			coverageVerified: false,
			coveringSources: [],
			dedicationAssignments: [],
			moedIds: [7, 3],
		},
		after: {
			commands: [
				{
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 2 },
				},
			],
		},
		labels: {},
	};
	expect(() => validateApiSequence([article, article])).toThrow(
		"one article aggregate",
	);
	expect(() => validateApiSequence([article])).toThrow("noncanonical fields");
	expect(() =>
		validateApiSequence([
			{
				kind: "entry",
				targetId: id,
				before: {},
				after: {
					title: "New",
					uniqueName: "new",
					entityType: "PERSON",
					displayName: "New",
				},
				labels: {},
			},
		]),
	).toThrow("null base");
});
it("validates place snapshot shape and separate place sequences before applying API v7 operations", () => {
	const occurrence = {
		perekId: 67,
		pasukNumber: 7,
		segmentStart: 3,
		segmentEnd: 3,
		text: "מַסָּ֖ה",
	};
	const before = {
		entryAddresses: ["מסה"],
		occurrences: [],
		identification: { id: nameId, citations: ["שמות יז ז"] },
	};
	const profile = {
		kind: "place_profile",
		targetId: id,
		labels: {},
		before,
		after: { entry: null, occurrences: [occurrence], identification: null },
	};
	expect(validateApiSequence([profile])).toEqual([profile]);
	expect(() => validateApiSequence([profile, profile])).toThrow("one place");
	expect(() =>
		validateApiSequence([
			{ ...profile, before: { ...before, unexpectedField: true } },
		]),
	).toThrow("Noncanonical place profile base");
	const created = {
		...profile,
		before: null,
		after: {
			...profile.after,
			entry: { title: "מסה", uniqueName: "מסה", displayName: "מסה" },
		},
	};
	expect(validateApiSequence([created])).toEqual([created]);
	expect(() => validateApiSequence([{ ...created, before }])).toThrow(
		"null base",
	);
});

it("adds API5 through an explicit identity4→5 adapter without content reads", async () => {
	const contract = currentContributionApiContract({} as never);
	const operation = {
		kind: "metadata",
		targetId: id,
		before: { displayName: "Old" },
		after: { displayName: "New" },
		labels: {},
		personNames: [],
	};
	const result = await convertApiVersionAsync(
		[operation] as unknown,
		4,
		5,
		contract.adapters,
	);
	expect(result.payload).toEqual([operation]);
	expect(result.steps).toEqual([
		{ from: 4, to: 5, id: "article-link-operations" },
	]);
	expect(mocks.read).not.toHaveBeenCalled();
});
it("fills the v6 place-text alternative into legacy birthplace states", async () => {
	const contract = currentContributionApiContract({} as never);
	const operation = {
		kind: "person_birth_place",
		targetId: id,
		before: { personId: id, placeId: nameId, altGroupId: null },
		after: {
			personId: id,
			placeId: null,
			placeText: "דבינסק",
			altGroupId: null,
		},
		labels: {},
	};
	const legacyOperation = {
		...operation,
		after: { personId: id, placeId: nameId, altGroupId: null },
	};
	const result = await convertApiVersionAsync(
		[structuredClone(legacyOperation)] as unknown,
		5,
		contract.version,
		contract.adapters,
	);
	expect(result.steps).toEqual([
		{ from: 5, to: 6, id: "person-place-text-alternatives" },
		{ from: 6, to: 7, id: "place-word-occurrence-profiles" },
	]);
	expect(result.payload).toEqual([
		{
			...legacyOperation,
			before: { ...legacyOperation.before, placeText: null },
			after: { ...legacyOperation.after, placeText: null },
		},
	]);
	expect(() => validateApiSequence(result.payload)).not.toThrow();
	// Already-v6 states keep their explicit placeText and stay untouched.
	const current = await convertApiVersionAsync(
		[structuredClone(operation)] as unknown,
		5,
		contract.version,
		contract.adapters,
	);
	expect(current.payload).toEqual([
		{
			...operation,
			before: { ...operation.before, placeText: null },
		},
	]);
	expect(mocks.read).not.toHaveBeenCalled();
});
it("fills the v6 place-text alternative into a legacy birthplace sourceTarget", async () => {
	const contract = currentContributionApiContract({} as never);
	const operation = {
		kind: "source_reference",
		targetId: id,
		before: null,
		after: {
			targetKind: "person_birth_place",
			targetId: nameId,
			sourceType: "other",
			sourceText: "Source",
			perekId: null,
			pasukNumber: null,
			perushId: null,
		},
		sourceTarget: {
			kind: "person_birth_place",
			id: nameId,
			state: { personId: id, placeId: nameId, altGroupId: null },
		},
		labels: {},
	};
	const result = await convertApiVersionAsync(
		[structuredClone(operation)] as unknown,
		5,
		contract.version,
		contract.adapters,
	);
	expect(result.payload).toEqual([
		{
			...operation,
			sourceTarget: {
				kind: "person_birth_place",
				id: nameId,
				state: {
					personId: id,
					placeId: nameId,
					altGroupId: null,
					placeText: null,
				},
			},
		},
	]);
	expect(() => validateApiSequence(result.payload)).not.toThrow();
	expect(mocks.read).not.toHaveBeenCalled();
});
it.each([null, Array(41).fill({ kind: "person_birth_place" })])(
	"rejects invalid v5 sequence bounds before the place-text fill",
	async (payload) => {
		const contract = currentContributionApiContract({} as never);
		await expect(
			convertApiVersionAsync(payload, 5, contract.version, contract.adapters),
		).rejects.toThrow("Unsupported API v5 sequence");
	},
);
const legacy = {
	kind: "metadata",
	targetId: id,
	before: { displayName: "Old" },
	after: { displayName: "New" },
	labels: {},
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.read.mockResolvedValue(legacy.before);
	mocks.names.mockResolvedValue([{ id: nameId, name: "Main name" }]);
	mocks.sourceLabels.mockResolvedValue({});
});
it("locks multiple legacy metadata targets in a deterministic order", async () => {
	const contract = currentContributionApiContract({} as never);
	await convertApiVersionAsync(
		[{ ...legacy, targetId: nameId }, legacy] as unknown,
		1,
		contract.version,
		contract.adapters,
	);
	expect(mocks.read.mock.calls.map((args) => args[2])).toEqual([id, nameId]);
});
it("upgrades root-entity citations without inventing structured-fact preconditions", async () => {
	mocks.source.mockResolvedValue(null);
	const contract = currentContributionApiContract({} as never);
	const operation = {
		kind: "source_reference",
		targetId: nameId,
		before: null,
		after: {
			targetKind: "entity",
			targetId: id,
			sourceType: "other",
			sourceText: "Source",
			perekId: null,
			pasukNumber: null,
			perushId: null,
		},
		labels: {},
	};
	const result = await convertApiVersionAsync(
		[operation] as unknown,
		2,
		contract.version,
		contract.adapters,
	);
	expect(validateApiSequence(result.payload)[0]).not.toHaveProperty(
		"sourceTarget",
	);
	expect(mocks.sourceLabels).not.toHaveBeenCalled();
});
it("rejects converted payloads whose base or proposal would be silently normalized", () => {
	const operation = { ...legacy, personNames: [] };
	for (const side of ["before", "after"] as const)
		expect(() =>
			validateApiSequence([
				{
					...operation,
					[side]: { ...operation[side], displayName: " padded " },
				},
			]),
		).toThrow("unsupported fields");
});
it.each([null, Array(41).fill(legacy)])(
	"rejects invalid v2 sequence bounds before source lookup",
	async (payload) => {
		const contract = currentContributionApiContract({} as never);
		await expect(
			convertApiVersionAsync(payload, 2, contract.version, contract.adapters),
		).rejects.toThrow("Unsupported API v2 sequence");
		expect(mocks.source).not.toHaveBeenCalled();
	},
);
it("adds v4 edit vocabulary without resolving content or changing the reviewed creation", async () => {
	const source = [
		{
			kind: "entry",
			targetId: id,
			before: null,
			after: {
				title: "Entry",
				uniqueName: "entry",
				displayName: "Name",
				entityType: "PERSON",
			},
			labels: {},
		},
	];
	const contract = currentContributionApiContract({} as never);
	expect(
		(
			await convertApiVersionAsync(
				source as unknown,
				3,
				contract.version,
				contract.adapters,
			)
		).payload,
	).toEqual(source);
	expect(mocks.read).not.toHaveBeenCalled();
	expect(mocks.names).not.toHaveBeenCalled();
	expect(mocks.source).not.toHaveBeenCalled();
});
it("rejects mixed-case duplicate API targets and MAIN-name preconditions", () => {
	const targetId = "Abcdef00-0000-4000-8000-000000000001";
	const operation = { ...legacy, targetId, personNames: [] };
	expect(() =>
		validateApiSequence([
			operation,
			{ ...operation, targetId: targetId.toLowerCase() },
		]),
	).toThrow("more than once");
	expect(() =>
		validateApiSequence([
			{
				...operation,
				personNames: [
					{ id: targetId, name: "Name" },
					{ id: targetId.toLowerCase(), name: "Name" },
				],
			},
		]),
	).toThrow("main-name");
});
it("adds source-fact preconditions in the explicit v2-to-v3 step", async () => {
	const target = {
		kind: "person_birth_date",
		id: nameId,
		state: { personId: id, birthDate: 19480000, altGroupId: null },
	};
	const operation = {
		kind: "source_reference",
		targetId: id,
		before: null,
		after: {
			targetKind: target.kind,
			targetId: nameId,
			sourceType: "other",
			sourceText: "source",
			perekId: null,
			pasukNumber: null,
			perushId: null,
		},
		labels: {},
	};
	mocks.source.mockResolvedValue(target);
	mocks.sourceLabels.mockResolvedValue({ [`personId:${id}`]: "Name" });
	const contract = currentContributionApiContract({} as never),
		result = await convertApiVersionAsync(
			[operation] as unknown,
			2,
			contract.version,
			contract.adapters,
		);
	expect(validateApiSequence(result.payload)[0].sourceTarget).toEqual(target);
	expect(operation).not.toHaveProperty("sourceTarget");
	expect(() => validateApiSequence([operation])).toThrow(
		"target-fact preconditions",
	);
	for (const sourceTarget of [
		{ ...target, id },
		{ ...target, state: {} },
		{ ...target, state: { nested: { value: 1 } } },
		{ ...target, kind: "person_death_date" },
	])
		expect(() => validateApiSequence([{ ...operation, sourceTarget }])).toThrow(
			"Invalid source-target",
		);
});
it("upgrades legacy metadata under entity-first locks and retains the original source", async () => {
	const source = [structuredClone(legacy)],
		contract = currentContributionApiContract({} as never);
	const result = await convertApiVersionAsync(
		source as unknown,
		1,
		contract.version,
		contract.adapters,
	);
	expect(result.to).toBe(CONTRIBUTION_API_VERSION);
	expect(validateApiSequence(result.payload)[0].personNames).toEqual([
		{ id: nameId, name: "Main name" },
	]);
	expect(source[0]).not.toHaveProperty("personNames");
	expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.names.mock.invocationCallOrder[0],
	);
});
it("preserves existing reviewed preconditions and does not look up other operation types", async () => {
	const source = [
		{ ...legacy, personNames: [] },
		{
			kind: "entry",
			targetId: nameId,
			before: null,
			after: {
				title: "Entry",
				uniqueName: "entry",
				displayName: "Name",
				entityType: "PERSON",
			},
			labels: {},
		},
	];
	const contract = currentContributionApiContract({} as never);
	expect(
		(
			await convertApiVersionAsync(
				source as unknown,
				1,
				contract.version,
				contract.adapters,
			)
		).payload,
	).toEqual(source);
	expect(mocks.read).not.toHaveBeenCalled();
});
it("rejects missing targets and invalid legacy sequences", async () => {
	const contract = currentContributionApiContract({} as never);
	mocks.read.mockResolvedValue(null);
	await expect(
		convertApiVersionAsync(
			[legacy] as unknown,
			1,
			contract.version,
			contract.adapters,
		),
	).rejects.toThrow("target no longer exists");
	for (const value of [
		null,
		Array(41).fill(legacy),
		[{ ...legacy, targetId: "bad" }],
	])
		await expect(
			convertApiVersionAsync(value, 1, contract.version, contract.adapters),
		).rejects.toThrow();
	expect(() => validateApiSequence([legacy])).toThrow(
		"MAIN-name preconditions",
	);
});
