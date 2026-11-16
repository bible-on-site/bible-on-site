import { describe, expect, it } from "vitest";
import { validateArticleLinkChange } from "~/lib/tanahpedia/contribution-article-links";
import {
	agentArticleLinkVariant,
	assertAgentArticleLinkReferences,
} from "~/server/tanahpedia/contribution-agent-article-links.server";
import type { ModelCatalogue } from "~/server/tanahpedia/contribution-llm.server";

const catalogue: ModelCatalogue = {
	people: [],
	places: [],
	entities: [],
	targets: [{ kind: "article_links", id: "27" }],
	references: {
		perek: [{ id: 1, name: "בראשית א" }],
		dedication: [{ id: 2, name: "הקדשה" }],
		moed: [{ id: 3, name: "פסח" }],
	},
};

function change(commands: unknown[], targetId = "27") {
	return validateArticleLinkChange({
		kind: "article_links",
		targetId,
		after: { commands },
	});
}

const commands = [
	{
		relationshipKey: "primaryPerek",
		action: "replace",
		target: { perekId: 1 },
	},
	{
		relationshipKey: "coveringSources",
		action: "add",
		target: { pasukCoordinates: [{ perekId: 1, pasuk: 2 }] },
	},
	{
		relationshipKey: "dedicationAssignments",
		action: "replace",
		target: { dedicationId: 2, expiresAt: "2027-01-01 00:00:00" },
	},
	{ relationshipKey: "moadim", action: "add", target: { moedIds: [3] } },
];

describe("article-link agent output authority", () => {
	it("permits all four typed intents after their identities were read", () => {
		expect(() =>
			assertAgentArticleLinkReferences(change(commands), catalogue),
		).not.toThrow();
	});
	it("does not authorize an article from its name or another catalogue family", () => {
		expect(() =>
			assertAgentArticleLinkReferences(change(commands, "28"), catalogue),
		).toThrow("did not read this article");
		expect(agentArticleLinkVariant({ ...catalogue, targets: [] })).toBeNull();
	});
	it.each(commands)(
		"rejects an unread nested reference in $relationshipKey",
		(command) => {
			const unavailable = { ...catalogue, references: {} };
			expect(() =>
				assertAgentArticleLinkReferences(change([command]), unavailable),
			).toThrow("outside its read catalogue");
		},
	);
	it.each([true, false])(
		"cannot set coverage verification to %s",
		(coverageVerified) => {
			expect(() =>
				assertAgentArticleLinkReferences(
					change([
						{
							...commands[1],
							target: { pasukCoordinates: [], coverageVerified },
							action: "replace",
						},
					]),
					catalogue,
				),
			).toThrow("cannot change article coverage verification");
		},
	);
	it("never creates or deletes articles and keeps each command's decoder closed", () => {
		const schema = agentArticleLinkVariant(catalogue);
		expect(schema).toMatchObject({
			additionalProperties: false,
			required: ["kind", "targetId", "after"],
			properties: { targetId: { type: "string", enum: ["27"] } },
		});
		const encoded = JSON.stringify(schema);
		expect(encoded).not.toContain("coverageVerified");
		expect(encoded).not.toContain("authorId");
		expect(encoded).not.toContain('"type":"null"');
		expect(encoded).toContain('"dedicationId":{"type":"integer","enum":[2]}');
	});
	it("can clear known links without inventing catalogue identities or empty enum schemas", () => {
		const source = { ...catalogue, references: {} };
		const clear = change([
			{
				relationshipKey: "coveringSources",
				action: "clear",
				target: { pasukCoordinates: [] },
			},
			{ relationshipKey: "moadim", action: "clear", target: { moedIds: [] } },
		]);
		expect(() => assertAgentArticleLinkReferences(clear, source)).not.toThrow();
		const schema = JSON.stringify(agentArticleLinkVariant(source));
		expect(schema).not.toContain('"enum":[]');
		expect(schema).not.toContain("primaryPerek");
		expect(schema).not.toContain("dedicationAssignments");
	});
	it("ignores noncanonical or out-of-range supplied reference identities", () => {
		const source = {
			...catalogue,
			references: {
				perek: [
					{ id: "01", name: "ambiguous" },
					{ id: 2147483648, name: "overflow" },
				],
			},
		};
		expect(() =>
			assertAgentArticleLinkReferences(change([commands[0]]), source),
		).toThrow("outside its read catalogue");
	});
});
