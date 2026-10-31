import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";

export type WhatsAppAudience = "test" | "real";
export type WhatsAppConnectionState =
	| "authorized"
	| "notAuthorized"
	| "blocked"
	| "sleepMode"
	| "starting"
	| "suspended"
	| "unknown";
type Outcome = "failed" | "uncertain";
type RecordValue = Record<string, unknown>;
export type BeforeGroupData = (
	signal: AbortSignal,
) => Promise<(() => Promise<void>) | void>;

export interface WhatsAppClientConfig {
	instanceId: string;
	apiToken: string;
	apiUrl: string;
	mediaUrl: string;
	expectedSenderPhone: string;
}
export interface VerifiedWhatsAppTarget {
	groupId: string;
	title: string;
	size: number;
	senderId: string;
	senderPhone: string;
	participantDigest: string;
	outgoingStatusesEnabled: true;
}
interface TargetRequest {
	groupId: string;
	audience: WhatsAppAudience;
	expectedParticipantDigest?: string;
	beforeGroupData?: BeforeGroupData;
	signal?: AbortSignal;
}
interface DocumentRequest {
	groupId: string;
	audience: WhatsAppAudience;
	senderId: string;
	senderPhone: string;
	participantDigest: string;
	pdfSha256: string;
	pdf: Uint8Array;
	filename: string;
	caption: string;
	beforeGroupData?: BeforeGroupData;
	beforeSend: () => Promise<void>;
	signal?: AbortSignal;
}
interface MessageRequest {
	groupId: string;
	messageId: string;
	senderId?: string;
	filename?: string;
	signal?: AbortSignal;
}
export type WhatsAppMessageStatus =
	| "pending"
	| "sent"
	| "delivered"
	| "read"
	| "failed"
	| "suspended"
	| "noAccount"
	| "notInGroup";

// Explicit vendor hosts; a configured host is never inferred from an instance ID.
const HOSTS = new Set([
	"api.greenapi.com",
	"media.greenapi.com",
	"api.green-api.com",
	"media.green-api.com",
]);
// Only these two documented regional prefixes are accepted.
const REGIONAL_HOST = /^(7107|7201)\.api\.green-?api\.com$/;
const GROUP = /^[1-9][0-9]{4,24}(?:-[1-9][0-9]{3,24})?@g\.us$/;
const IDENTITY = /^[1-9][0-9]{4,24}@(lid|c\.us)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_DOCUMENT_BYTES = 100_000_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MISSING_MESSAGE = Symbol("missing message");

export class WhatsAppError extends Error {
	constructor(
		public readonly outcome: Outcome,
		public readonly connectionState: WhatsAppConnectionState = "unknown",
	) {
		super(
			outcome === "uncertain"
				? "תוצאת השליחה בווטסאפ דורשת בדיקה"
				: "לא ניתן להשלים את הבקשה לווטסאפ",
		);
		this.name = "WhatsAppError";
	}
}
export class WhatsAppSuppressedError extends WhatsAppError {
	constructor() {
		super("failed");
		this.name = "WhatsAppSuppressedError";
	}
}
export class WhatsAppDeferredError extends WhatsAppError {
	constructor() {
		super("failed");
		this.name = "WhatsAppDeferredError";
	}
}

