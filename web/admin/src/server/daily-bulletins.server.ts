import "@tanstack/react-start/server-only";
import { randomInt } from "node:crypto";
import type {
	BulletinArtifacts,
	BulletinInput,
	PreparedBulletin,
} from "~/lib/daily-bulletin";
import { hebrewBulletinDate } from "~/lib/daily-bulletin";
import { pool, query, queryOne } from "./db";
import { renderDailyBulletin } from "./render-daily.server";

interface BulletinRow {
	input_json: BulletinInput | string;
	subject: string;
	source: string;
	email_html: string;
	pdf_data: Buffer;
	filename: string;
}

export async function readPreparedBulletin(
	date: string,
): Promise<PreparedBulletin | null> {
	const row = await queryOne<BulletinRow>(
		"SELECT input_json, subject, source, email_html, pdf_data, filename FROM tanah_daily_bulletin WHERE bulletin_date = ?",
		[date],
	);
	if (!row) return null;
	const input =
		typeof row.input_json === "string"
			? (JSON.parse(row.input_json) as BulletinInput)
			: row.input_json;
	const delivery = await query<PreparedBulletin["delivery"][number]>(
		"SELECT channel, status FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? ORDER BY channel",
		[date],
	);
	return {
		input,
		subject: row.subject,
		source: row.source,
		emailHtml: row.email_html,
		pdfBase64: row.pdf_data.toString("base64"),
		filename: row.filename,
		delivery,
	};
}

export async function prepareBulletin(date: string): Promise<PreparedBulletin> {
	const existing = await readPreparedBulletin(date);
	if (existing) return existing;
	// The persisted 929 date mapping covers every study day in every known cycle.
	// Friday and Saturday resolve to Thursday. Holiday advance sends use their own
	// target date, rather than the date on which the worker is running.
	const studyDate = new Date(`${date}T12:00:00Z`);
	const day = studyDate.getUTCDay();
	if (day === 5 || day === 6)
		studyDate.setUTCDate(studyDate.getUTCDate() - day + 4);
	const perek = await queryOne<{ perek_id: number }>(
		"SELECT perek_id FROM tanah_perek_date WHERE date = ? ORDER BY cycle DESC LIMIT 1",
		[studyDate.toISOString().slice(0, 10)],
	);
	if (!perek) throw new Error("לא נמצא פרק לימוד לתאריך שנבחר");
	const articles = await query<{
		id: number;
		name: string;
		author: string;
		content: string;
	}>(
		`SELECT a.id, a.name, au.name AS author, a.content FROM tanah_article a
		 JOIN tanah_author au ON au.id = a.author_id
		 WHERE a.perek_id = ? AND a.distributable = TRUE AND a.content IS NOT NULL AND TRIM(a.content) <> ''
		 ORDER BY a.priority, a.id`,
		[perek.perek_id],
	);
	const chosen = articles.length ? articles[randomInt(articles.length)] : null;
	const dedications = await query<{ subject: string }>(
		`SELECT DISTINCT d.id, d.subject FROM tanah_dedication d
		 JOIN tanah_perek_dedication pd ON pd.dedication_id = d.id
		 WHERE ? BETWEEN pd.perek_id_low AND pd.perek_id_high ORDER BY d.id`,
		[perek.perek_id],
	);
	const input: BulletinInput = {
		date,
		hebrewDate: hebrewBulletinDate(date),
		perekId: perek.perek_id,
		article: chosen
			? {
					id: chosen.id,
					title: chosen.name,
					author: chosen.author,
					html: chosen.content,
				}
			: null,
		dedications: dedications.map((d) => d.subject),
	};
	const artifacts: BulletinArtifacts = await renderDailyBulletin(input);
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		// Concurrent preparation keeps the first complete result. Never overwrite
		// already prepared content or create a date with only one of the two formats.
		await connection.execute(
			`INSERT INTO tanah_daily_bulletin (bulletin_date, perek_id, article_id, input_json, subject, source, email_html, pdf_data, filename)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE bulletin_date = bulletin_date`,
			[
				date,
				input.perekId,
				input.article?.id ?? null,
				JSON.stringify(input),
				artifacts.subject,
				artifacts.source,
				artifacts.emailHtml,
				Buffer.from(artifacts.pdfBase64, "base64"),
				artifacts.filename,
			],
		);
		for (const channel of ["email", "telegram", "whatsapp"]) {
			await connection.execute(
				`INSERT INTO tanah_daily_bulletin_delivery (bulletin_date, channel) VALUES (?, ?)
				 ON DUPLICATE KEY UPDATE bulletin_date = bulletin_date`,
				[date, channel],
			);
		}
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
	const saved = await readPreparedBulletin(date);
	if (!saved) throw new Error("שמירת העלון נכשלה");
	return saved;
}
