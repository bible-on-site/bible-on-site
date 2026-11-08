/**
 * @jest-environment node
 *
 * Only a missing schema object may degrade a reader during a deploy
 * window — every other failure is a real error that must propagate so
 * stale-but-valid cache output is never replaced by a false empty/404.
 */
import { isMissingMysqlSchema } from "../../../src/lib/mysql-errors";

describe("isMissingMysqlSchema", () => {
	it("matches missing-column and missing-table errors by code", () => {
		expect(
			isMissingMysqlSchema({ code: "ER_BAD_FIELD_ERROR" }),
		).toBe(true);
		expect(isMissingMysqlSchema({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
	});

	it("matches by numeric errno", () => {
		expect(isMissingMysqlSchema({ errno: 1054 })).toBe(true);
		expect(isMissingMysqlSchema({ errno: 1146 })).toBe(true);
	});

	it("rejects operational errors", () => {
		expect(
			isMissingMysqlSchema(new Error("connect ECONNREFUSED")),
		).toBe(false);
		expect(isMissingMysqlSchema({ code: "ECONNREFUSED" })).toBe(false);
		expect(isMissingMysqlSchema({ errno: 1045 })).toBe(false);
		expect(isMissingMysqlSchema({ code: "ER_LOCK_WAIT_TIMEOUT" })).toBe(
			false,
		);
	});

	it("rejects non-error values", () => {
		for (const value of [null, undefined, 42, "ER_NO_SUCH_TABLE", []]) {
			expect(isMissingMysqlSchema(value)).toBe(false);
		}
	});
});
