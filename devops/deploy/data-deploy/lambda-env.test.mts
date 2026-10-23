import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isAccessDenied,
	SSM_DB_URL_PARAM,
	updatedLambdaEnv,
} from "./lambda-env.mts";

const DB_URL = "mysql://admin:secret@db.internal:3306/tanah";

describe("updatedLambdaEnv", () => {
	it("adds DB_URL while preserving unrelated variables", () => {
		const merged = updatedLambdaEnv(
			{ S3_BUCKET: "bucket", UNRELATED: "keep" },
			DB_URL,
		);

		assert.deepEqual(merged, {
			S3_BUCKET: "bucket",
			UNRELATED: "keep",
			DB_URL,
		});
	});

	it("replaces a stale DB_URL value", () => {
		const merged = updatedLambdaEnv({ DB_URL: "mysql://old/db" }, DB_URL);

		assert.equal(merged?.DB_URL, DB_URL);
	});

	it("returns undefined when DB_URL already matches", () => {
		assert.equal(
			updatedLambdaEnv({ DB_URL, S3_BUCKET: "bucket" }, DB_URL),
			undefined,
		);
	});

	it("does not mutate the existing variables object", () => {
		const existing = { S3_BUCKET: "bucket" };

		updatedLambdaEnv(existing, DB_URL);

		assert.deepEqual(existing, { S3_BUCKET: "bucket" });
	});

	it("points at the SSM parameter holding the DB URL", () => {
		assert.equal(SSM_DB_URL_PARAM, "bible-on-site-tanah-db-url");
	});
});

describe("isAccessDenied", () => {
	it("detects the AWS AccessDeniedException name", () => {
		assert.equal(isAccessDenied(new Error("denied")), false);
		const denied = Object.assign(new Error("denied"), {
			name: "AccessDeniedException",
		});
		assert.equal(isAccessDenied(denied), true);
	});

	it("rejects other failures", () => {
		const notFound = Object.assign(new Error("missing"), {
			name: "ResourceNotFoundException",
		});
		assert.equal(isAccessDenied(notFound), false);
		assert.equal(isAccessDenied(null), false);
		assert.equal(isAccessDenied("AccessDeniedException"), false);
	});
});
