/**
 * Unit tests for the shared public asset URL builder
 */

import { assetsUrl } from "../../../src/lib/assets-url";

describe("assetsUrl", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.ASSETS_BASE_URL;
		delete process.env.S3_ENDPOINT;
		delete process.env.S3_BUCKET;
		delete process.env.S3_REGION;
		delete process.env.AWS_REGION;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("builds the AWS S3 virtual-hosted URL by default", () => {
		expect(assetsUrl("recordings/1_record.mp3")).toBe(
			"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3",
		);
	});

	it("honours S3_BUCKET/S3_REGION overrides", () => {
		process.env.S3_BUCKET = "bucket-x";
		process.env.S3_REGION = "us-east-1";

		expect(assetsUrl("a/b.jpg")).toBe(
			"https://bucket-x.s3.us-east-1.amazonaws.com/a/b.jpg",
		);
	});

	it("falls back to AWS_REGION when S3_REGION is unset", () => {
		process.env.AWS_REGION = "eu-west-1";

		expect(assetsUrl("k")).toBe(
			"https://bible-on-site-assets.s3.eu-west-1.amazonaws.com/k",
		);
	});

	it("builds path-style URLs when S3_ENDPOINT is set", () => {
		process.env.S3_ENDPOINT = "http://localhost:4566/";
		process.env.S3_BUCKET = "bucket-x";

		expect(assetsUrl("a/b.jpg")).toBe(
			"http://localhost:4566/bucket-x/a/b.jpg",
		);
	});

	it("uses ASSETS_BASE_URL (CDN) ahead of S3_ENDPOINT and S3 settings", () => {
		process.env.ASSETS_BASE_URL = "https://assets.xn--febl3a.co.il/";
		process.env.S3_ENDPOINT = "http://localhost:4566";
		process.env.S3_BUCKET = "bucket-x";
		process.env.S3_REGION = "us-east-1";

		expect(assetsUrl("recordings/1_record.mp3")).toBe(
			"https://assets.xn--febl3a.co.il/recordings/1_record.mp3",
		);
	});
});
