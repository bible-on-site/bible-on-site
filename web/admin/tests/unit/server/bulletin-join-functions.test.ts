import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	methods: [] as string[],
	imports: 0,
	read: vi.fn(),
	audit: vi.fn(),
	update: vi.fn(),
	cookie: vi.fn(),
	verify: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: ({ method }: { method: string }) => {
		mocks.methods.push(method);
		return {
			handler:
				(handler: (context: { data?: unknown }) => Promise<unknown>) =>
				async ({ data }: { data?: unknown } = {}) =>
					handler({ data }),
			validator: (validate: (data: unknown) => unknown) => ({
				handler:
					(handler: (context: { data: unknown }) => Promise<unknown>) =>
					async ({ data }: { data: unknown }) =>
						handler({ data: validate(data) }),
			}),
		};
	},
}));
vi.mock("@tanstack/react-start/server", () => ({
	getCookie: mocks.cookie,
}));
vi.mock("~/server/join-links.server", () => {
	mocks.imports++;
	return {
		readJoinLinks: mocks.read,
		readJoinLinkAudit: mocks.audit,
		updateJoinLink: mocks.update,
	};
});
vi.mock("~/server/auth", () => ({
	verifyIdTokenClaims: mocks.verify,
}));

import {
	getBulletinJoinLinks,
	updateBulletinJoinLink,
} from "~/server/bulletin-join";

const importsBeforeRequest = mocks.imports;
const change = {
	channel: "telegram",
	enabled: true,
	destination: "https://t.me/alhaperek",
	expectedRevision: 1,
};

describe("bulletin join server-function adapters", () => {
	beforeEach(() => {
		for (const fn of [
			mocks.read,
			mocks.audit,
			mocks.update,
			mocks.cookie,
			mocks.verify,
		])
			fn.mockReset();
		vi.stubEnv("SKIP_AUTH", "true");
		mocks.read.mockResolvedValue([]);
		mocks.audit.mockResolvedValue([]);
		mocks.update.mockResolvedValue({ revision: 2 });
	});
	afterEach(() => vi.unstubAllEnvs());

	it("declares a cached GET and one explicit POST without eager persistence imports", () => {
		expect(mocks.methods).toEqual(["GET", "POST"]);
		expect(importsBeforeRequest).toBe(0);
	});

	it("returns the links together with the short audit tail", async () => {
		mocks.read.mockResolvedValue([{ channel: "telegram", revision: 3 }]);
		mocks.audit.mockResolvedValue([{ id: 8 }]);
		expect(await getBulletinJoinLinks()).toEqual({
			links: [{ channel: "telegram", revision: 3 }],
			audit: [{ id: 8 }],
		});
		expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(undefined, 10);
	});

	it("validates the change before persistence and records the local editor", async () => {
		expect(await updateBulletinJoinLink({ data: change })).toEqual({
			revision: 2,
		});
		expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
			...change,
			changedBy: "local",
		});
	});

	it("labels the audit with the verified session identity", async () => {
		vi.stubEnv("SKIP_AUTH", "false");
		mocks.cookie.mockReturnValue("session-token");
		mocks.verify.mockResolvedValue({
			sub: "cognito-sub",
			email: "editor@example.com",
		});
		await updateBulletinJoinLink({ data: change });
		expect(mocks.verify).toHaveBeenCalledExactlyOnceWith("session-token");
		expect(mocks.update.mock.calls[0][0].changedBy).toBe("editor@example.com");
	});

	it("degrades to the generic marker when the session cannot be read", async () => {
		vi.stubEnv("SKIP_AUTH", "false");
		mocks.cookie.mockReturnValue(undefined);
		mocks.verify.mockResolvedValue(null);
		await updateBulletinJoinLink({ data: change });
		expect(mocks.update.mock.calls[0][0].changedBy).toBe("admin");
	});

	it("rejects invalid payloads in the validator, before persistence", async () => {
		await expect(
			updateBulletinJoinLink({
				data: { channel: "email", enabled: true, expectedRevision: 0 },
			}),
		).rejects.toThrow();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("uses a bounded verified subject when the session has no email", async () => {
		vi.stubEnv("SKIP_AUTH", "false");
		mocks.cookie.mockReturnValue("session-token");
		mocks.verify.mockResolvedValue({ sub: "s".repeat(150) });
		await updateBulletinJoinLink({ data: change });
		expect(mocks.update.mock.calls[0][0].changedBy).toBe("s".repeat(120));
	});

	it("keeps a legitimate save available when session-label lookup rejects", async () => {
		vi.stubEnv("SKIP_AUTH", "false");
		mocks.cookie.mockReturnValue("session-token");
		mocks.verify.mockRejectedValue(new Error("private identity details"));
		await updateBulletinJoinLink({ data: change });
		expect(mocks.update.mock.calls[0][0].changedBy).toBe("admin");
	});
});
