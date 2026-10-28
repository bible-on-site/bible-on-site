import "@tanstack/react-start/server-only";
import {
	CreateContactCommand,
	GetContactCommand,
	type GetContactCommandOutput,
	SESv2Client,
	SendEmailCommand,
	type TopicPreference,
	UpdateContactCommand,
} from "@aws-sdk/client-sesv2";
import { type CSSProperties, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type SesAudience = "test" | "real";
type SubscriptionStatus = "OPT_IN" | "OPT_OUT";
const FOOTER_MARKER = "<!--BULLETIN_EMAIL_FOOTER-->";
// Public project contacts, as published in the website's contact section.
const WEBSITE = "https://xn--febl3a.co.il/";
const CONTACT_EMAIL = "tanah.site@gmail.com";
const PHONE = "+37257078640";
const PHONE_DISPLAY = "+372-57078640";
const WHATSAPP = "https://wa.me/37257078640";
const TELEGRAM = "https://t.me/BibleOnSite";
const ICON_BASE =
	"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/branding/daily-bulletin/";
// Rasterized project SVGs; provenance and attribution are in the assets manifest.
const CONTACT_ICONS = {
	email: "envelope-12f047cbf921.png",
	phone: "phone-fba2eb24d511.png",
	whatsapp: "whatsapp-97aa65ad2e4e.png",
	telegram: "telegram-4d1164ab375c.png",
	globe: "globe-62b826c2ce07.png",
} as const;

export interface SesConfig {
	region: string;
	fromAddress: string;
	replyToAddress?: string;
	contactListName: string;
	configurationSetName: string;
	senderName: string;
	contactAddress?: string;
	beforeSend?: () => Promise<void>;
}

export interface SesContact {
	email: string;
	unsubscribeAll: boolean;
	topics: Record<string, SubscriptionStatus>;
	attributesData?: string;
}

export class SesError extends Error {
	constructor(
		message: string,
		public readonly outcome: "failed" | "uncertain",
	) {
		super(message);
		this.name = "SesError";
	}
}

export class SesSuppressedError extends SesError {
	constructor() {
		super("הנמען אינו מאשר קבלת דיוור בנושא זה", "failed");
		this.name = "SesSuppressedError";
	}
}

function invalid(): never {
	throw new SesError("הגדרות הדיוור חסרות או אינן תקינות", "failed");
}

function emailAddress(value: string): string {
	if (
		typeof value !== "string" ||
		value.length > 254 ||
		!/^[\x21-\x7e]+$/.test(value) ||
		/[<>(),;:"]/.test(value) ||
		!/^[^@]+@[^@]+\.[^@]+$/.test(value)
	) {
		return invalid();
	}
	return value.toLowerCase();
}

function audienceName(value: SesAudience): SesAudience {
	if (value !== "test" && value !== "real") return invalid();
	return value;
}

function authored(value: string): string {
	return value.replace(/״/g, '"').replace(/׳/g, "'").replace(/[־–—]/g, "-");
}

function footerLink(href: string, label: string, ltr = false): ReactElement {
	const style: CSSProperties = {
		color: "#28758a",
		textDecoration: "underline",
	};
	if (ltr) {
		style.display = "inline-block";
		style.direction = "ltr";
		style.unicodeBidi = "isolate";
	}
	return createElement(
		"a",
		{ href, dir: ltr ? "ltr" : undefined, style },
		label,
	);
}

function contactLink(
	icon: keyof typeof CONTACT_ICONS,
	href: string,
	label: string,
	ltr = false,
): ReactElement {
	return createElement(
		"span",
		{ dir: "rtl", style: { display: "inline-block", whiteSpace: "nowrap" } },
		createElement("img", {
			src: ICON_BASE + CONTACT_ICONS[icon],
			width: 16,
			height: 16,
			alt: "",
			role: "presentation",
			// Keep React 19 resource hints out of the renderer's direct table-row slot.
			fetchPriority: "low",
			style: {
				display: "inline-block",
				width: 16,
				height: 16,
				verticalAlign: "middle",
				marginLeft: 6,
				border: 0,
				outline: "none",
			},
		}),
		footerLink(href, label, ltr),
	);
}

function footerRow(config: SesConfig, replyTo: string): ReactElement {
	return createElement(
		"tr",
		null,
		createElement(
			"td",
			{
				dir: "rtl",
				align: "right",
				style: {
					padding: "20px 28px",
					background: "#f5f9fa",
					borderTop: "1px solid #dce5e7",
					textAlign: "right",
					fontFamily: "Arial,sans-serif",
					fontSize: 13,
					lineHeight: 1.8,
					color: "#637780",
				},
			},
			createElement(
				"footer",
				{ dir: "rtl", style: { textAlign: "right" } },
				createElement(
					"p",
					{ style: { margin: 0 } },
					"ליצירת קשר: ",
					contactLink("email", `mailto:${CONTACT_EMAIL}`, CONTACT_EMAIL, true),
					" \u00a0|\u00a0 ",
					contactLink("phone", `tel:${PHONE}`, PHONE_DISPLAY, true),
				),
				createElement(
					"p",
					{ style: { margin: "4px 0 0" } },
					contactLink("whatsapp", WHATSAPP, "ווטסאפ"),
					" \u00a0|\u00a0 ",
					contactLink("telegram", TELEGRAM, "טלגרם"),
					" \u00a0|\u00a0 ",
					contactLink("globe", WEBSITE, "לימוד יומי באתר"),
				),
				replyTo === CONTACT_EMAIL
					? null
					: createElement(
							"p",
							{ style: { margin: "6px 0 0" } },
							"למענה על הדיוור: ",
							footerLink(`mailto:${replyTo}`, replyTo, true),
						),
				config.contactAddress
					? createElement(
							"p",
							{ style: { margin: "8px 0 0", whiteSpace: "pre-line" } },
							authored(config.contactAddress),
						)
					: null,
				createElement(
					"p",
					{ style: { margin: "10px 0 0", fontSize: 12 } },
					"אפשר להסיר את הכתובת מרשימת התפוצה בכל עת: ",
					footerLink("{{amazonSESUnsubscribeUrl}}", "להסרה מרשימת התפוצה"),
				),
			),
		),
	);
}

function legacyFooter(row: ReactElement): ReactElement {
	return createElement(
		"table",
		{
			role: "presentation",
			cellPadding: 0,
			cellSpacing: 0,
			width: "100%",
			dir: "rtl",
			style: { borderCollapse: "collapse" },
		},
		createElement(
			"tbody",
			null,
			createElement(
				"tr",
				null,
				createElement(
					"td",
					{ align: "center" },
					createElement(
						"table",
						{
							role: "presentation",
							cellPadding: 0,
							cellSpacing: 0,
							width: "600",
							style: {
								width: "100%",
								maxWidth: 600,
								borderCollapse: "collapse",
								textAlign: "right",
							},
						},
						createElement("tbody", null, row),
					),
				),
			),
		),
	);
}

// Each RFC 2047 word stays below 75 characters without splitting UTF-8 codepoints.
function encodedSenderName(value: string): string {
	const chunks: string[] = [];
	let chunk = "";
	for (const char of value) {
		if (Buffer.byteLength(chunk + char, "utf8") > 42) {
			chunks.push(chunk);
			chunk = "";
		}
		chunk += char;
	}
	if (chunk) chunks.push(chunk);
	return chunks
		.map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`)
		.join(" ");
}

function metadata(error: unknown): { name?: string; status?: number } {
	if (typeof error !== "object" || error === null) return {};
	const value = error as {
		name?: string;
		$metadata?: { httpStatusCode?: number };
	};
	return { name: value.name, status: value.$metadata?.httpStatusCode };
}

function requestError(error: unknown, mutation: boolean): SesError {
	const { status } = metadata(error);
	const rejected =
		status !== undefined && status >= 400 && status < 500 && status !== 408;
	return new SesError(
		"לא ניתן להשלים את פעולת הדיוור",
		mutation && !rejected ? "uncertain" : "failed",
	);
}

function topicMap(preferences: TopicPreference[] | undefined) {
	const result: Record<string, SubscriptionStatus> = {};
	for (const preference of preferences ?? []) {
		const name = preference.TopicName;
		const status = preference.SubscriptionStatus;
		if (
			typeof name !== "string" ||
			!name ||
			name in result ||
			(status !== "OPT_IN" && status !== "OPT_OUT")
		) {
			throw new SesError("פרטי ההסכמה לדיוור אינם תקינים", "failed");
		}
		Object.defineProperty(result, name, { value: status, enumerable: true });
	}
	return result;
}

export function isSesSubscribed(
	contact: SesContact,
	audience: SesAudience,
): boolean {
	return (
		!contact.unsubscribeAll &&
		contact.topics[audienceName(audience)] === "OPT_IN"
	);
}

export class SesClient {
	private readonly client: SESv2Client;
	private readonly config: SesConfig;

	constructor(config: SesConfig) {
		if (
			!config.region?.trim() ||
			!config.contactListName?.trim() ||
			!config.configurationSetName?.trim() ||
			!config.senderName?.trim() ||
			/[\r\n]/.test(config.senderName) ||
			config.senderName.length > 100
		) {
			invalid();
		}
		this.config = {
			...config,
			region: config.region.trim(),
			contactListName: config.contactListName.trim(),
			configurationSetName: config.configurationSetName.trim(),
			fromAddress: emailAddress(config.fromAddress),
			replyToAddress: emailAddress(config.replyToAddress ?? config.fromAddress),
			senderName: authored(config.senderName.trim()),
			contactAddress: config.contactAddress?.trim(),
		};
		this.client = new SESv2Client({
			region: this.config.region,
			maxAttempts: 1,
		});
	}

	async getContact(email: string): Promise<SesContact | null> {
		const normalized = emailAddress(email);
		let result: GetContactCommandOutput;
		try {
			result = await this.client.send(
				new GetContactCommand({
					ContactListName: this.config.contactListName,
					EmailAddress: normalized,
				}),
				{ abortSignal: AbortSignal.timeout(15_000) },
			);
		} catch (error) {
			if (metadata(error).name === "NotFoundException") return null;
			throw requestError(error, false);
		}
		if (
			!result ||
			result.EmailAddress?.toLowerCase() !== normalized ||
			result.ContactListName !== this.config.contactListName ||
			typeof result.UnsubscribeAll !== "boolean"
		) {
			throw new SesError("פרטי ההסכמה לדיוור אינם תקינים", "failed");
		}
		return {
			email: normalized,
			unsubscribeAll: result.UnsubscribeAll,
			topics: topicMap(result.TopicPreferences),
			attributesData: result.AttributesData,
		};
	}

	/** Explicit consent setup only. Sending never creates or resubscribes a contact. */
	async ensureSubscribedContact(
		email: string,
		audience: SesAudience,
	): Promise<"subscribed" | "opted_out"> {
		const normalized = emailAddress(email);
		const topic = audienceName(audience);
		const contact = await this.getContact(normalized);
		// SES has no preference compare-and-swap. Never write a stale topic snapshot
		// over a concurrent unsubscribe; existing contacts use the native preference page.
		if (contact)
			return isSesSubscribed(contact, topic) ? "subscribed" : "opted_out";
		try {
			await this.client.send(
				new CreateContactCommand({
					ContactListName: this.config.contactListName,
					EmailAddress: normalized,
					TopicPreferences: [
						{ TopicName: topic, SubscriptionStatus: "OPT_IN" },
					],
					UnsubscribeAll: false,
				}),
				{ abortSignal: AbortSignal.timeout(15_000) },
			);
		} catch (error) {
			throw requestError(error, true);
		}
		return "subscribed";
	}

	/** Global suppression is monotonic and never replaces topic preferences. */
	async unsubscribeContact(
		email: string,
		audience?: SesAudience,
	): Promise<void> {
		if (audience !== undefined) audienceName(audience);
		const normalized = emailAddress(email);
		const contact = await this.getContact(normalized);
		if (!contact || contact.unsubscribeAll) return;
		try {
			await this.client.send(
				new UpdateContactCommand({
					ContactListName: this.config.contactListName,
					EmailAddress: normalized,
					UnsubscribeAll: true,
				}),
				{ abortSignal: AbortSignal.timeout(15_000) },
			);
		} catch (error) {
			throw requestError(error, true);
		}
	}

	async sendOne(input: {
		to: string;
		subject: string;
		html: string;
		audience: SesAudience;
		externalId?: string;
	}): Promise<string> {
		const to = emailAddress(input.to);
		const audience = audienceName(input.audience);
		if (
			!input.subject?.trim() ||
			/[\r\n]/.test(input.subject) ||
			!input.html?.trim() ||
			(input.externalId !== undefined &&
				!/^[a-zA-Z0-9_-]{1,256}$/.test(input.externalId)) ||
			input.html.split(FOOTER_MARKER).length > 2 ||
			input.html.split("{{amazonSESUnsubscribeUrl}}").length > 2
		)
			invalid();
		const contact = await this.getContact(to);
		if (!contact || !isSesSubscribed(contact, audience)) {
			throw new SesSuppressedError();
		}
		const replyTo = this.config.replyToAddress ?? this.config.fromAddress;
		const row = footerRow(this.config, replyTo);
		const hasMarker = input.html.includes(FOOTER_MARKER);
		const footer = renderToStaticMarkup(hasMarker ? row : legacyFooter(row));
		const html = hasMarker
			? input.html.replace(FOOTER_MARKER, () => footer)
			: /<\/body\s*>/i.test(input.html)
				? input.html.replace(/<\/body\s*>/i, (closing) => footer + closing)
				: input.html + footer;
		const tags: { Name: string; Value: string }[] = [
			{ Name: "bulletin_audience", Value: audience },
		];
		if (input.externalId)
			tags.push({ Name: "bulletin_attempt", Value: input.externalId });
		if (this.config.beforeSend) {
			try {
				await this.config.beforeSend();
			} catch (error) {
				if (error instanceof SesSuppressedError) throw error;
				throw new SesError("לא ניתן להשלים את פעולת הדיוור", "failed");
			}
		}
		let result: { MessageId?: string };
		try {
			result = await this.client.send(
				new SendEmailCommand({
					FromEmailAddress: `${encodedSenderName(this.config.senderName)} <${this.config.fromAddress}>`,
					ReplyToAddresses: [replyTo],
					ConfigurationSetName: this.config.configurationSetName,
					Destination: { ToAddresses: [to] },
					ListManagementOptions: {
						ContactListName: this.config.contactListName,
						TopicName: audience,
					},
					Content: {
						Simple: {
							Subject: { Data: input.subject, Charset: "UTF-8" },
							Body: { Html: { Data: html, Charset: "UTF-8" } },
						},
					},
					EmailTags: tags,
				}),
				{ abortSignal: AbortSignal.timeout(15_000) },
			);
		} catch (error) {
			throw requestError(error, true);
		}
		if (
			!result ||
			typeof result.MessageId !== "string" ||
			!result.MessageId.trim()
		) {
			throw new SesError("לא ניתן לוודא אם הדיוור התקבל לשליחה", "uncertain");
		}
		return result.MessageId;
	}
}
