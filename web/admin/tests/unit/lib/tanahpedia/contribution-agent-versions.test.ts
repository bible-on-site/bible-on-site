import { describe, expect, it } from "vitest";
import {
	compareContributionAgentVersions,
	contributionAgentBundleUpgrade,
} from "~/lib/tanahpedia/contribution-agent-versions";

const release = (version: string, hash = "a".repeat(64)) => ({ version, hash });

describe("monotonic contribution agent releases", () => {
	it.each([
		["1", "1.0.0", 0],
		["1.2", "1.2.0", 0],
		["2", "10", -1],
		["1.12", "1.3", 1],
		["1.2.10", "1.2.9", 1],
		["3", "2.999999999.999999999", 1],
		["0", "1", -1],
		["999999998", "999999999", -1],
	] as const)("compares numeric release %s with %s", (left, right, order) => {
		expect(
			compareContributionAgentVersions(
				`tanahpedia-agents-v${left}`,
				`tanahpedia-agents-v${right}`,
			),
		).toBe(order);
		expect(
			compareContributionAgentVersions(
				`tanahpedia-agents-v${right}`,
				`tanahpedia-agents-v${left}`,
			),
		).toBe(order === 0 ? 0 : -order);
	});
	it("never downgrades an installed release and permits only a numerically newer changed bundle", () => {
		expect(
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v10"),
				release("tanahpedia-agents-v2", "b".repeat(64)),
			),
		).toBe("keep");
		expect(
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1.2.9"),
				release("tanahpedia-agents-v1.2.10", "b".repeat(64)),
			),
		).toBe("upgrade");
		expect(
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1"),
				release("tanahpedia-agents-v1"),
			),
		).toBe("noop");
		expect(
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v10"),
				release("tanahpedia-agents-v1"),
			),
		).toBe("noop");
	});
	it.each([
		"tanahpedia-agents-v1",
		"tanahpedia-agents-v1.0",
		"tanahpedia-agents-v1.0.0",
	])("fails closed when %s is reused for changed bytes", (version) => {
		expect(() =>
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1"),
				release(version, "b".repeat(64)),
			),
		).toThrow("reused");
	});
	it.each([
		"",
		"1",
		"tanahpedia-agents-v",
		"tanahpedia-agents-v01",
		"tanahpedia-agents-v1.01",
		"tanahpedia-agents-v1.2.03",
		"tanahpedia-agents-v1.",
		"tanahpedia-agents-v1..2",
		"tanahpedia-agents-v1.2.3.4",
		"tanahpedia-agents-v-1",
		"tanahpedia-agents-v+1",
		"tanahpedia-agents-v1e2",
		"tanahpedia-agents-v１",
		"tanahpedia-agents-v١",
		"tanahpedia-agents-v1\n",
		"tanahpedia-agents-v1\t",
		"tanahpedia-agents-v1\u200b",
		"tanahpedia-agents-v1000000000",
		"tanahpedia-agents-v1.1000000000",
		"x".repeat(65),
	])("rejects malformed, oversized or non-ASCII version %j", (version) => {
		expect(() =>
			compareContributionAgentVersions(version, "tanahpedia-agents-v1"),
		).toThrow("release");
		expect(() =>
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1"),
				release(version),
			),
		).toThrow("release");
	});
	it.each([
		"",
		"a".repeat(63),
		"a".repeat(65),
		"A".repeat(64),
		"g".repeat(64),
		`a${"0".repeat(62)}\n`,
	])("rejects a noncanonical content hash %j", (hash) => {
		expect(() =>
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1"),
				release("tanahpedia-agents-v2", hash),
			),
		).toThrow("bundle hash");
	});
	it("rejects missing persisted release metadata instead of coercing it", () => {
		expect(() =>
			compareContributionAgentVersions(
				null as unknown as string,
				"tanahpedia-agents-v1",
			),
		).toThrow("release");
		expect(() =>
			contributionAgentBundleUpgrade(
				release("tanahpedia-agents-v1", null as unknown as string),
				release("tanahpedia-agents-v2"),
			),
		).toThrow("bundle hash");
	});
});
