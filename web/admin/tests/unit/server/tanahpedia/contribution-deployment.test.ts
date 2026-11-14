import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), migrate: vi.fn() }));
vi.mock("jose", () => ({
	createRemoteJWKSet: () => "github-keys",
	jwtVerify: mocks.verify,
}));
vi.mock("~/server/tanahpedia/contribution-migrations.server", () => ({
	migrateOpenContributionPrs: mocks.migrate,
}));

import {
	handleContributionMigrationRequest,
	MIGRATION_AUDIENCE,
} from "~/server/tanahpedia/contribution-deployment.server";

const payload = {
	repository: "bible-on-site/bible-on-site",
	repository_id: "810119373",
	ref: "refs/heads/master",
	event_name: "repository_dispatch",
	workflow_ref:
		"bible-on-site/bible-on-site/.github/workflows/cd-aws.yml@refs/heads/master",
};
function request(token = "valid", method = "POST") {
	return new Request("https://admin.example/api/contributions/migrate", {
		method,
		headers: token
			? { Authorization: `Bearer ${token}` }
			: { Cookie: "admin_session=owner" },
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.verify.mockResolvedValue({ payload });
	mocks.migrate.mockResolvedValue({
		apiVersion: 1,
		scanned: 3,
		migrated: 1,
		failed: 1,
		unchanged: 1,
	});
});
describe("deployment migration authentication", () => {
	it("accepts only the signed deployment identity and returns a content-free receipt", async () => {
		const response = await handleContributionMigrationRequest(request());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			apiVersion: 1,
			scanned: 3,
			migrated: 1,
			failed: 1,
			unchanged: 1,
		});
		expect(mocks.verify).toHaveBeenCalledWith(
			"valid",
			"github-keys",
			expect.objectContaining({
				issuer: "https://token.actions.githubusercontent.com",
				audience: MIGRATION_AUDIENCE,
				algorithms: ["RS256"],
				requiredClaims: ["exp", "iat", "sub"],
			}),
		);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});
	it.each(["repository", "repository_id", "ref", "event_name", "workflow_ref"])(
		"rejects the wrong %s even with a valid JWT",
		async (key) => {
			mocks.verify.mockResolvedValue({
				payload: { ...payload, [key]: "untrusted" },
			});
			expect((await handleContributionMigrationRequest(request())).status).toBe(
				403,
			);
			expect(mocks.migrate).not.toHaveBeenCalled();
		},
	);
	it("rejects browser sessions, malformed or expired tokens and wrong methods", async () => {
		expect((await handleContributionMigrationRequest(request(""))).status).toBe(
			401,
		);
		expect(
			(await handleContributionMigrationRequest(request("x".repeat(16001))))
				.status,
		).toBe(401);
		expect(
			(await handleContributionMigrationRequest(request("valid", "GET")))
				.status,
		).toBe(405);
		mocks.verify.mockRejectedValue(new Error("expired"));
		expect((await handleContributionMigrationRequest(request())).status).toBe(
			401,
		);
		expect(mocks.migrate).not.toHaveBeenCalled();
	});
	it("fails the CD hook on a database error without leaking database details", async () => {
		mocks.migrate.mockRejectedValue(new Error("private database address"));
		const response = await handleContributionMigrationRequest(request());
		expect(response.status).toBe(503);
		expect(await response.text()).toBe("Migration storage unavailable");
	});
});
