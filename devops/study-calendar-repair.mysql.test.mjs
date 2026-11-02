import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
	calendarRepairSql,
	planStudyCalendarRepair,
} from "./study-calendar-repair.mjs";

const enabled = Boolean(process.env.BULLETIN_CALENDAR_TEST_DB_URL);
test(
	"native MySQL calendar repair preserves content, rejects drift and rolls back exactly",
	{
		skip: !enabled,
	},
	async () => {
		const require = createRequire(
			new URL("../web/admin/package.json", import.meta.url),
		);
		const mysql = require("mysql2/promise");
		const url = new URL(process.env.BULLETIN_CALENDAR_TEST_DB_URL);
		assert.ok(
			["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname),
			"Only an owned loopback fixture is permitted",
		);
		const db = `calendar_repair_${randomUUID().replace(/-/g, "")}`;
		const config = {
			host: url.hostname,
			port: Number(url.port || 3306),
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			multipleStatements: true,
			connectTimeout: 5000,
			dateStrings: true,
		};
		const root = await mysql.createConnection(config);
		let created = false;
		const rows = [
			{
				perek_id: 1,
				cycle: 1,
				date: "2014-03-28",
				hebdate: "57750329",
				star_rise: "17:16:00",
			},
			{
				perek_id: 2,
				cycle: 1,
				date: "2014-03-28",
				hebdate: "57750330",
				star_rise: "17:17:00",
			},
		];
		const plan = planStudyCalendarRepair(rows);
		// Only these fixed fixture operations or the validated planner can supply SQL.
		const commands = Object.freeze({
			bootstrap:
				"CREATE TABLE tanah_perek_date (perek_id INT,cycle TINYINT,date DATE,hebdate VARCHAR(20),star_rise TIME,PRIMARY KEY(perek_id,cycle)) ENGINE=InnoDB; CREATE TABLE unrelated_content(id INT PRIMARY KEY, article TEXT, consent VARCHAR(20), provider_id VARCHAR(80)); INSERT INTO unrelated_content VALUES(1,'immutable article/PDF snapshot','unsubscribed','retained-provider-id'); INSERT INTO tanah_perek_date VALUES(1,1,'2014-03-28','57750329','17:16:00'),(2,1,'2014-03-28','57750330','17:17:00');",
			reset:
				"DELETE FROM tanah_perek_date; INSERT INTO tanah_perek_date VALUES(1,1,'2014-03-28','57750329','17:16:00'),(2,1,'2014-03-28','57750330','17:17:00');",
			drift0: "UPDATE tanah_perek_date SET date='2015-01-01' WHERE perek_id=1",
			drift1: "UPDATE tanah_perek_date SET hebdate='57750330' WHERE perek_id=1",
			drift2:
				"UPDATE tanah_perek_date SET star_rise='18:00:00' WHERE perek_id=1",
			drift3:
				"INSERT INTO tanah_perek_date VALUES(3,1,'2014-03-28','57750401','17:16:00')",
			drift4: "DELETE FROM tanah_perek_date WHERE perek_id=2",
			repair: calendarRepairSql(plan),
			rollback: calendarRepairSql(plan, true),
		});
		async function connect() {
			return mysql.createConnection({ ...config, database: db });
		}
		async function execute(operation) {
			let sql;
			switch (operation) {
				case "bootstrap":
					sql = commands.bootstrap;
					break;
				case "reset":
					sql = commands.reset;
					break;
				case "drift0":
					sql = commands.drift0;
					break;
				case "drift1":
					sql = commands.drift1;
					break;
				case "drift2":
					sql = commands.drift2;
					break;
				case "drift3":
					sql = commands.drift3;
					break;
				case "drift4":
					sql = commands.drift4;
					break;
				case "repair":
					sql = commands.repair;
					break;
				case "rollback":
					sql = commands.rollback;
					break;
				default:
					throw new Error("Unknown fixture operation");
			}
			const c = await connect();
			try {
				await c.query(sql);
			} catch (error) {
				await c.rollback();
				throw error;
			} finally {
				await c.end();
			}
		}
		async function read() {
			const c = await connect();
			try {
				const [dates] = await c.query(
					"SELECT perek_id,cycle,CAST(date AS CHAR) AS date,hebdate,CAST(star_rise AS CHAR) AS star_rise FROM tanah_perek_date ORDER BY perek_id",
				);
				const [content] = await c.query(
					"SELECT * FROM unrelated_content ORDER BY id",
				);
				return { dates, content };
			} finally {
				await c.end();
			}
		}
		try {
			await root.query(`CREATE DATABASE ${db}`);
			created = true;
			await execute("bootstrap");
			const before = await read();
			await assert.rejects(
				execute("DROP DATABASE mysql"),
				/Unknown fixture operation/,
			);
			await execute("repair");
			const after = await read();
			assert.deepEqual(
				after.dates,
				rows.map((row, i) => ({
					...row,
					date: i === 0 ? "2014-12-21" : "2014-12-22",
				})),
			);
			assert.deepEqual(after.content, before.content);
			await execute("repair");
			assert.deepEqual(await read(), after);
			await execute("rollback");
			assert.deepEqual(await read(), before);
			for (const mutate of ["drift0", "drift1", "drift2", "drift3", "drift4"]) {
				await execute(mutate);
				const drifted = await read();
				await assert.rejects(
					execute("repair"),
					(error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED",
				);
				assert.deepEqual(
					await read(),
					drifted,
					"rejected repair must not write any persistent value",
				);
				await execute("reset");
			}
		} finally {
			if (created) await root.query(`DROP DATABASE ${db}`);
			await root.end();
		}
	},
);
