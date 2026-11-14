import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const months = new Map([
	["Tishri", 1],
	["Heshvan", 2],
	["Kislev", 3],
	["Tevet", 4],
	["Shevat", 5],
	["Adar", 6],
	["Nisan", 7],
	["Iyar", 8],
	["Sivan", 9],
	["Tamuz", 10],
	["Tammuz", 10],
	["Av", 11],
	["Elul", 12],
	["Adar I", 13],
	["Adar II", 14],
]);
const calendar = new Intl.DateTimeFormat("en-US-u-ca-hebrew-nu-latn", {
	timeZone: "UTC",
	year: "numeric",
	month: "long",
	day: "numeric",
});
function check(value, message) {
	if (!value) throw new Error(message);
}
export function hebrewDateKey(date) {
	const parts = Object.fromEntries(
		calendar.formatToParts(date).map((p) => [p.type, p.value]),
	);
	const month = months.get(parts.month);
	check(month !== undefined, "Unrecognized Hebrew calendar month");
	return String(Number(parts.year) * 10000 + month * 100 + Number(parts.day));
}
function validIso(date) {
	if (typeof date !== "string" || date.length !== 10) return false;
	const instant = new Date(`${date}T12:00:00Z`);
	return (
		Number.isFinite(instant.valueOf()) &&
		instant.toISOString().slice(0, 10) === date
	);
}
function validTime(value) {
	if (typeof value !== "string" || value.length !== 8) return false;
	const parts = value.split(":");
	return (
		parts.length === 3 &&
		parts.every(
			(p, i) =>
				p.length === 2 &&
				Number.isInteger(Number(p)) &&
				String(Number(p)).padStart(2, "0") === p &&
				Number(p) >= 0 &&
				Number(p) < (i === 0 ? 24 : 60),
		)
	);
}
/** Derive exact ISO dates with ICU; Hebrew months and days are never Gregorian inputs. */
export function planStudyCalendarRepair(rows) {
	check(
		Array.isArray(rows) && rows.length > 0 && rows.length <= 9290,
		"Invalid calendar snapshot size",
	);
	const seen = new Set();
	const normalized = rows.map((row) => {
		check(
			row &&
				typeof row === "object" &&
				!Array.isArray(row) &&
				Object.keys(row).length === 5 &&
				["perek_id", "cycle", "date", "hebdate", "star_rise"].every((k) =>
					Object.hasOwn(row, k),
				),
			"Invalid calendar row shape",
		);
		check(
			Number.isInteger(row.perek_id) &&
				row.perek_id >= 1 &&
				row.perek_id <= 929 &&
				Number.isInteger(row.cycle) &&
				row.cycle >= 1 &&
				row.cycle <= 127,
			"Invalid calendar row identity",
		);
		const id = `${row.perek_id}/${row.cycle}`;
		check(!seen.has(id), "Duplicate calendar row identity");
		seen.add(id);
		const hebdate = String(row.hebdate);
		check(
			hebdate.length === 8 &&
				Number.isSafeInteger(Number(hebdate)) &&
				String(Number(hebdate)) === hebdate,
			"Invalid Hebrew date encoding",
		);
		const year = Math.floor(Number(hebdate) / 10000);
		check(
			year >= 5000 && year <= 6999,
			"Hebrew year outside reviewed repair range",
		);
		check(
			validIso(row.date) && validTime(row.star_rise),
			"Invalid existing calendar date or star-rise time",
		);
		return { ...row, hebdate, year };
	});
	const years = normalized.map((row) => row.year);
	const first = Math.min(...years) - 3762,
		last = Math.max(...years) - 3759;
	const index = new Map();
	for (
		let at = Date.UTC(first, 0, 1, 12);
		at < Date.UTC(last + 1, 0, 1, 12);
		at += 86400000
	) {
		const date = new Date(at);
		index.set(hebrewDateKey(date), date.toISOString().slice(0, 10));
	}
	const result = normalized
		.map(({ year: _year, ...row }) => {
			const corrected = index.get(row.hebdate);
			check(corrected !== undefined, "Invalid canonical Hebrew calendar date");
			return { ...row, corrected };
		})
		.sort((a, b) => a.perek_id - b.perek_id || a.cycle - b.cycle);
	return {
		rows: result,
		changed: result.filter((row) => row.date !== row.corrected).length,
		snapshotSha256: createHash("sha256")
			.update(JSON.stringify(result))
			.digest("hex"),
	};
}
function assertion(condition, message) {
	return `-- ${message}\nINSERT INTO bulletin_calendar_guard (ok) SELECT IF(${condition},1,0);\n`;
}
/** Lock and guard every original field; the only persistent assignment is p.date. */
export function calendarRepairSql(plan, rollback = false) {
	check(plan?.rows?.length > 0, "A verified calendar plan is required");
	const rows = plan.rows;
	const values = rows
		.map(
			(row) =>
				`(${row.perek_id},${row.cycle},'${rollback ? row.corrected : row.date}','${row.hebdate}','${row.star_rise}','${rollback ? row.date : row.corrected}')`,
		)
		.join(",\n");
	const matches = "p.perek_id=r.perek_id AND p.cycle=r.cycle";
	const retained = "p.hebdate=r.hebdate AND p.star_rise=r.star_rise";
	return (
		`-- Guarded calendar-only ${rollback ? "rollback" : "repair"} - snapshot ${plan.snapshotSha256}.\n` +
		"CREATE TEMPORARY TABLE bulletin_calendar_repair (perek_id INT NOT NULL,cycle TINYINT NOT NULL,previous_date DATE NOT NULL,hebdate VARCHAR(20) NOT NULL,star_rise TIME NOT NULL,corrected_date DATE NOT NULL,PRIMARY KEY(perek_id,cycle));\n" +
		`INSERT INTO bulletin_calendar_repair VALUES\n${values};\n` +
		"CREATE TEMPORARY TABLE bulletin_calendar_guard (ok TINYINT NOT NULL,CONSTRAINT calendar_snapshot_verified CHECK(ok=1));\n" +
		"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\nSTART TRANSACTION;\n" +
		"SET @calendarLock = 'SELECT p.perek_id,p.cycle FROM tanah_perek_date p JOIN bulletin_calendar_repair r ON p.perek_id=r.perek_id AND p.cycle=r.cycle ORDER BY p.perek_id,p.cycle FOR UPDATE';\nPREPARE calendarLock FROM @calendarLock;\nEXECUTE calendarLock;\nDEALLOCATE PREPARE calendarLock;\n" +
		assertion(
			`(SELECT COUNT(*) FROM tanah_perek_date)=${rows.length} AND (SELECT COUNT(*) FROM tanah_perek_date p JOIN bulletin_calendar_repair r ON ${matches} WHERE ${retained} AND p.date IN (r.previous_date,r.corrected_date))=${rows.length}`,
			"Calendar snapshot changed",
		) +
		`SET @calendarExpected=(SELECT COUNT(*) FROM tanah_perek_date p JOIN bulletin_calendar_repair r ON ${matches} WHERE p.date<>r.corrected_date);\n` +
		"SET @calendarUpdate='UPDATE tanah_perek_date p JOIN bulletin_calendar_repair r ON p.perek_id=r.perek_id AND p.cycle=r.cycle SET p.date=r.corrected_date WHERE p.date=r.previous_date';\nPREPARE calendarUpdate FROM @calendarUpdate;\nEXECUTE calendarUpdate;\nSET @calendarChanged=ROW_COUNT();\nDEALLOCATE PREPARE calendarUpdate;\n" +
		assertion(
			`@calendarChanged=@calendarExpected AND (SELECT COUNT(*) FROM tanah_perek_date p JOIN bulletin_calendar_repair r ON ${matches} WHERE ${retained} AND p.date=r.corrected_date)=${rows.length}`,
			"Calendar repair verification failed",
		) +
		"COMMIT;\n"
	);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const [input, output, expected] = process.argv.slice(2);
	check(
		input && output && Number.isSafeInteger(Number(expected)),
		"Usage: study-calendar-repair.mjs snapshot.json output.sql expected-row-count",
	);
	const snapshot = JSON.parse(readFileSync(input, "utf8"));
	check(
		snapshot.readonly === true && snapshot.tlsVerified === true,
		"Verified database snapshot required",
	);
	check(
		snapshot.calendarRows?.length === Number(expected),
		"Unexpected database row count",
	);
	const plan = planStudyCalendarRepair(snapshot.calendarRows);
	writeFileSync(output, calendarRepairSql(plan), { flag: "wx" });
	writeFileSync(`${output}.rollback.sql`, calendarRepairSql(plan, true), {
		flag: "wx",
	});
	writeFileSync(`${output}.plan.json`, JSON.stringify(plan, null, 2), {
		flag: "wx",
		mode: 0o600,
	});
	console.log(
		JSON.stringify({
			rows: plan.rows.length,
			changed: plan.changed,
			snapshotSha256: plan.snapshotSha256,
		}),
	);
}
