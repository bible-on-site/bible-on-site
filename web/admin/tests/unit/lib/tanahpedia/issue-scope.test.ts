import { describe, expect, it } from "vitest";
import {
	assertIssueScopeChanges,
	type ChangeInput,
	CONTRIBUTION_ISSUE_SCOPE_KINDS,
	validateIssueScope,
} from "~/lib/tanahpedia/contributions";

const id = "person00-0000-4000-8000-000000000001";
const other = "person00-0000-4000-8000-000000000002";
describe("optional issue implementation scope", () => {
	it("retains free-text issues and supports the complete operation catalogue", () => {
		expect(validateIssueScope(undefined)).toBeUndefined();
		expect(validateIssueScope(null)).toBeUndefined();
		expect(CONTRIBUTION_ISSUE_SCOPE_KINDS).toHaveLength(47);
		expect(new Set(CONTRIBUTION_ISSUE_SCOPE_KINDS).size).toBe(47);
	});
	it.each(CONTRIBUTION_ISSUE_SCOPE_KINDS)(
		"accepts kind-only %s and confines its implementation",
		(kind) => {
			expect(validateIssueScope({ kind })).toEqual({ kind });
			const targetId = kind === "article_links" ? "27" : id;
			const change = {
				kind,
				...(kind === "entry" ? {} : { targetId }),
				after: null,
			} as ChangeInput;
			expect(() => assertIssueScopeChanges([change], { kind })).not.toThrow();
			expect(() =>
				assertIssueScopeChanges(
					[
						{
							...change,
							kind: kind === "metadata" ? "entry" : "metadata",
						} as ChangeInput,
					],
					{ kind },
				),
			).toThrow("outside the issue scope");
			if (kind !== "entry") {
				const scope = validateIssueScope({ kind, targetId });
				expect(scope).toEqual({ kind, targetId });
				expect(() => assertIssueScopeChanges([change], scope)).not.toThrow();
				expect(() =>
					assertIssueScopeChanges(
						[{ ...change, targetId: undefined } as ChangeInput],
						scope,
					),
				).toThrow("outside");
				expect(() =>
					assertIssueScopeChanges(
						[
							{
								...change,
								targetId: kind === "article_links" ? "28" : other,
							} as ChangeInput,
						],
						scope,
					),
				).toThrow("outside");
			}
		},
	);
	it.each([
		{},
		[],
		"metadata",
		{ kind: "__proto__" },
		{ kind: "unknown" },
		{ kind: "entry", targetId: id },
		{ kind: "metadata", targetId: "name" },
		{ kind: "metadata", targetId: null },
		{ kind: "metadata", targetId: id, extra: true },
		{ kind: "article_links", targetId: "027" },
		{ kind: "article_links", targetId: "0" },
		{ kind: "article_links", targetId: 27 },
	])("rejects malformed scope %j", (value) =>
		expect(() => validateIssueScope(value)).toThrow(),
	);
	it("compares stored identifier identity without changing case and never edits an entry through creation scope", () => {
		expect(
			validateIssueScope({ kind: "metadata", targetId: id.toUpperCase() }),
		).toEqual({ kind: "metadata", targetId: id.toUpperCase() });
		expect(() =>
			assertIssueScopeChanges(
				[{ kind: "metadata", targetId: id, after: { displayName: "שם" } }],
				{ kind: "metadata", targetId: id.toUpperCase() },
			),
		).not.toThrow();
		expect(() =>
			assertIssueScopeChanges(
				[
					{
						kind: "entry",
						targetId: id,
						after: {
							title: "שם",
							uniqueName: "שם",
							displayName: "שם",
							entityType: "PERSON",
						},
					},
				],
				{ kind: "entry" },
			),
		).toThrow("outside");
		expect(() =>
			assertIssueScopeChanges([
				{ kind: "metadata", targetId: id, after: { displayName: "שם" } },
			]),
		).not.toThrow();
	});
});