function reject(outcome: Outcome = "failed"): never {
	throw new WhatsAppError(outcome);
}
function record(value: unknown): RecordValue | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: null;
}
function text(value: unknown): value is string {
	return typeof value === "string";
}
function pdfBytes(value: unknown): value is Uint8Array {
	return (
		ArrayBuffer.isView(value) &&
		Object.prototype.toString.call(value) === "[object Uint8Array]"
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
function phone(value: unknown): string {
	if (!text(value) || !/^\+?[1-9][0-9]{5,14}$/.test(value.trim()))
		return reject();
	return value.trim().replace(/^\+/, "");
}
function host(value: unknown): string {
	if (!text(value)) return reject();
	const raw = value.trim();
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return reject();
	}
	if (
		url.protocol !== "https:" ||
		(!HOSTS.has(url.hostname) && !REGIONAL_HOST.test(url.hostname)) ||
		url.port ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		(raw !== url.origin && raw !== `${url.origin}/`)
	)
		return reject();
	return url.origin;
}
function connectionState(value: unknown): WhatsAppConnectionState {
	if (value === "yellowCard") return "suspended";
	return value === "authorized" ||
		value === "notAuthorized" ||
		value === "blocked" ||
		value === "sleepMode" ||
		value === "starting" ||
		value === "suspended"
		? value
		: "unknown";
}
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		void pending.catch(() => {});
		return Promise.reject(new WhatsAppError("failed"));
	}
	return new Promise((resolve, fail) => {
		const aborted = () => fail(new WhatsAppError("failed"));
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
function description(value: unknown): string | null {
	if (text(value)) return value;
	const item = record(value);
	return item && text(item.error)
		? item.error
		: item && text(item.message)
			? item.message
			: null;
}
function missingMessage(status: number, value: unknown): boolean {
	const message = description(value);
	return (
		status === 400 &&
		(message === "chatId not found" ||
			message?.startsWith("Message not found by id ") === true)
	);
}

/** Never expose credential-bearing URLs, provider payloads, or native errors. */
export class WhatsAppClient {
	#instanceId: string;
	#apiToken: string;
	#apiUrl: string;
	#mediaUrl: string;
	#senderPhone: string;
	#fetch: typeof fetch;

	constructor(config: WhatsAppClientConfig, fetchImpl: typeof fetch = fetch) {
		if (
			!config ||
			!text(config.instanceId) ||
			!text(config.apiToken) ||
			!/^[1-9][0-9]{3,19}$/.test(config.instanceId.trim()) || // nosemgrep -- bounded single-quantifier literal; linear-time match, no ReDoS surface
			!/^[A-Za-z0-9_-]{16,256}$/.test(config.apiToken.trim()) // nosemgrep -- bounded single-quantifier literal; linear-time match, no ReDoS surface
		)
			reject();
		this.#instanceId = config.instanceId.trim();
		this.#apiToken = config.apiToken.trim();
		this.#apiUrl = host(config.apiUrl);
		this.#mediaUrl = host(config.mediaUrl);
		this.#senderPhone = phone(config.expectedSenderPhone);
		this.#fetch = fetchImpl;
	}

	async #deadline<T>(
		operation: (signal: AbortSignal) => Promise<T>,
		milliseconds: number,
		outcome: Outcome | (() => Outcome) = "failed",
		parentSignal?: AbortSignal,
	): Promise<T> {
		const controller = new AbortController();
		const abort = () => controller.abort();
		parentSignal?.addEventListener("abort", abort, { once: true });
		if (parentSignal?.aborted) abort();
		const timer = setTimeout(() => controller.abort(), milliseconds);
		try {
			if (controller.signal.aborted)
				return reject(typeof outcome === "function" ? outcome() : outcome);
			return await waitFor(operation(controller.signal), controller.signal);
		} catch (error) {
			if (error instanceof WhatsAppError && !controller.signal.aborted)
				throw error;
			return reject(typeof outcome === "function" ? outcome() : outcome);
		} finally {
			clearTimeout(timer);
			parentSignal?.removeEventListener("abort", abort);
			controller.abort();
		}
	}

	async #body(response: Response, signal: AbortSignal): Promise<unknown> {
		if (!response.body) return reject();
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			for (;;) {
				const next = await waitFor(reader.read(), signal);
				if (next.done) break;
				length += next.value.length;
				if (length > MAX_RESPONSE_BYTES) return reject();
				chunks.push(next.value);
			}
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			try {
				return JSON.parse(body);
			} catch {
				return body;
			}
		} finally {
			void reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}

	async #request(
		method: string,
		data: RecordValue | FormData | null,
		signal: AbortSignal,
		mutation = false,
		allowMissingMessage = false,
	): Promise<unknown> {
		if (signal.aborted) return reject(mutation ? "uncertain" : "failed");
		let response: Response;
		let body: unknown;
		try {
			const multipart = data instanceof FormData;
			const origin = mutation ? this.#mediaUrl : this.#apiUrl;
			response = await waitFor(
				this.#fetch(
					`${origin}/waInstance${this.#instanceId}/${method}/${this.#apiToken}`,
					{
						method: data === null ? "GET" : "POST",
						redirect: "error",
						signal,
						...(data === null
							? {}
							: multipart
								? { body: data }
								: {
										headers: { "content-type": "application/json" },
										body: JSON.stringify(data),
									}),
					},
				),
				signal,
			);
			body = await this.#body(response, signal);
		} catch {
			return reject(mutation ? "uncertain" : "failed");
		}
		if (allowMissingMessage && missingMessage(response.status, body))
			return MISSING_MESSAGE;
		if (response.ok) return body;
		if (
			response.status >= 400 &&
			response.status < 500 &&
			response.status !== 408
		)
			return reject();
		return reject(mutation ? "uncertain" : "failed");
	}

	async verifyTarget(input: TargetRequest): Promise<VerifiedWhatsAppTarget> {
		if (
			!input ||
			!GROUP.test(input.groupId) ||
			(input.audience !== "test" && input.audience !== "real") ||
			(input.expectedParticipantDigest !== undefined &&
				!DIGEST.test(input.expectedParticipantDigest)) ||
			(input.audience === "test" &&
				!DIGEST.test(input.expectedParticipantDigest ?? ""))
		)
			return reject();
		return this.#deadline(
			async (signal) => {
				const [stateValue, accountValue, settingsValue] = await Promise.all([
					this.#request("getStateInstance", null, signal),
					this.#request("getWaSettings", null, signal),
					this.#request("getSettings", null, signal),
				]);
				const state = connectionState(record(stateValue)?.stateInstance);
				const account = record(accountValue);
				const settings = record(settingsValue);
				if (state !== "authorized") throw new WhatsAppError("failed", state);
				const accountState = connectionState(account?.stateInstance);
				if (accountState !== "authorized")
					throw new WhatsAppError("failed", accountState);
				if (
					!account ||
					!settings ||
					!text(account.chatId) ||
					!IDENTITY.test(account.chatId) ||
					phone(account.phone) !== this.#senderPhone ||
					account.logoutProcess === true ||
					settings.outgoingWebhook !== "yes"
				)
					throw new WhatsAppSuppressedError();
				const aliases = new Set([account.chatId, `${this.#senderPhone}@c.us`]);
				if (!text(settings.wid) || !aliases.has(settings.wid))
					throw new WhatsAppSuppressedError();
				let release: (() => Promise<void>) | null = null;
				let groupValue: unknown;
				try {
					const gate = input.beforeGroupData
						? await waitFor(
								input.beforeGroupData(signal).then(async (lease) => {
									if (signal.aborted && typeof lease === "function") {
										await lease();
										return undefined;
									}
									return lease;
								}),
								signal,
							)
						: undefined;
					release = typeof gate === "function" ? gate : null;
					groupValue = await this.#request(
						"getGroupData",
						{ groupId: input.groupId },
						signal,
					);
				} finally {
					if (release) await waitFor(release(), signal);
				}
				const group = record(groupValue);
				if (
					!group ||
					group.groupId !== input.groupId ||
					!text(group.subject) ||
					!group.subject.trim() ||
					group.subject.length > 256 ||
					hasControl(group.subject) ||
					group.isCommunity !== false ||
					group.isCommunityAnnounce !== false ||
					!Number.isSafeInteger(group.size) ||
					!Array.isArray(group.participants) ||
					group.size !== group.participants.length ||
					group.participants.length < 1 ||
					(input.audience === "test" && group.participants.length > 2) ||
					typeof group.allowParticipantsSendMessages !== "boolean"
				)
					throw new WhatsAppSuppressedError();
				const identities: string[] = [];
				const senders: RecordValue[] = [];
				for (const value of group.participants) {
					const member = record(value);
					if (
						!member ||
						!text(member.id) ||
						!IDENTITY.test(member.id) ||
						(member.lid !== undefined &&
							member.lid !== "" &&
							(!text(member.lid) || !IDENTITY.test(member.lid))) ||
						(member.phoneNumber !== undefined &&
							member.phoneNumber !== "" &&
							(!text(member.phoneNumber) ||
								!IDENTITY.test(member.phoneNumber))) ||
						typeof member.isAdmin !== "boolean" ||
						typeof member.isSuperAdmin !== "boolean"
					)
						throw new WhatsAppSuppressedError();
					identities.push((member.lid || member.id) as string);
					if (
						[member.id, member.lid, member.phoneNumber].some(
							(value) => text(value) && aliases.has(value),
						)
					)
						senders.push(member);
				}
				const participantDigest = `sha256:${createHash("sha256")
					.update(JSON.stringify(identities.sort()))
					.digest("hex")}`;
				if (
					new Set(identities).size !== identities.length ||
					senders.length !== 1 ||
					(!senders[0].isAdmin &&
						!senders[0].isSuperAdmin &&
						!group.allowParticipantsSendMessages) ||
					(input.expectedParticipantDigest !== undefined &&
						participantDigest !== input.expectedParticipantDigest)
				)
					throw new WhatsAppSuppressedError();
				return {
					groupId: input.groupId,
					title: group.subject.trim(),
					size: group.participants.length,
					senderId: account.chatId,
					senderPhone: this.#senderPhone,
					participantDigest,
					outgoingStatusesEnabled: true,
				};
			},
			15_000,
			"failed",
			input.signal,
		);
	}

	async sendDocument(input: DocumentRequest): Promise<{ messageId: string }> {
		if (
			!input ||
			!GROUP.test(input.groupId) ||
			!IDENTITY.test(input.senderId) ||
			phone(input.senderPhone) !== this.#senderPhone ||
			!DIGEST.test(input.participantDigest) ||
			!text(input.pdfSha256) ||
			!/^[a-f0-9]{64}$/.test(input.pdfSha256) ||
			!pdfBytes(input.pdf) ||
			input.pdf.length < 5 ||
			input.pdf.length >= MAX_DOCUMENT_BYTES ||
			!text(input.filename) ||
			!input.filename ||
			input.filename.length > 255 ||
			/[\\/]/.test(input.filename) ||
			input.filename.includes("\ufeff") ||
			hasControl(input.filename) ||
			!input.filename.toLowerCase().endsWith(".pdf") ||
			!text(input.caption) ||
			input.caption.length > 1024 ||
			hasControl(input.caption, true) ||
			typeof input.beforeSend !== "function"
		)
			return reject();
		const pdf = new Uint8Array(input.pdf);
		if (
			new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-" ||
			createHash("sha256").update(pdf).digest("hex") !== input.pdfSha256
		)
			return reject();
		const target = await this.verifyTarget({
			groupId: input.groupId,
			audience: input.audience,
			expectedParticipantDigest:
				input.audience === "test" ? input.participantDigest : undefined,
			beforeGroupData: input.beforeGroupData,
			signal: input.signal,
		});
		if (
			target.senderId !== input.senderId ||
			target.senderPhone !== phone(input.senderPhone)
		)
			throw new WhatsAppSuppressedError();
		const data = new FormData();
		data.append("chatId", target.groupId);
		data.append(
			"file",
			new Blob([pdf.buffer], { type: "application/pdf" }),
			input.filename,
		);
		data.append("fileName", input.filename);
		data.append("caption", input.caption);
		let started = false;
		return this.#deadline(
			async (signal) => {
				await waitFor(input.beforeSend(), signal);
				if (signal.aborted) return reject();
				started = true;
				const value = await this.#request(
					"sendFileByUpload",
					data,
					signal,
					true,
				);
				const result = record(value);
				if (
					result &&
					text(result.idMessage) &&
					MESSAGE_ID.test(result.idMessage) &&
					!("error" in result) &&
					!("errorMessage" in result)
				)
					return { messageId: result.idMessage };
				if (
					!result?.idMessage &&
					/^failed to upload file(?:[: .]|$)/i.test(description(value) ?? "")
				)
					return reject();
				return reject("uncertain");
			},
			30_000,
			() => (started ? "uncertain" : "failed"),
			input.signal,
		);
	}

	async getMessage(
		input: MessageRequest,
	): Promise<{ status: WhatsAppMessageStatus }> {
		if (
			!input ||
			!GROUP.test(input.groupId) ||
			!MESSAGE_ID.test(input.messageId) ||
			(input.senderId !== undefined && !IDENTITY.test(input.senderId)) ||
			(input.filename !== undefined &&
				(!text(input.filename) ||
					!input.filename ||
					hasControl(input.filename)))
		)
			return reject();
		return this.#deadline(
			async (signal) => {
				const value = await this.#request(
					"getMessage",
					{ chatId: input.groupId, idMessage: input.messageId },
					signal,
					false,
					true,
				);
				if (value === MISSING_MESSAGE) return { status: "pending" };
				const result = record(value);
				if (
					result?.type !== "outgoing" ||
					result.sendByApi !== true ||
					result.idMessage !== input.messageId ||
					result.chatId !== input.groupId ||
					result.typeMessage !== "documentMessage" ||
					result.mimeType !== "application/pdf" ||
					(input.filename !== undefined &&
						result.fileName !== input.filename) ||
					(input.senderId !== undefined &&
						result.senderId !== undefined &&
						result.senderId !== input.senderId &&
						result.senderId !== `${this.#senderPhone}@c.us`)
				)
					return reject();
				const status = result.statusMessage;
				if (status === "yellowCard") return { status: "suspended" };
				if (
					status === "pending" ||
					status === "sent" ||
					status === "delivered" ||
					status === "read" ||
					status === "failed" ||
					status === "suspended" ||
					status === "noAccount" ||
					status === "notInGroup"
				)
					return { status };
				return reject();
			},
			15_000,
			"failed",
			input.signal,
		);
	}
}
