/** @jest-environment node */
import { createSign, generateKeyPairSync } from "node:crypto";

interface Row {
	user_id: string;
	auth_user_id: string | null;
	installation_id: string;
	token: string;
	platform: string;
	topics: string;
	app_version: string;
}

const rows = new Map<string, Row>();
const mockQuery = jest.fn();
const mockTxQuery = jest.fn();
const mockTxExecute = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("@/lib/api-client", () => ({
	query: (...args: unknown[]) => mockQuery(...args),
	lockedTransaction: async (_name: string, fn: (conn: object) => unknown) =>
		fn({}),
	txQuery: (...args: unknown[]) => mockTxQuery(...args),
	txExecute: (...args: unknown[]) => mockTxExecute(...args),
}));

import { DELETE, POST } from "@/app/api/push/device/route";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const keyPair = { privateKey, publicKey };

function jwt(userId: string): string {
	const encode = (value: object) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const unsigned = `${encode({ alg: "RS256", kid: "test-key" })}.${encode({
		aud: "tanah-al-haperek",
		iss: "https://securetoken.google.com/tanah-al-haperek",
		sub: userId,
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 3600,
	})}`;
	const signature = createSign("RSA-SHA256")
		.update(unsigned)
		.sign(keyPair.privateKey, "base64url");
	return `${unsigned}.${signature}`;
}

function device(
	userId: string,
	installationId: string,
	token: string,
	legacyUserId?: string,
) {
	return {
		userId,
		installationId,
		token: `${token}:${"x".repeat(120)}`,
		platform: "android",
		topics: ["daily_perek"],
		appVersion: "5.2.0",
		...(legacyUserId ? { legacyUserId } : {}),
	};
}

function request(method: "POST" | "DELETE", body: unknown, userId?: string) {
	return new Request("http://localhost/api/push/device", {
		method,
		headers: userId ? { authorization: `Bearer ${jwt(userId)}` } : {},
		body: JSON.stringify(body),
	});
}

function installSqlFakes() {
	mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
		if (
			sql.includes(
				"DELETE FROM tanah_push_device WHERE user_id = ? AND auth_user_id IS NULL",
			)
		) {
			const row = rows.get(params[0] as string);
			if (row?.auth_user_id === null) rows.delete(row.user_id);
			return [];
		}
		throw new Error(`unexpected query: ${sql}`);
	});
	mockTxQuery.mockImplementation(
		async (_conn, sql: string, params: unknown[] = []) => {
			if (sql.includes("SELECT user_id, auth_user_id FROM tanah_push_device")) {
				const row = rows.get(params[0] as string);
				return row
					? [{ user_id: row.user_id, auth_user_id: row.auth_user_id }]
					: [];
			}
			if (
				sql.includes("SELECT user_id, auth_user_id, installation_id, token")
			) {
				const row = rows.get(params[0] as string);
				return row ? [row] : [];
			}
			if (sql.includes("SELECT COUNT(*) AS total"))
				return [{ total: rows.size }];
			throw new Error(`unexpected tx query: ${sql}`);
		},
	);
	mockTxExecute.mockImplementation(
		async (_conn, sql: string, params: unknown[]) => {
			if (sql.includes("INSERT INTO tanah_push_device")) {
				rows.set(params[0] as string, {
					user_id: params[0] as string,
					auth_user_id: params[1] as string,
					installation_id: params[2] as string,
					token: params[3] as string,
					platform: params[4] as string,
					topics: params[5] as string,
					app_version: params[6] as string,
				});
				return [];
			}
			if (
				sql.includes(
					"DELETE FROM tanah_push_device WHERE user_id = ? AND auth_user_id IS NULL",
				)
			) {
				const row = rows.get(params[0] as string);
				if (row?.auth_user_id === null) rows.delete(row.user_id);
				return [];
			}
			if (sql.includes("DELETE FROM tanah_push_device WHERE user_id = ?")) {
				rows.delete(params[0] as string);
				return [];
			}
			throw new Error(`unexpected tx execute: ${sql}`);
		},
	);
}

