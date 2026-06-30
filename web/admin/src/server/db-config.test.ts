import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultMysqlDatabaseName,
	defaultMysqlUrl,
	resolveMysqlUrl,
} from "./db-config";

describe("db-config", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("defaultMysqlDatabaseName is tanah in production", () => {
		vi.stubEnv("NODE_ENV", "production");
		expect(defaultMysqlDatabaseName()).toBe("tanah");
	});

	it("defaultMysqlDatabaseName is tanah-dev when not production", () => {
		vi.stubEnv("NODE_ENV", "development");
		expect(defaultMysqlDatabaseName()).toBe("tanah-dev");
		vi.stubEnv("NODE_ENV", "test");
		expect(defaultMysqlDatabaseName()).toBe("tanah-dev");
	});

	it("defaultMysqlUrl uses default database name", () => {
		vi.stubEnv("NODE_ENV", "development");
		expect(defaultMysqlUrl()).toBe(
			"mysql://root:test_123@localhost:3306/tanah-dev",
		);
	});

	it("resolveMysqlUrl prefers DB_URL when set", () => {
		vi.stubEnv("DB_URL", "mysql://u:p@h:3307/mydb");
		expect(resolveMysqlUrl()).toBe("mysql://u:p@h:3307/mydb");
	});

	it("resolveMysqlUrl trims DB_URL", () => {
		vi.stubEnv("DB_URL", "  mysql://x:y@z/db  ");
		expect(resolveMysqlUrl()).toBe("mysql://x:y@z/db");
	});
});
