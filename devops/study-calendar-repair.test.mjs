import assert from "node:assert/strict";
import { test } from "node:test";
import {
	calendarRepairSql,
	hebrewDateKey,
	planStudyCalendarRepair,
} from "./study-calendar-repair.mjs";

const row = (overrides = {}) => ({
	perek_id: 1,
	cycle: 1,
	date: "2014-03-28",
	hebdate: "57750329",
	star_rise: "17:16:00",
	...overrides,
});
test("ICU resolves real cycle starts, leap months and day 30", () => {
	for (const [date, key] of [
		["2014-12-21", "57750329"],
		["2014-12-22", "57750330"],
		["2018-07-15", "57781103"],
		["2022-02-06", "57821305"],
		["2025-08-31", "57851207"],
		["2024-02-10", "57841301"],
		["2024-03-11", "57841401"],
		["2026-10-29", "57870218"],
	]) {
		assert.equal(hebrewDateKey(new Date(`${date}T12:00:00Z`)), key);
		assert.equal(
			planStudyCalendarRepair([row({ hebdate: key })]).rows[0].corrected,
			date,
		);
	}
});
test("plan preserves all source identities and star-rise times and is deterministic", () => {
	const source = [row({ perek_id: 2, hebdate: "57750330" }), row()];
	const before = JSON.stringify(source);
	const plan = planStudyCalendarRepair(source);
	assert.equal(JSON.stringify(source), before);
	assert.equal(plan.changed, 2);
	assert.equal(
		plan.snapshotSha256,
		planStudyCalendarRepair(source.toReversed()).snapshotSha256,
	);
	assert.equal(plan.rows[0].star_rise, "17:16:00");
	assert.equal(
		planStudyCalendarRepair([row({ date: "2014-12-21" })]).changed,
		0,
	);
});
test("rejects malformed, duplicate, invalid or injection-bearing snapshots", () => {
	for (const source of [
		null,
		[],
		[null],
		[row(), row()],
		[row({ perek_id: 0 })],
		[row({ cycle: 0 })],
		[row({ hebdate: "57841430" })],
		[row({ hebdate: "57801332" })],
		[row({ hebdate: "57750329;DROP" })],
		[row({ hebdate: "49990329" })],
		[row({ date: "2014-02-30" })],
		[row({ star_rise: "99:00:00" })],
		[row({ star_rise: "1:00:00" })],
		[row({ star_rise: "17:60:00" })],
		[row({ extra: "x" })],
	]) {
		assert.throws(() => planStudyCalendarRepair(source));
	}
});
test("SQL locks and guards the snapshot, changes only dates and produces an exact rollback", () => {
	const plan = planStudyCalendarRepair([row()]);
	const sql = calendarRepairSql(plan);
	const rollback = calendarRepairSql(plan, true);
	assert.match(sql, /CREATE TEMPORARY TABLE/);
	assert.match(sql, /FOR UPDATE/);
	assert.match(sql, /p.hebdate=r.hebdate AND p.star_rise=r.star_rise/);
	assert.match(sql, /SET p.date=r.corrected_date/);
	assert.match(sql, /@calendarChanged=@calendarExpected/);
	assert.ok(sql.endsWith("COMMIT;\n"));
	assert.ok(
		!sql
			.split("\n")
			.filter((line) => line.startsWith("--"))
			.some((line) => line.includes(";")),
		"legacy parser splits semicolons in comments",
	);
	assert.ok(!/DROP|TRUNCATE|DELETE|SET p.hebdate|SET p.star_rise/.test(sql));
	assert.ok(
		sql.includes("(1,1,'2014-03-28','57750329','17:16:00','2014-12-21')"),
	);
	assert.ok(
		rollback.includes("(1,1,'2014-12-21','57750329','17:16:00','2014-03-28')"),
	);
	assert.throws(() => calendarRepairSql(null));
});

import { readFileSync } from "node:fs";

test("the checked-in bootstrap uses canonical dates for every existing cycle", () => {
	const sql = readFileSync(
		new URL(
			"../data/mysql/tanah_sefarim_and_perakim_data.sql",
			import.meta.url,
		),
		"utf8",
	);
	const dateSection = sql.slice(sql.indexOf("-- tanah_perek_date"));
	const rows = dateSection
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("VALUES ("))
		.map((line) => {
			const parts = line
				.slice(8, -2)
				.split(",")
				.map((value) => value.trim());
			assert.equal(parts.length, 5);
			return {
				perek_id: Number(parts[0]),
				cycle: Number(parts[1]),
				date: parts[2].slice(1, -1),
				hebdate: parts[3].slice(1, -1),
				star_rise: parts[4].slice(1, -1),
			};
		});
	assert.ok(rows.length >= 929 && rows.length % 929 === 0);
	const plan = planStudyCalendarRepair(rows);
	assert.equal(plan.changed, 0);
	const cycles = new Map();
	for (const row of rows)
		cycles.set(row.cycle, (cycles.get(row.cycle) || 0) + 1);
	for (const count of cycles.values()) assert.equal(count, 929);
});
