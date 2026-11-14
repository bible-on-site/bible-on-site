import { beforeEach, expect, it, vi } from "vitest";
import { convertApiVersionAsync } from "~/lib/tanahpedia/api-versions";
import {
	CONTRIBUTION_API_VERSION,
	validateApiSequence,
} from "~/lib/tanahpedia/contribution-api";
import { currentContributionApiContract } from "~/server/tanahpedia/contribution-api-adapters.server";

const mocks = vi.hoisted(() => ({ read: vi.fn(), names: vi.fn() }));
vi.mock("~/server/tanahpedia/contribution-changes.server", () => ({
	readChangeState: mocks.read,
	readMetadataNames: mocks.names,
}));
const id = "00000000-0000-4000-8000-000000000001",
	nameId = "00000000-0000-4000-8000-000000000002";
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
