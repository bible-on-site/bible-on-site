import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import {
	TelegramClient,
	TelegramError,
	TelegramSuppressedError,
} from "~/server/telegram-client.server";

const TOKEN = "123456789:unit_test_token_not_a_real_secret";
const BOT = 123456789;
const CHAT = -1001234567890;
const PDF = new TextEncoder().encode("%PDF-1.7\nexact fixture bytes\n%%EOF");
const config = { token: TOKEN, expectedBotUsername: "ExampleTestBot" };
const target = { chatId: CHAT, audience: "test" as const, botId: BOT };
const documentRequest = {
	...target,
	pdf: PDF,
	filename: "chapter.pdf",
	caption: 'הושע ב\nלימוד יומי בתנ"ך על הפרק\nhttps://xn--febl3a.co.il/929/502',
};
type Responses = Record<string, unknown>;

function metadata(): Responses {
	return {
		getMe: { id: BOT, is_bot: true, username: "ExampleTestBot" },
		getChat: { id: CHAT, type: "channel", title: "Private fixture" },
		getChatMember: {
			status: "administrator",
			can_post_messages: true,
			user: { id: BOT, is_bot: true },
		},
		getChatMemberCount: 2,
	};
}
function message() {
	return {
		message_id: 42,
		chat: { id: CHAT, type: "channel" },
		document: {
			file_id: "fixture_file_id",
			file_name: "chapter.pdf",
			file_size: PDF.length,
			mime_type: "application/pdf",
		},
	};
}
function json(result: unknown, status = 200) {
	return new Response(JSON.stringify({ ok: true, result }), {
		status,
		headers: { "content-type": "application/json" },
	});
}
function refusal(status: number) {
	return new Response(
		JSON.stringify({
			ok: false,
			error_code: status,
			description: `Private provider details ${TOKEN}`,
			parameters: { retry_after: 1 },
		}),
		{ status },
	);
}
function method(input: RequestInfo | URL): string {
	return new URL(String(input)).pathname.split("/").at(-1) ?? "";
}
function provider(
	values = metadata(),
	send: () => Promise<Response> | Response = () => json(message()),
) {
	return vi.fn<typeof fetch>(async (input) =>
		method(input) === "sendDocument" ? send() : json(values[method(input)]),
	);
}
async function outcome(
	pending: Promise<unknown>,
	expected: "failed" | "uncertain",
) {
	try {
		await pending;
		throw new Error("Expected a fixed provider error");
	} catch (error) {
		expect(error).toBeInstanceOf(TelegramError);
		const failure = error as TelegramError;
		expect(failure.outcome).toBe(expected);
		expect(
			`${failure}\n${failure.stack}\n${JSON.stringify(failure)}`,
		).not.toContain(TOKEN);
		expect(failure.cause).toBeUndefined();
		return failure;
	}
}
async function blobBytes(blob: Blob) {
	return new Promise<Uint8Array>((resolve, fail) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = fail;
		reader.readAsArrayBuffer(blob);
	});
}
async function flush() {
	for (let i = 0; i < 40; i++) await Promise.resolve();
}

beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("Real network forbidden in provider unit tests"),
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

