import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../util/deferred";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import {
	WhatsAppClient,
	WhatsAppDeferredError,
	WhatsAppError,
	WhatsAppSuppressedError,
} from "~/server/whatsapp-client.server";

const TOKEN = "test_token_test_token_test_token";
const INSTANCE = "111111111111";
const PHONE = "15550000001";
const SENDER = "222222222222222@lid";
const OWNER = "333333333333333@lid";
const GROUP = "111111111111111111@g.us";
const MESSAGE = "AAAAAAAAAAAAAAAAAAAA";
const PDF = new TextEncoder().encode(
	"%PDF-1.7\nimmutable fixture bytes\n%%EOF",
);
const sha = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex");
const participantDigest = `sha256:${sha(JSON.stringify([SENDER, OWNER].sort()))}`;
const config = {
	instanceId: INSTANCE,
	apiToken: TOKEN,
	apiUrl: "https://api.greenapi.com",
	mediaUrl: "https://media.greenapi.com",
	expectedSenderPhone: PHONE,
};
const target = {
	groupId: GROUP,
	audience: "test" as const,
	expectedParticipantDigest: participantDigest,
};
const documentRequest = {
	groupId: GROUP,
	audience: "test" as const,
	senderId: SENDER,
	senderPhone: PHONE,
	participantDigest,
	pdfSha256: sha(PDF),
	pdf: PDF,
	filename: "chapter.pdf",
	caption: 'בראשית א\nלימוד יומי בתנ"ך על הפרק\nhttps://example.com/929/1',
	beforeSend: async () => {},
};
const messageRequest = {
	groupId: GROUP,
	messageId: MESSAGE,
	senderId: SENDER,
	filename: "chapter.pdf",
};
type Values = Record<string, unknown>;
function metadata(): Values {
	return {
		getStateInstance: { stateInstance: "authorized" },
		getWaSettings: {
			stateInstance: "authorized",
			chatId: SENDER,
			phone: PHONE,
			logoutProcess: false,
		},
		getSettings: { wid: `${PHONE}@c.us`, outgoingWebhook: "yes" },
		getGroupData: {
			groupId: GROUP,
			subject: "Private fixture",
			size: 2,
			isCommunity: false,
			isCommunityAnnounce: false,
			allowParticipantsSendMessages: false,
			participants: [
				{
					id: SENDER,
					lid: SENDER,
					phoneNumber: "",
					isAdmin: true,
					isSuperAdmin: false,
				},
				{
					id: OWNER,
					lid: OWNER,
					phoneNumber: "",
					isAdmin: false,
					isSuperAdmin: true,
				},
			],
		},
	};
}
function journal(): Values {
	return {
		type: "outgoing",
		sendByApi: true,
		idMessage: MESSAGE,
		chatId: GROUP,
		typeMessage: "documentMessage",
		mimeType: "application/pdf",
		fileName: "chapter.pdf",
		statusMessage: "delivered",
	};
}
function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
function method(input: RequestInfo | URL): string {
	return new URL(String(input)).pathname.split("/").at(-2) ?? "";
}
function provider(
	values = metadata(),
	send: () => Response | Promise<Response> = () =>
		json({
			idMessage: MESSAGE,
			urlFile: "https://example.com/never-fetch.pdf",
		}),
	message: () => Response | Promise<Response> = () => json(journal()),
) {
	return vi.fn<typeof fetch>(async (input) => {
		const operation = method(input);
		if (operation === "sendFileByUpload") return send();
		if (operation === "getMessage") return message();
		return json(values[operation]);
	});
}
async function outcome(
	pending: Promise<unknown>,
	expected: "failed" | "uncertain",
) {
	try {
		await pending;
		throw new Error("Expected a fixed provider error");
	} catch (error) {
		expect(error).toBeInstanceOf(WhatsAppError);
		const failure = error as WhatsAppError;
		expect(failure.outcome).toBe(expected);
		expect(
			`${failure}\n${failure.stack}\n${JSON.stringify(failure)}`,
		).not.toContain(TOKEN);
		expect(failure.cause).toBeUndefined();
		return failure;
	}
}
async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Promise((resolve, fail) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = fail;
		reader.readAsArrayBuffer(blob);
	});
}
async function flush() {
	for (let index = 0; index < 40; index++) await Promise.resolve();
}
beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("Real network forbidden"),
	);
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
	expect(globalThis.fetch).not.toHaveBeenCalled();
	expect(console.error).not.toHaveBeenCalled();
	expect(console.warn).not.toHaveBeenCalled();
	expect(console.log).not.toHaveBeenCalled();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("GREEN-API configuration and metadata", () => {
	it.each([
		{ instanceId: "" },
		{ instanceId: "00001234" },
		{ instanceId: "1234/getMessage" },
		{ apiToken: "short" },
		{ apiToken: `${TOKEN}/other` },
		{ apiToken: `${TOKEN}?query` },
		{ expectedSenderPhone: "phone" },
		{ expectedSenderPhone: "1555 0000001" },
		{ apiUrl: "http://api.greenapi.com" },
		{ apiUrl: "not a URL" },
		{ apiUrl: "https://example.com" },
		{ apiUrl: "https://api.greenapi.com.example.com" },
		{ apiUrl: "https://api.greenapi.com:444" },
		{ apiUrl: "https://user:password@api.greenapi.com" },
		{ apiUrl: "https://api.greenapi.com/path" },
		{ apiUrl: "https://api.greenapi.com/?token=x" },
		{ apiUrl: "https://api.greenapi.com/#fragment" },
		{ apiUrl: "https://api.greenapi.com/../" },
		{ mediaUrl: "https://media.greenapi.com.example.com" },
	])("rejects invalid settings before any request (%j)", (override) => {
		const fetchMock = provider();
		expect(
			() => new WhatsAppClient({ ...config, ...override }, fetchMock),
		).toThrow(WhatsAppError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("accepts a twelve-digit instance and matches hidden-phone participants by LID", async () => {
		const fetchMock = provider();
		await expect(
			new WhatsAppClient(
				{
					...config,
					apiToken: ` ${TOKEN} `,
					expectedSenderPhone: ` +${PHONE} `,
				},
				fetchMock,
			).verifyTarget(target),
		).resolves.toEqual({
			groupId: GROUP,
			title: "Private fixture",
			size: 2,
			senderId: SENDER,
			senderPhone: PHONE,
			participantDigest,
			outgoingStatusesEnabled: true,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const signals = new Set(
			fetchMock.mock.calls.map(([, init]) => init?.signal),
		);
		expect(signals.size).toBe(1);
		for (const [url, init] of fetchMock.mock.calls) {
			expect(String(url)).toContain(`/waInstance${INSTANCE}/`);
			expect(new URL(String(url)).origin).toBe(config.apiUrl);
			expect(init?.redirect).toBe("error");
			expect(init?.signal?.aborted).toBe(true);
			expect(init?.method).toBe(
				method(url) === "getGroupData" ? "POST" : "GET",
			);
		}
		expect(
			JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string),
		).toEqual({ groupId: GROUP });
	});
	it("accepts universal and documented vendor-specific hosts without deriving them", async () => {
		for (const apiUrl of [
			"https://api.green-api.com/",
			"https://7107.api.greenapi.com",
			"https://7201.api.green-api.com",
		]) {
			const fetchMock = provider();
			await new WhatsAppClient(
				{ ...config, apiUrl, mediaUrl: apiUrl },
				fetchMock,
			).verifyTarget(target);
			expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe(
				new URL(apiUrl).origin,
			);
		}
	});
	it.each([
		"notAuthorized",
		"blocked",
		"sleepMode",
		"starting",
		"suspended",
		"yellowCard",
		"unrecognized",
	])("blocks connection state %s", async (state) => {
		const values = metadata();
		values.getStateInstance = { stateInstance: state };
		const fetchMock = provider(values);
		const failure = await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		expect(failure.connectionState).toBe(
			state === "yellowCard"
				? "suspended"
				: state === "unrecognized"
					? "unknown"
					: state,
		);
		expect(
			fetchMock.mock.calls.some(([url]) => method(url) === "getGroupData"),
		).toBe(false);
	});
	it("rejects inconsistent account state and aborts other metadata requests", async () => {
		const values = metadata();
		values.getWaSettings = {
			...(values.getWaSettings as Values),
			stateInstance: "blocked",
		};
		const fetchMock = provider(values);
		const failure = await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		expect(failure.connectionState).toBe("blocked");
		expect(
			fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
		).toBe(true);
	});
	it.each([
		{ phone: "15550000002" },
		{ phone: "" },
		{ chatId: "wrong" },
		{ logoutProcess: true },
	])("blocks changed or incomplete sender metadata (%j)", async (override) => {
		const values = metadata();
		values.getWaSettings = { ...(values.getWaSettings as Values), ...override };
		await outcome(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
			"failed",
		);
	});
	it.each([
		{ outgoingWebhook: "no" },
		{ outgoingWebhook: true },
		{ wid: "444444444444444@lid" },
		{ wid: undefined },
	])(
		"requires status tracking and the same connected account (%j)",
		async (override) => {
			const values = metadata();
			values.getSettings = { ...(values.getSettings as Values), ...override };
			await outcome(
				new WhatsAppClient(config, provider(values)).verifyTarget(target),
				"failed",
			);
		},
	);
	it("also recognizes the connected LID in instance settings", async () => {
		const values = metadata();
		values.getSettings = { wid: SENDER, outgoingWebhook: "yes" };
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).resolves.toMatchObject({ senderId: SENDER });
	});
	it.each([
		{ groupId: "222222222222222222@g.us" },
		{ subject: "" },
		{ subject: "bad\nname" },
		{ subject: "x".repeat(257) },
		{ isCommunity: true },
		{ isCommunityAnnounce: true },
		{ size: 3 },
		{ size: "2" },
		{ participants: [] },
		{ participants: null },
		{ allowParticipantsSendMessages: "yes" },
	])("rejects unsafe or inconsistent group metadata (%j)", async (override) => {
		const values = metadata();
		values.getGroupData = { ...(values.getGroupData as Values), ...override };
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).rejects.toBeInstanceOf(WhatsAppSuppressedError);
	});
	it.each([
		{ id: "wrong" },
		{ lid: "wrong" },
		{ phoneNumber: "wrong" },
		{ isAdmin: "true" },
		{ isSuperAdmin: undefined },
	])(
		"rejects invalid membership and permission types (%j)",
		async (override) => {
			const values = metadata();
			const group = values.getGroupData as Values;
			(group.participants as Values[])[0] = {
				...(group.participants as Values[])[0],
				...override,
			};
			await expect(
				new WhatsAppClient(config, provider(values)).verifyTarget(target),
			).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		},
	);
	it("rejects duplicate members, an absent sender, and two sender aliases", async () => {
		for (const members of [
			[SENDER, SENDER],
			[OWNER, "444444444444444@lid"],
			[SENDER, `${PHONE}@c.us`],
		]) {
			const values = metadata();
			(values.getGroupData as Values).participants = members.map((id) => ({
				id,
				isAdmin: true,
				isSuperAdmin: false,
			}));
			await expect(
				new WhatsAppClient(config, provider(values)).verifyTarget({
					...target,
					audience: "real",
					expectedParticipantDigest: undefined,
				}),
			).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		}
	});
	it("requires sending rights but permits ordinary members when everyone can post", async () => {
		const values = metadata();
		const group = values.getGroupData as Values;
		(group.participants as Values[])[0].isAdmin = false;
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		group.allowParticipantsSendMessages = true;
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).resolves.toMatchObject({ groupId: GROUP });
	});
	it("allows a super-admin sender and legacy phone group/participant IDs", async () => {
		const values = metadata();
		(values.getWaSettings as Values).chatId = `${PHONE}@c.us`;
		const group = values.getGroupData as Values;
		group.groupId = "15550000001-1234567890@g.us";
		group.participants = [
			{ id: `${PHONE}@c.us`, isAdmin: false, isSuperAdmin: true },
		];
		group.size = 1;
		const digest = `sha256:${sha(JSON.stringify([`${PHONE}@c.us`]))}`;
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget({
				...target,
				groupId: group.groupId as string,
				expectedParticipantDigest: digest,
			}),
		).resolves.toMatchObject({ size: 1 });
	});
	it("sorts LIDs for a stable membership pin and rejects a changed test audience", async () => {
		const values = metadata();
		(values.getGroupData as Values).participants = (
			(values.getGroupData as Values).participants as unknown[]
		).reverse();
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).resolves.toMatchObject({ participantDigest });
		const members = (values.getGroupData as Values).participants as Values[];
		members[0] = {
			...members[0],
			id: "444444444444444@lid",
			lid: "444444444444444@lid",
		};
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).rejects.toBeInstanceOf(WhatsAppSuppressedError);
	});
	it("permits additional real-group members but never additional test members", async () => {
		const values = metadata();
		const group = values.getGroupData as Values;
		(group.participants as Values[]).push({
			id: "444444444444444@lid",
			isAdmin: false,
			isSuperAdmin: false,
		});
		group.size = 3;
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget(target),
		).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		await expect(
			new WhatsAppClient(config, provider(values)).verifyTarget({
				groupId: GROUP,
				audience: "real",
			}),
		).resolves.toMatchObject({ size: 3 });
	});
	it.each([
		{ ...target, groupId: "15550000001@c.us" },
		{ ...target, audience: "all" },
		{ ...target, expectedParticipantDigest: undefined },
		{ ...target, expectedParticipantDigest: "wrong" },
	])("rejects invalid target input before requests (%j)", async (bad) => {
		const fetchMock = provider();
		await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(bad as typeof target),
			"failed",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("releases the metadata lease after success and provider refusal", async () => {
		for (const refused of [false, true]) {
			const release = vi.fn(async () => {});
			const gate = vi.fn(async (signal: AbortSignal) => {
				expect(signal.aborted).toBe(false);
				return release;
			});
			const values = metadata();
			const fetchMock = provider(values);
			if (refused)
				fetchMock.mockImplementation(async (url) =>
					method(url) === "getGroupData"
						? json({ error: "private refusal" }, 429)
						: json(values[method(url)]),
				);
			const pending = new WhatsAppClient(config, fetchMock).verifyTarget({
				...target,
				beforeGroupData: gate,
			});
			if (refused) await outcome(pending, "failed");
			else await pending;
			expect(gate).toHaveBeenCalledTimes(1);
			expect(release).toHaveBeenCalledTimes(1);
		}
	});
	it("propagates a safe busy gate without requesting group data or uploading", async () => {
		const fetchMock = provider();
		const deferred = new WhatsAppDeferredError();
		await expect(
			new WhatsAppClient(config, fetchMock).verifyTarget({
				...target,
				beforeGroupData: async () => {
					throw deferred;
				},
			}),
		).rejects.toBe(deferred);
		expect(
			fetchMock.mock.calls.some(([url]) => method(url) === "getGroupData"),
		).toBe(false);
	});
	it("sanitizes unknown metadata gate and release failures", async () => {
		for (const beforeGroupData of [
			async () => {
				throw new Error(TOKEN);
			},
			async () => async () => {
				throw new Error(TOKEN);
			},
		]) {
			await outcome(
				new WhatsAppClient(config, provider()).verifyTarget({
					...target,
					beforeGroupData,
				}),
				"failed",
			);
		}
	});
});

