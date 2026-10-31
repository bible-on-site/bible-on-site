import { expect, test } from "@playwright/test";

const name = "isolated-unauthorized-alias-probe";
const entryId = "00000000-0000-0000-0000-000000000000";
const operations = [
	{
		field: "tanahpediaNameStatus",
		query: `query { tanahpediaNameStatus(name: "${name}") { kind } }`,
	},
	{
		field: "tanahpediaEntryAliases",
		query: `query { tanahpediaEntryAliases(entryId: "${entryId}") { name } }`,
	},
	{
		field: "saveTanahpediaAlias",
		query: `mutation { saveTanahpediaAlias(input: { name: "${name}", targets: [{ entryId: "${entryId}" }], expectedTargets: [] }) { name } }`,
	},
	{
		field: "removeTanahpediaEntryFromAlias",
		query: `mutation { removeTanahpediaEntryFromAlias(name: "${name}", entryId: "${entryId}") { name } }`,
	},
	{
		field: "deleteTanahpediaAlias",
		query: `mutation { deleteTanahpediaAlias(name: "${name}") { name } }`,
	},
];

for (const authorization of [undefined, "Bearer invalid-fixture-key"]) {
	for (const operation of operations) {
		test(`${operation.field} rejects ${authorization ? "an invalid" : "a missing"} bearer key over HTTP`, async ({
			request,
		}) => {
			const response = await request.post("/", {
				data: { query: operation.query },
				headers: authorization ? { Authorization: authorization } : {},
				timeout: 2000,
				maxRetries: 0,
				maxRedirects: 0,
			});
			expect(response.status()).toBe(200);
			const body = await response.json();
			expect(body.data).toBeNull();
			expect(body.errors).toHaveLength(1);
			expect(body.errors[0].extensions.code).toBe("UNAUTHORIZED");
			expect(body.errors[0].path).toEqual([operation.field]);
		});
	}
}
