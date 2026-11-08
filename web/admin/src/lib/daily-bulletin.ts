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

/**
 * The bulletin target date's uniform Hebrew month/day (#3098). Intl returns
 * the ordinal Hebrew month (1-13; a leap year counts Adar I then Adar II as
 * months 6-7), which maps onto the uniform numbering shared with the app,
 * the API and the DB: 1=Tishrei..12=Elul, 6=Adar of a non-leap year, 13=Adar
 * I, 14=Adar II. Leap years follow the 19-year Metonic cycle —
 * ((7·year+1) mod 19) < 7 — matching every calendar implementation.
 */
export function hebrewBulletinMonthDay(date: string): {
	hebrewMonth: number;
	hebrewDay: number;
} {
	const parts = new Intl.DateTimeFormat("en-u-ca-hebrew", {
		timeZone: "Asia/Jerusalem",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).formatToParts(new Date(`${validateBulletinDate(date)}T12:00:00Z`));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	const rawMonth = part("month").trim().toLowerCase();
	let hebrewMonth = MONTH_NAME_TO_UNIFORM[rawMonth];
	if (hebrewMonth === undefined) {
		// Some ICU builds emit the ordinal month number instead of a name:
		// 1-13 with Adar I/Adar II as 6/7 in a leap year — map through the
		// Metonic cycle ((7·year+1) mod 19) < 7 for the leap distinction.
		const ordinal = Number(rawMonth);
		const leap = (7 * Number(part("year")) + 1) % 19 < 7;
		hebrewMonth =
			ordinal <= 5 || !leap
				? ordinal
				: ordinal === 6
					? 13
					: ordinal === 7
						? 14
						: ordinal - 1;
	}
	return { hebrewMonth, hebrewDay: Number(part("day")) };
}

/**
 * `en` (and alias spellings seen across ICU builds) Hebrew month names to the
 * uniform numbering shared with the app, the API and the DB: 1=Tishrei..
 * 12=Elul, 6=Adar of a non-leap year, 13=Adar I, 14=Adar II (#3098).
 */
const MONTH_NAME_TO_UNIFORM: Record<string, number> = {
	tishri: 1,
	tishrei: 1,
	cheshvan: 2,
	heshvan: 2,
	kislev: 3,
	chislev: 3,
	tevet: 4,
	teveth: 4,
	shevat: 5,
	adar: 6,
	"adar i": 13,
	"adar aleph": 13,
	"adar a": 13,
	"adar ii": 14,
	"adar bet": 14,
	"adar b": 14,
	nisan: 7,
	nissan: 7,
	iyar: 8,
	iyyar: 8,
	sivan: 9,
	tammuz: 10,
	tamuz: 10,
	av: 11,
	elul: 12,
};

export function hebrewBulletinDate(date: string): string {
	const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
		timeZone: "Asia/Jerusalem",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).formatToParts(new Date(`${validateBulletinDate(date)}T12:00:00Z`));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	const month = part("month").replace(/׳/g, "'").replace(/״/g, '"');
	return `${toHebrewLetters(Number(part("day")))} ${month} ${toHebrewLetters(Number(part("year")) % 1000)}`;
}