describe("immutable single-attempt PDF upload", () => {
	it("uploads exact frozen PDF bytes after verification, metadata release and the claim gate", async () => {
		const release = vi.fn(async () => {});
		const beforeSend = vi.fn(async () => {
			expect(release).toHaveBeenCalledTimes(1);
		});
		const fetchMock = provider();
		await expect(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeGroupData: async () => release,
				beforeSend,
			}),
		).resolves.toEqual({ messageId: MESSAGE });
		const uploads = fetchMock.mock.calls.filter(
			([url]) => method(url) === "sendFileByUpload",
		);
		expect(uploads).toHaveLength(1);
		expect(beforeSend).toHaveBeenCalledTimes(1);
		expect(beforeSend.mock.invocationCallOrder[0]).toBeLessThan(
			fetchMock.mock.invocationCallOrder.at(-1) as number,
		);
		const [url, init] = uploads[0];
		expect(new URL(String(url)).origin).toBe(config.mediaUrl);
		expect(init?.redirect).toBe("error");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toBeUndefined();
		const form = init?.body as FormData;
		expect([...form.keys()]).toEqual(["chatId", "file", "fileName", "caption"]);
		expect(form.get("chatId")).toBe(GROUP);
		expect(form.get("fileName")).toBe(documentRequest.filename);
		expect(form.get("caption")).toBe(documentRequest.caption);
		const file = form.get("file") as File;
		expect(file.name).toBe(documentRequest.filename);
		expect(file.type).toBe("application/pdf");
		expect(Array.from(await bytes(file))).toEqual(Array.from(PDF));
		expect(
			fetchMock.mock.calls.some(([request]) =>
				String(request).includes("never-fetch"),
			),
		).toBe(false);
	});
	it("copies PDF bytes before asynchronous metadata so later buffer mutation cannot change the post", async () => {
		const pdf = new Uint8Array(PDF);
		const fetchMock = provider();
		const client = new WhatsAppClient(config, fetchMock);
		const pending = client.sendDocument({ ...documentRequest, pdf });
		pdf.fill(0);
		await pending;
		const form = fetchMock.mock.calls.at(-1)?.[1]?.body as FormData;
		expect(Array.from(await bytes(form.get("file") as Blob))).toEqual(
			Array.from(PDF),
		);
	});
	it.each([
		{ pdf: new Uint8Array() },
		{ pdf: {} },
		{ pdf: new TextEncoder().encode("not a PDF") },
		{ pdfSha256: "0".repeat(64) },
		{ pdfSha256: "bad" },
		{ senderId: "wrong" },
		{ senderPhone: "15550000002" },
		{ participantDigest: "bad" },
		{ filename: "" },
		{ filename: "../chapter.pdf" },
		{ filename: "folder\\chapter.pdf" },
		{ filename: "chapter\r\n.pdf" },
		{ filename: "\ufeffchapter.pdf" },
		{ filename: "chapter.txt" },
		{ filename: `${"a".repeat(252)}.pdf` },
		{ caption: "a".repeat(1025) },
		{ caption: "bad\u0000caption" },
		{ caption: "bad\r\ncaption" },
		{ beforeSend: undefined },
	])(
		"blocks invalid bytes, identity, caption or filename before any call (%j)",
		async (override) => {
			const fetchMock = provider();
			await outcome(
				new WhatsAppClient(config, fetchMock).sendDocument({
					...documentRequest,
					...override,
				} as typeof documentRequest),
				"failed",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it("rejects the documented 100 MB edge before copying or uploading", async () => {
		const fetchMock = provider();
		await outcome(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				pdf: new Uint8Array(100_000_000),
			}),
			"failed",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("does not upload or claim when refreshed sender or membership differs", async () => {
		for (const override of [
			{ senderId: OWNER },
			{ participantDigest: `sha256:${"0".repeat(64)}` },
		]) {
			const fetchMock = provider();
			const beforeSend = vi.fn(async () => {});
			await expect(
				new WhatsAppClient(config, fetchMock).sendDocument({
					...documentRequest,
					...override,
					beforeSend,
				}),
			).rejects.toBeInstanceOf(WhatsAppSuppressedError);
			expect(beforeSend).not.toHaveBeenCalled();
			expect(
				fetchMock.mock.calls.some(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toBe(false);
		}
	});
	it("keeps a changed real-group membership valid while freezing its sender and group", async () => {
		const values = metadata();
		const group = values.getGroupData as Values;
		(group.participants as Values[]).push({
			id: "444444444444444@lid",
			isAdmin: false,
			isSuperAdmin: false,
		});
		group.size = 3;
		await expect(
			new WhatsAppClient(config, provider(values)).sendDocument({
				...documentRequest,
				audience: "real",
			}),
		).resolves.toEqual({ messageId: MESSAGE });
	});
	it("propagates safe deferral before upload and sanitizes any other claim error", async () => {
		for (const deferred of [false, true]) {
			const fetchMock = provider();
			const error = deferred ? new WhatsAppDeferredError() : new Error(TOKEN);
			const pending = new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend: async () => {
					throw error;
				},
			});
			if (deferred) await expect(pending).rejects.toBe(error);
			else await outcome(pending, "failed");
			expect(
				fetchMock.mock.calls.some(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toBe(false);
		}
	});
	it.each([400, 401, 403, 413, 429, 466])(
		"treats explicit HTTP %s refusal as failed without retries",
		async (status) => {
			const fetchMock = provider(metadata(), () =>
				json({ error: TOKEN }, status),
			);
			await outcome(
				new WhatsAppClient(config, fetchMock).sendDocument(documentRequest),
				"failed",
			);
			expect(
				fetchMock.mock.calls.filter(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toHaveLength(1);
		},
	);
	it.each([408, 500, 502, 503, 307])(
		"keeps HTTP %s upload outcomes uncertain with no fallback host",
		async (status) => {
			const fetchMock = provider(metadata(), () =>
				json({ error: TOKEN }, status),
			);
			await outcome(
				new WhatsAppClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(
				fetchMock.mock.calls.filter(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toHaveLength(1);
		},
	);
	it.each([
		null,
		[],
		{},
		{ idMessage: "short" },
		{ idMessage: MESSAGE, error: TOKEN },
		{ idMessage: MESSAGE, errorMessage: TOKEN },
	])(
		"does not call malformed successful upload responses sent (%j)",
		async (body) => {
			const fetchMock = provider(metadata(), () => json(body));
			await outcome(
				new WhatsAppClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(
				fetchMock.mock.calls.filter(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toHaveLength(1);
		},
	);
	it("recognizes the documented HTTP 200 upload failure without a provider ID", async () => {
		for (const body of [
			"failed to upload file",
			{ error: "failed to upload file: private details" },
		]) {
			await outcome(
				new WhatsAppClient(
					config,
					provider(metadata(), () => json(body)),
				).sendDocument(documentRequest),
				"failed",
			);
		}
	});
	it("sanitizes network errors and unparseable UTF-8 after upload begins", async () => {
		for (const send of [
			async () => {
				throw new Error(`https://example.com/${TOKEN}`);
			},
			() => new Response(new Uint8Array([255, 255])),
		]) {
			const fetchMock = provider(metadata(), send);
			await outcome(
				new WhatsAppClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(
				fetchMock.mock.calls.filter(
					([url]) => method(url) === "sendFileByUpload",
				),
			).toHaveLength(1);
		}
	});
});

describe("known-message reconciliation", () => {
	it.each([
		"pending",
		"sent",
		"delivered",
		"read",
		"failed",
		"suspended",
		"noAccount",
		"notInGroup",
		"yellowCard",
	])("maps status %s without another upload", async (status) => {
		const fetchMock = provider(metadata(), undefined, () =>
			json({ ...journal(), statusMessage: status, description: TOKEN }),
		);
		await expect(
			new WhatsAppClient(config, fetchMock).getMessage(messageRequest),
		).resolves.toEqual({
			status: status === "yellowCard" ? "suspended" : status,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(method(fetchMock.mock.calls[0][0])).toBe("getMessage");
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
			chatId: GROUP,
			idMessage: MESSAGE,
		});
	});
	it.each([
		"chatId not found",
		`Message not found by id '${MESSAGE}'`,
		{ error: `Message not found by id '${MESSAGE}'` },
	])("keeps recognized journal lag pending (%j)", async (body) => {
		const fetchMock = provider(metadata(), undefined, () => json(body, 400));
		await expect(
			new WhatsAppClient(config, fetchMock).getMessage(messageRequest),
		).resolves.toEqual({ status: "pending" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it.each([
		{ type: "incoming" },
		{ sendByApi: false },
		{ idMessage: "BBBBBBBBBBBBBBBBBBBB" },
		{ chatId: "222222222222222222@g.us" },
		{ typeMessage: "textMessage" },
		{ mimeType: "text/plain" },
		{ fileName: "other.pdf" },
		{ senderId: OWNER },
		{ statusMessage: "unknown" },
	])("refuses mismatched known-message evidence (%j)", async (override) => {
		await outcome(
			new WhatsAppClient(
				config,
				provider(metadata(), undefined, () =>
					json({ ...journal(), ...override }),
				),
			).getMessage(messageRequest),
			"failed",
		);
	});
	it("accepts a verified sender alias and permits optional filename checks to be omitted", async () => {
		const fetchMock = provider(metadata(), undefined, () =>
			json({
				...journal(),
				senderId: `${PHONE}@c.us`,
				fileName: "server-frozen.pdf",
			}),
		);
		await expect(
			new WhatsAppClient(config, fetchMock).getMessage({
				...messageRequest,
				filename: undefined,
			}),
		).resolves.toEqual({ status: "delivered" });
	});
	it.each([null, [], {}, "private data"])(
		"rejects malformed journal success (%j)",
		async (body) => {
			await outcome(
				new WhatsAppClient(
					config,
					provider(metadata(), undefined, () => json(body)),
				).getMessage(messageRequest),
				"failed",
			);
		},
	);
	it.each([400, 429, 466, 500])(
		"does not mistake arbitrary HTTP %s failures for journal lag",
		async (status) => {
			await outcome(
				new WhatsAppClient(
					config,
					provider(metadata(), undefined, () => json({ error: TOKEN }, status)),
				).getMessage(messageRequest),
				"failed",
			);
		},
	);
	it.each([
		{ groupId: "invalid" },
		{ messageId: "short" },
		{ senderId: "bad" },
		{ filename: "" },
		{ filename: "bad\nname.pdf" },
	])(
		"rejects invalid read identifiers before requests (%j)",
		async (override) => {
			const fetchMock = provider();
			await outcome(
				new WhatsAppClient(config, fetchMock).getMessage({
					...messageRequest,
					...override,
				}),
				"failed",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});

describe("bounded provider I/O", () => {
	it.each(["verify", "send"] as const)(
		"starts no %s metadata request after caller shutdown",
		async (operation) => {
			const shutdown = new AbortController();
			shutdown.abort();
			const fetchMock = provider();
			const client = new WhatsAppClient(config, fetchMock);
			await outcome(
				operation === "verify"
					? client.verifyTarget({ ...target, signal: shutdown.signal })
					: client.sendDocument({
							...documentRequest,
							signal: shutdown.signal,
						}),
				"failed",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it("aborts send verification before any group lookup or upload when its caller stops", async () => {
		const shutdown = new AbortController();
		const fetchMock = vi.fn<typeof fetch>(
			() => new Promise<Response>(() => {}),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				signal: shutdown.signal,
			}),
			"failed",
		);
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(3);
		shutdown.abort();
		await checked;
		expect(
			fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
		).toBe(true);
	});
	it("cannot upload after a claim callback completes following caller shutdown", async () => {
		const shutdown = new AbortController();
		const gate = deferred<void>();
		const beforeSend = vi.fn(() => gate.promise);
		const fetchMock = provider();
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend,
				signal: shutdown.signal,
			}),
			"failed",
		);
		await flush();
		expect(beforeSend).toHaveBeenCalledOnce();
		shutdown.abort();
		await checked;
		gate.resolve();
		await flush();
		expect(
			fetchMock.mock.calls.some(([url]) => method(url) === "sendFileByUpload"),
		).toBe(false);
	});
	it("keeps a caller-aborted in-flight upload uncertain without retrying", async () => {
		const shutdown = new AbortController();
		const fetchMock = provider(
			metadata(),
			() => new Promise<Response>(() => {}),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				signal: shutdown.signal,
			}),
			"uncertain",
		);
		await flush();
		expect(
			fetchMock.mock.calls.filter(
				([url]) => method(url) === "sendFileByUpload",
			),
		).toHaveLength(1);
		shutdown.abort();
		await checked;
		expect(
			fetchMock.mock.calls.filter(
				([url]) => method(url) === "sendFileByUpload",
			),
		).toHaveLength(1);
	});
	it("uses one total metadata deadline and cancels a hung peer", async () => {
		vi.useFakeTimers();
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>(async (url) =>
			method(url) === "getSettings"
				? new Promise<Response>(() => {})
				: json(values[method(url)]),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await checked;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(
			fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
		).toBe(true);
	});
	it("shares the metadata deadline with the backend lease gate", async () => {
		vi.useFakeTimers();
		const fetchMock = provider();
		const gate = vi.fn(() => new Promise<void>(() => {}));
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget({
				...target,
				beforeGroupData: gate,
			}),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await checked;
		expect(gate).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
	it("releases a metadata lease acquired after the deadline without making a group request", async () => {
		vi.useFakeTimers();
		let finish: ((release: () => Promise<void>) => void) | undefined;
		const release = vi.fn(async () => {});
		const fetchMock = provider();
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget({
				...target,
				beforeGroupData: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			}),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await checked;
		finish?.(release);
		await flush();
		expect(release).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
	it("cancels a pending metadata body when a sibling lookup fails", async () => {
		const cancelled = vi.fn();
		const fetchMock = vi.fn<typeof fetch>(async (url) =>
			method(url) === "getStateInstance"
				? new Response(new ReadableStream({ cancel: cancelled }))
				: json({ error: TOKEN }, 500),
		);
		await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		await flush();
		expect(cancelled).toHaveBeenCalledTimes(1);
	});
	it("bounds response bytes before decoding metadata", async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("x".repeat(1_048_577)),
		);
		await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
	});
	it("refuses an empty metadata response body without disclosing native errors", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => new Response(null));
		await outcome(
			new WhatsAppClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
	});
	it("treats an oversized upload acknowledgement as uncertain", async () => {
		await outcome(
			new WhatsAppClient(
				config,
				provider(metadata(), () => new Response("x".repeat(1_048_577))),
			).sendDocument(documentRequest),
			"uncertain",
		);
	});
	it("times out a single upload without retrying or falling back", async () => {
		vi.useFakeTimers();
		const fetchMock = provider(
			metadata(),
			() => new Promise<Response>(() => {}),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).sendDocument(documentRequest),
			"uncertain",
		);
		await flush();
		await vi.advanceTimersByTimeAsync(30_000);
		await checked;
		expect(
			fetchMock.mock.calls.filter(
				([url]) => method(url) === "sendFileByUpload",
			),
		).toHaveLength(1);
	});
	it("a claim callback completing after its deadline cannot start an upload", async () => {
		vi.useFakeTimers();
		let finish: (() => void) | undefined;
		const fetchMock = provider();
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend: () =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			}),
			"failed",
		);
		await flush();
		await vi.advanceTimersByTimeAsync(30_000);
		await checked;
		finish?.();
		await flush();
		expect(
			fetchMock.mock.calls.some(([url]) => method(url) === "sendFileByUpload"),
		).toBe(false);
	});
	it("bounds journal lookup without changing an accepted send", async () => {
		vi.useFakeTimers();
		const fetchMock = provider(
			metadata(),
			undefined,
			() => new Promise<Response>(() => {}),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).getMessage(messageRequest),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await checked;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("does not start a journal request after the caller budget expires", async () => {
		const controller = new AbortController();
		controller.abort(new Error("private caller detail"));
		const fetchMock = provider();
		await outcome(
			new WhatsAppClient(config, fetchMock).getMessage({
				...messageRequest,
				signal: controller.signal,
			}),
			"failed",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("cancels an in-flight journal lookup with the shared caller budget", async () => {
		const controller = new AbortController();
		const fetchMock = provider(
			metadata(),
			undefined,
			() => new Promise<Response>(() => {}),
		);
		const checked = outcome(
			new WhatsAppClient(config, fetchMock).getMessage({
				...messageRequest,
				signal: controller.signal,
			}),
			"failed",
		);
		await flush();
		controller.abort(new Error("private caller detail"));
		await checked;
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});
	it("detaches the caller abort listener after a completed journal lookup", async () => {
		const controller = new AbortController();
		const removed = vi.spyOn(controller.signal, "removeEventListener");
		await expect(
			new WhatsAppClient(config, provider()).getMessage({
				...messageRequest,
				signal: controller.signal,
			}),
		).resolves.toEqual({ status: "delivered" });
		expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
	});
});