describe("Telegram configuration and target verification", () => {
	it.each([
		{ token: "", expectedBotUsername: "ExampleTestBot" },
		{ token: "123:short", expectedBotUsername: "ExampleTestBot" },
		{ token: `${TOKEN}/sendDocument`, expectedBotUsername: "ExampleTestBot" },
		{ token: `${TOKEN}?token=other`, expectedBotUsername: "ExampleTestBot" },
		{ token: TOKEN, expectedBotUsername: "bad name" },
		{ token: TOKEN, expectedBotUsername: "" },
	])("rejects invalid configuration without a request (%j)", (bad) => {
		const fetchMock = provider();
		expect(() => new TelegramClient(bad, fetchMock)).toThrow(TelegramError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("verifies a private channel and shares one signal across all metadata requests", async () => {
		const fetchMock = provider();
		const client = new TelegramClient(
			{ token: ` ${TOKEN} `, expectedBotUsername: "@exampletestbot" },
			fetchMock,
		);
		await expect(client.verifyTarget(target)).resolves.toEqual({
			botId: BOT,
			chatId: CHAT,
			title: "Private fixture",
			username: null,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const signals = new Set(
			fetchMock.mock.calls.map(([, init]) => init?.signal),
		);
		expect(signals.size).toBe(1);
		for (const [url, init] of fetchMock.mock.calls) {
			expect(new URL(String(url)).origin).toBe("https://api.telegram.org");
			expect(new URL(String(url)).search).toBe("");
			expect(init?.redirect).toBe("error");
			expect(init?.method).toBe("POST");
			expect(init?.body).not.toContain(TOKEN);
		}
	});
	it("discovers the current bot ID before a non-frozen readiness membership check", async () => {
		const fetchMock = provider();
		await new TelegramClient(config, fetchMock).verifyTarget({
			chatId: CHAT,
			audience: "test",
		});
		const call = fetchMock.mock.calls.find(
			([url]) => method(url) === "getChatMember",
		);
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({
			chat_id: CHAT,
			user_id: BOT,
		});
	});
	it("launches all four frozen-identity checks before awaiting getMe", async () => {
		let release: (value: Response) => void = () => {};
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>((url) =>
			method(url) === "getMe"
				? new Promise((resolve) => {
						release = resolve;
					})
				: Promise.resolve(json(values[method(url)])),
		);
		const pending = new TelegramClient(config, fetchMock).verifyTarget(target);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		release(json(values.getMe));
		await pending;
	});
	it("accepts a creator's inherent posting rights and an explicit empty alias list", async () => {
		const values = metadata();
		values.getChat = { ...(values.getChat as object), active_usernames: [] };
		values.getChatMember = {
			status: "creator",
			user: { id: BOT, is_bot: true },
		};
		await expect(
			new TelegramClient(config, provider(values)).verifyTarget(target),
		).resolves.toMatchObject({ botId: BOT });
	});
	it("requires the approved public username for real targets without changing the target ID", async () => {
		const values = metadata();
		values.getChat = {
			id: CHAT,
			type: "channel",
			title: "Public fixture",
			username: "alhaperek",
			active_usernames: ["alhaperek"],
		};
		values.getChatMemberCount = 1000;
		await expect(
			new TelegramClient(config, provider(values)).verifyTarget({
				...target,
				audience: "real",
			}),
		).resolves.toMatchObject({ chatId: CHAT, username: "alhaperek" });
	});
	it.each(["group", "supergroup"])(
		"posts once to an owner-only private %s without channel-specific permissions",
		async (type) => {
			const values = metadata();
			values.getChat = { id: CHAT, type, title: "Private fixture" };
			values.getChatMember = {
				status: "administrator",
				user: { id: BOT, is_bot: true },
			};
			const fetchMock = provider(values, () =>
				json({ ...message(), chat: { id: CHAT, type } }),
			);
			await expect(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
			).resolves.toEqual({ messageId: 42, fileId: "fixture_file_id" });
			expect(
				fetchMock.mock.calls.filter(([url]) => method(url) === "sendDocument"),
			).toHaveLength(1);
		},
	);
	it.each(["group", "supergroup"])(
		"refuses a public or expanded test %s and any real group target",
		async (type) => {
			for (const unsafe of ["public", "extra-member", "not-admin", "real"]) {
				const values = metadata();
				values.getChat = {
					id: CHAT,
					type,
					title: "Private fixture",
					...(unsafe === "public" || unsafe === "real"
						? { username: "alhaperek" }
						: {}),
				};
				if (unsafe === "extra-member") values.getChatMemberCount = 3;
				if (unsafe === "not-admin")
					values.getChatMember = {
						status: "member",
						user: { id: BOT, is_bot: true },
					};
				const fetchMock = provider(values);
				await outcome(
					new TelegramClient(config, fetchMock).sendDocument({
						...documentRequest,
						audience: unsafe === "real" ? "real" : "test",
					}),
					"failed",
				);
				expect(
					fetchMock.mock.calls.some(([url]) => method(url) === "sendDocument"),
				).toBe(false);
			}
		},
	);
	it.each(["group", "supergroup"])(
		"keeps verified %s type private without changing the public target DTO",
		async (type) => {
			const values = metadata();
			values.getChat = { id: CHAT, type, title: "Private fixture" };
			values.getChatMember = {
				status: "administrator",
				user: { id: BOT, is_bot: true },
			};
			await expect(
				new TelegramClient(config, provider(values)).verifyTarget(target),
			).resolves.toEqual({
				botId: BOT,
				chatId: CHAT,
				title: "Private fixture",
				username: null,
			});
		},
	);
	it.each([
		["channel", "group"],
		["channel", "supergroup"],
		["group", "channel"],
		["group", "supergroup"],
		["supergroup", "channel"],
		["supergroup", "group"],
	])(
		"keeps a verified %s upload uncertain when its acknowledgement changes to %s",
		async (verifiedType, returnedType) => {
			const values = metadata();
			values.getChat = {
				id: CHAT,
				type: verifiedType,
				title: "Private fixture",
			};
			const fetchMock = provider(values, () =>
				json({ ...message(), chat: { id: CHAT, type: returnedType } }),
			);
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(
				fetchMock.mock.calls.filter(([url]) => method(url) === "sendDocument"),
			).toHaveLength(1);
		},
	);
	it("refuses the former public username after the owner selected another channel", async () => {
		const values = metadata();
		values.getChat = {
			id: CHAT,
			type: "channel",
			title: "Old fixture",
			username: "BibleOnSite",
		};
		await outcome(
			new TelegramClient(config, provider(values)).verifyTarget({
				...target,
				audience: "real",
			}),
			"failed",
		);
	});
	it.each([
		["getMe", { id: BOT, is_bot: false, username: "ExampleTestBot" }],
		["getMe", { id: BOT + 1, is_bot: true, username: "ExampleTestBot" }],
		["getMe", { id: BOT, is_bot: true, username: "OtherExampleBot" }],
		["getMe", { id: 0, is_bot: true, username: "ExampleTestBot" }],
		["getChat", { id: CHAT - 1, type: "channel", title: "Wrong target" }],
		["getChat", { id: CHAT, type: "unknown", title: "Wrong type" }],
		["getChat", { id: CHAT, type: "private", title: "Wrong type" }],
		[
			"getChat",
			{
				id: CHAT,
				type: "channel",
				title: "Public",
				username: "ExampleChannel",
			},
		],
		[
			"getChat",
			{
				id: CHAT,
				type: "channel",
				title: "Public alias",
				active_usernames: ["ExampleChannel"],
			},
		],
		[
			"getChat",
			{
				id: CHAT,
				type: "channel",
				title: "Malformed",
				active_usernames: "ExampleChannel",
			},
		],
		["getChat", { id: CHAT, type: "channel", title: "Bad\u007fTitle" }],
		["getChat", { id: CHAT, type: "channel", title: "" }],
		["getChatMember", { status: "member", user: { id: BOT, is_bot: true } }],
		[
			"getChatMember",
			{
				status: "administrator",
				can_post_messages: false,
				user: { id: BOT, is_bot: true },
			},
		],
		[
			"getChatMember",
			{
				status: "administrator",
				can_post_messages: true,
				user: { id: BOT + 1, is_bot: true },
			},
		],
		["getChatMemberCount", 3],
		["getChatMemberCount", 0],
		["getChatMemberCount", "2"],
		["getChatMemberCount", 1.5],
	] as [string, unknown][])(
		"rejects unsafe or malformed %s metadata without posting",
		async (name, value) => {
			const values = { ...metadata(), [name]: value };
			const fetchMock = provider(values);
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
				"failed",
			);
			expect(
				fetchMock.mock.calls.filter(([url]) => method(url) === "sendDocument"),
			).toHaveLength(0);
		},
	);
	it("refuses a differently named real channel even when the numeric ID matches", async () => {
		const values = metadata();
		values.getChat = {
			id: CHAT,
			type: "channel",
			title: "Other channel",
			username: "OtherChannel",
		};
		await outcome(
			new TelegramClient(config, provider(values)).verifyTarget({
				...target,
				audience: "real",
			}),
			"failed",
		);
	});
	it.each([0, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])(
		"rejects an invalid target ID %s before network",
		async (chatId) => {
			const fetchMock = provider();
			await outcome(
				new TelegramClient(config, fetchMock).verifyTarget({
					...target,
					chatId,
				}),
				"failed",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it("sanitizes read-only network failures and malformed/oversized response bodies", async () => {
		for (const answer of [
			() => {
				throw new Error(`https://api.telegram.org/bot${TOKEN}/getMe`);
			},
			() => new Response("not JSON"),
			() => new Response("x".repeat(1_048_577)),
			() => new Response(null, { status: 204 }),
		]) {
			const fetchMock = vi.fn<typeof fetch>(async () => answer());
			await outcome(
				new TelegramClient(config, fetchMock).verifyTarget(target),
				"failed",
			);
		}
	});
	it("has one overall 15-second metadata deadline, not one per lookup", async () => {
		vi.useFakeTimers();
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>(
			(url) =>
				new Promise((resolve) =>
					setTimeout(() => resolve(json(values[method(url)])), 10_000),
				),
		);
		const pending = outcome(
			new TelegramClient(config, fetchMock).verifyTarget({
				chatId: CHAT,
				audience: "test",
			}),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(5000);
		await pending;
		expect(
			fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
		).toBe(true);
	});
	it("aborts a stalled sibling fetch when another metadata lookup fails early", async () => {
		vi.useFakeTimers();
		const aborted = vi.fn();
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>((url, init) => {
			if (method(url) === "getMe")
				return Promise.reject(new Error(`private provider URL ${TOKEN}`));
			if (method(url) === "getChat")
				return new Promise((_resolve, fail) => {
					init?.signal?.addEventListener("abort", () => {
						aborted();
						fail(new Error(`cancelled private request ${TOKEN}`));
					});
				});
			return Promise.resolve(json(values[method(url)]));
		});
		await outcome(
			new TelegramClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		expect(aborted).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(
			fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
		).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("cancels and releases an unfinished response body after a peer fails", async () => {
		vi.useFakeTimers();
		let failLookup: (error: Error) => void = () => {};
		const bodyStarted = vi.fn();
		const bodyCancelled = vi.fn();
		const stalledBody = new ReadableStream<Uint8Array>({
			pull() {
				bodyStarted();
				return new Promise(() => {});
			},
			cancel: bodyCancelled,
		});
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>((url) => {
			if (method(url) === "getMe")
				return new Promise((_resolve, fail) => {
					failLookup = fail;
				});
			if (method(url) === "getChat")
				return Promise.resolve(new Response(stalledBody));
			return Promise.resolve(json(values[method(url)]));
		});
		const pending = outcome(
			new TelegramClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		await flush();
		expect(bodyStarted).toHaveBeenCalled();
		failLookup(new Error(`private lookup failure ${TOKEN}`));
		await pending;
		await flush();
		expect(bodyCancelled).toHaveBeenCalledOnce();
		expect(stalledBody.locked).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("enforces the deadline even if the injected transport ignores abort", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn<typeof fetch>(() => new Promise(() => {}));
		const pending = outcome(
			new TelegramClient(config, fetchMock).verifyTarget(target),
			"failed",
		);
		await vi.advanceTimersByTimeAsync(15_000);
		await pending;
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("one frozen PDF upload", () => {
	it("uploads exact saved bytes with plain caption and only the frozen target fields", async () => {
		const fetchMock = provider();
		const beforeSend = vi.fn(async () => {
			expect(fetchMock).toHaveBeenCalledTimes(4);
		});
		await expect(
			new TelegramClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend,
			}),
		).resolves.toEqual({ messageId: 42, fileId: "fixture_file_id" });
		expect(beforeSend).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(5);
		const [, init] = fetchMock.mock.calls[4];
		const body = init?.body as FormData;
		expect(body).toBeInstanceOf(FormData);
		expect([...body.keys()].sort()).toEqual(["caption", "chat_id", "document"]);
		expect(body.get("chat_id")).toBe(String(CHAT));
		expect(body.get("caption")).toBe(documentRequest.caption);
		const file = body.get("document") as File;
		expect(file.name).toBe("chapter.pdf");
		expect(file.type).toBe("application/pdf");
		expect(Array.from(await blobBytes(file))).toEqual(Array.from(PDF));
		expect(init?.headers).toBeUndefined();
		expect(init?.redirect).toBe("error");
	});
	it("copies bytes and target metadata before awaiting the last preflight", async () => {
		const original = new Uint8Array(PDF);
		const input = {
			...documentRequest,
			pdf: original,
			beforeSend: async () => {
				original.fill(0);
				input.chatId = CHAT - 1;
				input.filename = "changed.pdf";
			},
		};
		const fetchMock = provider();
		await new TelegramClient(config, fetchMock).sendDocument(input);
		const body = fetchMock.mock.calls[4][1]?.body as FormData;
		expect(body.get("chat_id")).toBe(String(CHAT));
		expect((body.get("document") as File).name).toBe("chapter.pdf");
		expect(Array.from(await blobBytes(body.get("document") as File))).toEqual(
			Array.from(PDF),
		);
	});
	it("preserves suppression and never starts an upload after preflight rejects", async () => {
		const fetchMock = provider();
		const suppressed = new TelegramSuppressedError();
		await expect(
			new TelegramClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend: async () => {
					throw suppressed;
				},
			}),
		).rejects.toBe(suppressed);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
	it("classifies a preflight DB failure as failed and discards its raw error", async () => {
		const fetchMock = provider();
		await outcome(
			new TelegramClient(config, fetchMock).sendDocument({
				...documentRequest,
				beforeSend: async () => {
					throw new Error(`private database details ${TOKEN}`);
				},
			}),
			"failed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
	it.each([
		{ pdf: new Uint8Array() },
		{ pdf: new TextEncoder().encode("not a pdf") },
		{ pdf: new Uint8Array(50_000_001) },
		{ filename: "../chapter.pdf" },
		{ filename: "chapter\\file.pdf" },
		{ filename: 'bad"name.pdf' },
		{ filename: "bad\r\nname.pdf" },
		{ filename: "file.txt" },
		{ filename: " file.pdf" },
		{ filename: "x".repeat(256) },
		{ caption: "" },
		{ caption: "x".repeat(1025) },
		{ caption: "bad\u0080caption" },
		{ botId: 0 },
		{ audience: "unknown" },
	])(
		"refuses invalid frozen upload input before any request (%#)",
		async (change) => {
			const fetchMock = provider();
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument({
					...documentRequest,
					...change,
				} as typeof documentRequest),
				"failed",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it.each([400, 401, 403, 404, 409, 413, 429])(
		"treats an explicit HTTP%s refusal as failed without retry",
		async (status) => {
			const fetchMock = provider(metadata(), () => refusal(status));
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
				"failed",
			);
			expect(
				fetchMock.mock.calls.filter(([url]) => method(url) === "sendDocument"),
			).toHaveLength(1);
		},
	);
	it.each([408, 500, 502, 503])(
		"keeps HTTP%s mutation outcomes uncertain without retry",
		async (status) => {
			const fetchMock = provider(metadata(), () => refusal(status));
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(
				fetchMock.mock.calls.filter(([url]) => method(url) === "sendDocument"),
			).toHaveLength(1);
		},
	);
	it("sanitizes a send network/redirect failure as uncertain", async () => {
		const fetchMock = provider(metadata(), () => {
			throw new TypeError(
				`redirect https://api.telegram.org/bot${TOKEN}/sendDocument`,
			);
		});
		await outcome(
			new TelegramClient(config, fetchMock).sendDocument(documentRequest),
			"uncertain",
		);
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});
	it.each([
		() => new Response("not JSON"),
		() => new Response(null, { status: 204 }),
		() =>
			new Response(
				JSON.stringify({ ok: false, error_code: 429, description: TOKEN }),
			),
		() =>
			new Response(
				JSON.stringify({ ok: false, error_code: 400, description: TOKEN }),
				{ status: 403 },
			),
		() => json(null),
		() => json({ ...message(), message_id: 0 }),
		() => json({ ...message(), chat: { id: CHAT - 1, type: "channel" } }),
		() => json({ ...message(), chat: { id: CHAT, type: "private" } }),
		() => json({ ...message(), document: null }),
		() => json({ ...message(), document: { file_id: "" } }),
		() => json({ ...message(), document: { file_id: "x".repeat(256) } }),
		() => json({ ...message(), document: { file_id: "file id" } }),
		() =>
			json({
				...message(),
				document: { file_id: "fixture", file_name: "different.pdf" },
			}),
		() =>
			json({
				...message(),
				document: { file_id: "fixture", file_size: PDF.length + 1 },
			}),
		() =>
			json({
				...message(),
				document: { file_id: "fixture", mime_type: "text/html" },
			}),
	])(
		"does not treat malformed or mismatched send responses as confirmed delivery (%#)",
		async (send) => {
			const fetchMock = provider(metadata(), send);
			await outcome(
				new TelegramClient(config, fetchMock).sendDocument(documentRequest),
				"uncertain",
			);
			expect(fetchMock).toHaveBeenCalledTimes(5);
		},
	);
	it("bounds the single upload to 15 seconds even if fetch ignores abort", async () => {
		vi.useFakeTimers();
		const fetchMock = provider(metadata(), () => new Promise(() => {}));
		const pending = outcome(
			new TelegramClient(config, fetchMock).sendDocument(documentRequest),
			"uncertain",
		);
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(5);
		await vi.advanceTimersByTimeAsync(15_000);
		await pending;
		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("gives send its own deadline after the shared metadata phase", async () => {
		vi.useFakeTimers();
		const values = metadata();
		const fetchMock = vi.fn<typeof fetch>(
			(url) =>
				new Promise((resolve) =>
					setTimeout(
						() =>
							resolve(
								json(
									method(url) === "sendDocument"
										? message()
										: values[method(url)],
								),
							),
						14_000,
					),
				),
		);
		const pending = new TelegramClient(config, fetchMock).sendDocument(
			documentRequest,
		);
		await vi.advanceTimersByTimeAsync(14_000);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		await vi.advanceTimersByTimeAsync(14_000);
		await expect(pending).resolves.toEqual({
			messageId: 42,
			fileId: "fixture_file_id",
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});
