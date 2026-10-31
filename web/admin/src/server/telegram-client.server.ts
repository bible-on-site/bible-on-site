import "@tanstack/react-start/server-only";

export interface TelegramClientConfig {
	token: string;
	expectedBotUsername: string;
}
export interface VerifiedTelegramTarget {
	botId: number;
	chatId: number;
	title: string;
	username: string | null;
}
type Audience = "test" | "real";
type ChatType = "channel" | "group" | "supergroup";
type Outcome = "failed" | "uncertain";
type RecordValue = Record<string, unknown>;
interface TargetRequest {
	chatId: number;
	audience: Audience;
	botId?: number;
}
interface DocumentRequest extends TargetRequest {
	botId: number;
	pdf: Uint8Array;
	filename: string;
	caption: string;
	beforeSend?: () => Promise<void>;
}

export class TelegramError extends Error {
	constructor(public readonly outcome: Outcome) {
		super(
			outcome === "uncertain"
				? "תוצאת השליחה בטלגרם דורשת בדיקה"
				: "לא ניתן להשלים את הבקשה לטלגרם",
		);
		this.name = "TelegramError";
	}
}
export class TelegramSuppressedError extends TelegramError {
	constructor() {
		super("failed");
		this.name = "TelegramSuppressedError";
	}
}

function reject(outcome: Outcome = "failed"): never {
	throw new TelegramError(outcome);
}
function record(value: unknown): RecordValue | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: null;
}
function positiveId(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function targetValid(value: TargetRequest): boolean {
	return (
		!!value &&
		Number.isSafeInteger(value.chatId) &&
		value.chatId !== 0 &&
		(value.audience === "test" || value.audience === "real") &&
		(value.botId === undefined || positiveId(value.botId))
	);
}
function hasControl(value: string, allowNewline = false): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (
			(code <= 31 && !(allowNewline && code === 10)) ||
			(code >= 127 && code <= 159)
		)
			return true;
	}
	return false;
}
function username(value: unknown): value is string {
	return (
		typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)
	);
}

function documentNameMatches(actual: unknown, expected: string): boolean {
	if (actual === undefined || actual === expected) return true;
	if (
		typeof actual !== "string" ||
		actual.length > 255 ||
		hasControl(actual) ||
		/[\\/"]/.test(actual) ||
		!actual.endsWith(".pdf")
	)
		return false;
	// Telegram may replace punctuation/spaces and truncate long Unicode names.
	// Keep chapter identity and a substantial prefix, rather than accepting an
	// unrelated document just because the provider returned a successful status.
	const fold = (name: string) =>
		name
			.slice(0, -4)
			.normalize("NFC")
			.replace(/[^\p{L}\p{N}]/gu, "")
			.toLowerCase();
	const wanted = fold(expected),
		received = fold(actual);
	return (
		received === wanted ||
		(expected.length > 60 &&
			received.length >= 32 &&
			wanted.startsWith(received))
	);
}
function allowedChatType(
	value: unknown,
	audience: Audience,
): value is ChatType {
	return (
		value === "channel" ||
		(audience === "test" && (value === "group" || value === "supergroup"))
	);
}
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		void pending.catch(() => {});
		return Promise.reject(new TelegramError("failed"));
	}
	return new Promise((resolve, fail) => {
		const aborted = () => fail(new TelegramError("failed"));
		signal.addEventListener("abort", aborted, { once: true });
		pending.then(
			(value) => {
				signal.removeEventListener("abort", aborted);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", aborted);
				fail(error);
			},
		);
	});
}

/** All provider URLs/bodies/errors stay private; only fixed errors leave this module. */
export class TelegramClient {
	#token: string;
	#expectedBotUsername: string;
	#fetch: typeof fetch;

