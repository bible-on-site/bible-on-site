import { test, expect, type APIResponse } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003/api/graphql";

test("basic test", async ({ request }) => {
	const response: APIResponse = await request.post(ROOT_URL, {
		headers: {
			"Content-Type": "application/json",
		},
		data: {
			operationName: null,
			variables: {},
			query:
				"{\n  authorById(id: 1) {\n    id\n    name\n    details\n  }\n}\n",
		},
	});
	const responseBody = await response.json();
	// Expect a title "to contain" a substring.
	expect(responseBody).toMatchObject({
		data: {
			authorById: {
				id: 1,
				name: "תיאור לדוגמא",
				details: 'הרב לדוגמא שליט"א',
			},
		},
	});
});
