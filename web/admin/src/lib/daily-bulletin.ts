import { toHebrewLetters } from "~/utils/hebrew";

export interface BulletinArticle {
	id: number;
	title: string;
	author: string;
	html: string;
}

export interface BulletinInput {
	date: string;
	hebrewDate: string;
	perekId: number;
	article: BulletinArticle | null;
	dedications: string[];
}

export interface BulletinArtifacts {
	subject: string;
	source: string;
	emailHtml: string;
	pdfBase64: string;
	filename: string;
}

export interface PreparedBulletin extends BulletinArtifacts {
	input: BulletinInput;
	delivery: { channel: "email" | "telegram" | "whatsapp"; status: string }[];
}

export function validateBulletinDate(value: unknown): string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error("יש לבחור תאריך תקין");
	}
	const date = new Date(`${value}T12:00:00Z`);
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		throw new Error("יש לבחור תאריך תקין");
	}
	return value;
}

export function todayInJerusalem(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Jerusalem",
	}).format(new Date());
}

export function hebrewBulletinDate(date: string): string {
	const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
		timeZone: "Asia/Jerusalem",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).formatToParts(new Date(`${validateBulletinDate(date)}T12:00:00Z`));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	return `${toHebrewLetters(Number(part("day")))} ${part("month")} ${toHebrewLetters(Number(part("year")) % 1000)}`;
}
