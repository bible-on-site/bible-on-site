import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/archive/auth", () => ({
	authConfig: () => ({
		region: "us-east-1",
		pool: process.env.ARCHIVE_COGNITO_POOL_ID,
	}),
}));
vi.mock("~/server/archive/database", () => ({
	archiveStore: { home: vi.fn() },
}));

import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { syncAuthorDirectories } from "~/server/archive/authors";
import { archiveStore } from "~/server/archive/database";

const admin = {
	id: "11111111-1111-1111-1111-111111111111",
	username: "dorad",
	role: "admin" as const,
};
const id = "22222222-2222-2222-2222-222222222222";
const author = {
	Username: "author",
	Attributes: [
		{ Name: "sub", Value: id },
		{ Name: "name", Value: "מחבר" },
	],
};
let send: Mock;
let sequence = 0;
beforeEach(() => {
	vi.clearAllMocks();
	send = vi.spyOn(CognitoIdentityProviderClient.prototype, "send") as Mock;
	Object.assign(process.env, {
		ARCHIVE_COGNITO_POOL_ID: `authors-${++sequence}`,
		ARCHIVE_COGNITO_CLIENT_ID: "client",
		ARCHIVE_COGNITO_DOMAIN: "authors.example",
		ARCHIVE_ORIGIN: "https://site.example",
	});
	send.mockResolvedValue({ Users: [author] });
	(archiveStore.home as Mock).mockResolvedValue(id);
});
afterEach(() => vi.restoreAllMocks());

it("does not let an author enumerate other identities", async () => {
	await syncAuthorDirectories({ ...admin, role: "archiver" });
	expect(send).not.toHaveBeenCalled();
	expect(archiveStore.home).not.toHaveBeenCalled();
});
it("provisions named homes without creating accounts or granting administrator access", async () => {
	await syncAuthorDirectories(admin);
	expect(send.mock.calls[0][0].input).toMatchObject({
		UserPoolId: process.env.ARCHIVE_COGNITO_POOL_ID,
		Limit: 60,
	});
	expect(archiveStore.home).toHaveBeenCalledWith({
		id,
		username: "author",
		name: "מחבר",
		role: "archiver",
	});
});
it("deduplicates concurrent requests and caches successful reconciliation briefly", async () => {
	await Promise.all([
		syncAuthorDirectories(admin),
		syncAuthorDirectories(admin),
	]);
	await syncAuthorDirectories(admin);
	expect(send).toHaveBeenCalledTimes(1);
	const now = Date.now();
	vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
	await syncAuthorDirectories(admin);
	expect(send).toHaveBeenCalledTimes(2);
});
it("paginates all profiles and skips incomplete identities until their names are supplied", async () => {
	send
		.mockResolvedValueOnce({
			Users: [
				{},
				{ ...author, Username: undefined },
				{ Username: "missing-name", Attributes: [{ Name: "sub", Value: id }] },
				{ Username: "bad-id", Attributes: [{ Name: "sub", Value: "../" }] },
			],
			PaginationToken: "page-2",
		})
		.mockResolvedValueOnce({
			Users: Array.from({ length: 60 }, () => author),
			PaginationToken: "page-3",
		})
		.mockResolvedValueOnce({});
	await syncAuthorDirectories(admin);
	expect(send.mock.calls[1][0].input.PaginationToken).toBe("page-2");
	expect(archiveStore.home).toHaveBeenCalledTimes(60);
});
it("does not cache failures and rejects a stalled pagination token", async () => {
	send.mockRejectedValueOnce(new Error("provider unavailable"));
	await expect(syncAuthorDirectories(admin)).rejects.toThrow(
		"provider unavailable",
	);
	send
		.mockResolvedValueOnce({ PaginationToken: "repeat" })
		.mockResolvedValueOnce({ PaginationToken: "repeat" });
	await expect(syncAuthorDirectories(admin)).rejects.toThrow(
		"pagination stalled",
	);
	send.mockResolvedValue({ Users: [author] });
	await syncAuthorDirectories(admin);
	expect(archiveStore.home).toHaveBeenCalled();
});