	constructor(config: TelegramClientConfig, fetchImpl: typeof fetch = fetch) {
		if (
			!config ||
			typeof config.token !== "string" ||
			typeof config.expectedBotUsername !== "string"
		)
			reject();
		const token = config.token.trim();
		const expected = config.expectedBotUsername.trim().replace(/^@/, "");
		const parts = token.split(":");
		if (
			parts.length !== 2 ||
			!/^[1-9][0-9]{4,19}$/.test(parts[0]) ||
			!/^[A-Za-z0-9_-]{20,200}$/.test(parts[1]) ||
			!username(expected)
		)
			reject();
		this.#token = token;
		this.#expectedBotUsername = expected.toLowerCase();
		this.#fetch = fetchImpl;
	}

	async #deadline<T>(
		operation: (signal: AbortSignal) => Promise<T>,
		outcome: Outcome,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15_000);
		try {
			return await waitFor(operation(controller.signal), controller.signal);
		} catch (error) {
			if (error instanceof TelegramError && !controller.signal.aborted)
				throw error;
			return reject(outcome);
		} finally {
			clearTimeout(timer);
			// A rejected parallel lookup must also cancel its pending siblings.
			controller.abort();
		}
	}

	async #json(response: Response, signal: AbortSignal): Promise<unknown> {
		if (!response.body) return reject();
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			for (;;) {
				const next = await waitFor(reader.read(), signal);
				if (next.done) break;
				length += next.value.length;
				if (length > 1_048_576) return reject();
				chunks.push(next.value);
			}
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			return JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} finally {
			void reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}

	async #request(
		method: string,
		data: RecordValue | FormData,
		signal: AbortSignal,
		mutation = false,
	): Promise<unknown> {
		if (signal.aborted) return reject(mutation ? "uncertain" : "failed");
		let response: Response;
		let envelope: RecordValue | null;
		try {
			const multipart = data instanceof FormData;
			response = await waitFor(
				this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
					method: "POST",
					redirect: "error",
					signal,
					...(multipart
						? { body: data }
						: {
								headers: { "content-type": "application/json" },
								body: JSON.stringify(data),
							}),
				}),
				signal,
			);
			envelope = record(await this.#json(response, signal));
		} catch {
			return reject(mutation ? "uncertain" : "failed");
		}
		if (response.ok && envelope?.ok === true && "result" in envelope)
			return envelope.result;
		if (
			!response.ok &&
			response.status >= 400 &&
			response.status < 500 &&
			response.status !== 408 &&
			envelope?.ok === false &&
			envelope.error_code === response.status &&
			typeof envelope.description === "string"
		)
			return reject();
		return reject(mutation ? "uncertain" : "failed");
	}

	async verifyTarget(input: TargetRequest): Promise<VerifiedTelegramTarget> {
		const { botId, chatId, title, username } = await this.#verifyTarget(input);
		return { botId, chatId, title, username };
	}

	async #verifyTarget(
		input: TargetRequest,
	): Promise<VerifiedTelegramTarget & { chatType: ChatType }> {
		if (!targetValid(input)) return reject();
		return this.#deadline(async (signal) => {
			const mePending = this.#request("getMe", {}, signal);
			const chatPending = this.#request(
				"getChat",
				{ chat_id: input.chatId },
				signal,
			);
			const membership = (botId: number) =>
				Promise.all([
					this.#request(
						"getChatMember",
						{ chat_id: input.chatId, user_id: botId },
						signal,
					),
					this.#request(
						"getChatMemberCount",
						{ chat_id: input.chatId },
						signal,
					),
				]);
			let meValue: unknown;
			let chatValue: unknown;
			let memberValue: unknown;
			let countValue: unknown;
			if (input.botId !== undefined) {
				[meValue, chatValue, [memberValue, countValue]] = await Promise.all([
					mePending,
					chatPending,
					membership(input.botId),
				]);
			} else {
				[meValue, chatValue] = await Promise.all([mePending, chatPending]);
				const me = record(meValue);
				if (!me || !positiveId(me.id)) return reject();
				[memberValue, countValue] = await membership(me.id);
			}
			const me = record(meValue);
			const chat = record(chatValue);
			const member = record(memberValue);
			const user = record(member?.user);
			if (
				!me ||
				!positiveId(me.id) ||
				me.is_bot !== true ||
				!username(me.username) ||
				me.username.toLowerCase() !== this.#expectedBotUsername ||
				(input.botId !== undefined && me.id !== input.botId) ||
				!chat ||
				chat.id !== input.chatId ||
				!allowedChatType(chat.type, input.audience) ||
				typeof chat.title !== "string" ||
				!chat.title.trim() ||
				chat.title.length > 255 ||
				hasControl(chat.title) ||
				!member ||
				user?.id !== me.id ||
				user.is_bot !== true ||
				!(
					member.status === "creator" ||
					(member.status === "administrator" &&
						(chat.type !== "channel" || member.can_post_messages === true))
				) ||
				!positiveId(countValue)
			)
				return reject();
			if (
				chat.active_usernames !== undefined &&
				(!Array.isArray(chat.active_usernames) ||
					!chat.active_usernames.every(username))
			)
				return reject();
			if (input.audience === "test") {
				if (
					chat.username !== undefined ||
					(chat.active_usernames as unknown[] | undefined)?.length ||
					countValue > 2
				)
					return reject();
			} else if (
				!username(chat.username) ||
				chat.username.toLowerCase() !== "alhaperek"
			)
				return reject();
			return {
				botId: me.id,
				chatType: chat.type,
				chatId: input.chatId,
				title: chat.title,
				username: input.audience === "real" ? (chat.username as string) : null,
			};
		}, "failed");
	}

	async sendDocument(
		input: DocumentRequest,
	): Promise<{ messageId: number; fileId: string }> {
		if (
			!targetValid(input) ||
			!positiveId(input.botId) ||
			!ArrayBuffer.isView(input.pdf) ||
			Object.prototype.toString.call(input.pdf) !== "[object Uint8Array]" ||
			input.pdf.length < 5 ||
			input.pdf.length > 50_000_000 ||
			input.pdf[0] !== 37 ||
			input.pdf[1] !== 80 ||
			input.pdf[2] !== 68 ||
			input.pdf[3] !== 70 ||
			input.pdf[4] !== 45 ||
			typeof input.filename !== "string" ||
			!input.filename ||
			input.filename !== input.filename.trim() ||
			input.filename.length > 255 ||
			hasControl(input.filename) ||
			/[\\/"]/.test(input.filename) ||
			!input.filename.toLowerCase().endsWith(".pdf") ||
			typeof input.caption !== "string" ||
			!input.caption.trim() ||
			input.caption.length > 1024 ||
			hasControl(input.caption, true) ||
			(input.beforeSend !== undefined && typeof input.beforeSend !== "function")
		)
			return reject();
		const pdf = new Uint8Array(input.pdf);
		const target = {
			botId: input.botId,
			chatId: input.chatId,
			audience: input.audience,
		};
		const filename = input.filename;
		const document = new FormData();
		document.append("chat_id", String(target.chatId));
		document.append("caption", input.caption);
		document.append(
			"document",
			new Blob([pdf], { type: "application/pdf" }),
			filename,
		);
		const verified = await this.#verifyTarget(target);
		try {
			await input.beforeSend?.();
		} catch (error) {
			if (error instanceof TelegramSuppressedError) throw error;
			return reject();
		}
		return this.#deadline(async (signal) => {
			const message = record(
				await this.#request("sendDocument", document, signal, true),
			);
			const chat = record(message?.chat);
			const file = record(message?.document);
			if (
				!message ||
				!positiveId(message.message_id) ||
				chat?.id !== target.chatId ||
				chat.type !== verified.chatType ||
				!file ||
				typeof file.file_id !== "string" ||
				!/^[A-Za-z0-9_-]{1,255}$/.test(file.file_id) ||
				!documentNameMatches(file.file_name, filename) ||
				(file.file_name !== undefined &&
					file.file_name !== filename &&
					(file.file_size !== pdf.length ||
						file.mime_type !== "application/pdf")) ||
				(file.file_size !== undefined && file.file_size !== pdf.length) ||
				(file.mime_type !== undefined && file.mime_type !== "application/pdf")
			)
				return reject("uncertain");
			return { messageId: message.message_id, fileId: file.file_id };
		}, "uncertain");
	}
}