describe("/api/push/device installation ownership integration", () => {
	beforeEach(() => {
		rows.clear();
		jest.clearAllMocks();
		installSqlFakes();
		process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
			project_id: "tanah-al-haperek",
			client_email: "fcm-sender@tanah-al-haperek.iam.gserviceaccount.com",
			private_key: keyPair.privateKey,
		});
		global.fetch = jest.fn(
			async () =>
				new Response(JSON.stringify({ "test-key": keyPair.publicKey }), {
					status: 200,
					headers: { "cache-control": "public, max-age=3600" },
				}),
		) as unknown as typeof fetch;
	});

	it("rejects one installation changing or removing another installation's row", async () => {
		const first = device("auth-a", "fid-a", "token-a");
		expect((await POST(request("POST", first, "auth-a"))).status).toBe(201);

		const hijack = device("auth-a", "fid-b", "token-b");
		expect((await POST(request("POST", hijack, "auth-b"))).status).toBe(403);
		expect(rows.get("auth-a")?.installation_id).toBe("fid-a");

		const removal = await DELETE(
			request("DELETE", { userId: "auth-a" }, "auth-b"),
		);
		expect(removal.status).toBe(403);
		expect(rows.has("auth-a")).toBe(true);
	});

	it("lets the same verified installation rotate its token and opt out", async () => {
		expect(
			(
				await POST(
					request("POST", device("auth-a", "fid-a", "token-a"), "auth-a"),
				)
			).status,
		).toBe(201);
		expect(
			(
				await POST(
					request("POST", device("auth-a", "fid-a", "token-rotated"), "auth-a"),
				)
			).status,
		).toBe(201);
		expect(rows.get("auth-a")?.token).toContain("token-rotated");

		const response = await DELETE(
			request("DELETE", { userId: "auth-a" }, "auth-a"),
		);
		expect(response.status).toBe(200);
		expect(rows.has("auth-a")).toBe(false);
	});

	it("reports an unmatched unbound legacy row as still unresolved", async () => {
		rows.set("legacy-user", {
			user_id: "legacy-user",
			auth_user_id: null,
			installation_id: "other-installation",
			token: "other-token",
			platform: "android",
			topics: '["daily_perek"]',
			app_version: "5.1.8",
		});

		const response = await POST(
			request("POST", device("auth-a", "fid-a", "token-a", "legacy-user"), "auth-a"),
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			registered: true,
			legacyMigrated: false,
			legacyUnresolved: true,
		});
		expect(rows.has("legacy-user")).toBe(true);
		expect(rows.has("auth-a")).toBe(true);
	});

	it("migrates a matching legacy registration and keeps unauthenticated opt-out legacy-only", async () => {
		const legacyToken = `legacy-token:${"x".repeat(120)}`;
		rows.set("legacy-user", {
			user_id: "legacy-user",
			auth_user_id: null,
			installation_id: "fid-a",
			token: legacyToken,
			platform: "android",
			topics: '["daily_perek"]',
			app_version: "5.1.8",
		});
		const upgraded = {
			...device("auth-a", "fid-a", "token-a", "legacy-user"),
			token: legacyToken,
		};
		const migrated = await POST(request("POST", upgraded, "auth-a"));
		expect(migrated.status).toBe(201);
		expect(await migrated.json()).toEqual({
			registered: true,
			legacyMigrated: true,
			legacyUnresolved: false,
		});
		expect(rows.has("legacy-user")).toBe(false);
		expect(rows.get("auth-a")?.auth_user_id).toBe("auth-a");

		const blocked = await DELETE(request("DELETE", { userId: "auth-a" }));
		expect(blocked.status).toBe(200);
		expect(rows.has("auth-a")).toBe(true);

		const authRow = rows.get("auth-a");
		expect(authRow).toBeDefined();
		if (!authRow) throw new Error("auth row missing");
		rows.set("legacy-user", {
			...authRow,
			user_id: "legacy-user",
			auth_user_id: null,
		});
		expect(
			(await DELETE(request("DELETE", { userId: "legacy-user" }))).status,
		).toBe(200);
		expect(rows.has("legacy-user")).toBe(false);
	});
});
