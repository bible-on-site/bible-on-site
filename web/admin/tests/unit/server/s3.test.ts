import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
	sendMock: vi.fn(),
	getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: class {
		send = sendMock;
	},
	PutObjectCommand: class {
		constructor(public input: Record<string, unknown>) {}
	},
	DeleteObjectCommand: class {
		constructor(public input: Record<string, unknown>) {}
	},
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
	getSignedUrl: getSignedUrlMock,
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: () => unknown) => () => fn(),
	}),
}));

async function loadS3() {
	vi.resetModules();
	return import("~/server/s3");
}

describe("s3 image helpers", () => {
	beforeEach(() => {
		sendMock.mockReset().mockResolvedValue({});
		getSignedUrlMock
			.mockReset()
			.mockResolvedValue("https://signed.example.com");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("when no custom endpoint is configured (AWS)", () => {
		it("builds the standard public URL for author images", async () => {
			vi.stubEnv("S3_ENDPOINT", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			vi.stubEnv("S3_REGION", "us-east-1");
			const { getAuthorImageUrl } = await loadS3();

			expect(getAuthorImageUrl(7)).toBe(
				"https://bucket-x.s3.us-east-1.amazonaws.com/authors/high-res/7.jpg",
			);
		});

		it("uploads a jpeg and returns the AWS public URL", async () => {
			vi.stubEnv("S3_ENDPOINT", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { uploadImage } = await loadS3();

			const url = await uploadImage(Buffer.from("img"), "image/png", 3);

			expect(sendMock).toHaveBeenCalledTimes(1);
			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			expect(command.input).toMatchObject({
				Bucket: "bucket-x",
				Key: "authors/high-res/3.jpg",
				ContentType: "image/jpeg",
			});
			expect(url).toContain("authors/high-res/3.jpg");
		});

		it("deletes an image by deriving the key from an AWS URL", async () => {
			vi.stubEnv("S3_ENDPOINT", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { deleteImage } = await loadS3();

			await deleteImage(
				"https://bucket-x.s3.us-east-1.amazonaws.com/authors/high-res/5.jpg",
			);

			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			expect(command.input).toEqual({
				Bucket: "bucket-x",
				Key: "authors/high-res/5.jpg",
			});
		});
	});

	describe("when a custom endpoint is configured (local S3)", () => {
		it("builds path-style public URLs", async () => {
			vi.stubEnv("S3_ENDPOINT", "http://localhost:4566");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { getAuthorImageUrl } = await loadS3();

			expect(getAuthorImageUrl(7)).toBe(
				"http://localhost:4566/bucket-x/authors/high-res/7.jpg",
			);
		});

		it("deletes an image by skipping the bucket segment of a path-style URL", async () => {
			vi.stubEnv("S3_ENDPOINT", "http://localhost:4566");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { deleteImage } = await loadS3();

			await deleteImage(
				"http://localhost:4566/bucket-x/authors/high-res/5.jpg",
			);

			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			expect(command.input).toEqual({
				Bucket: "bucket-x",
				Key: "authors/high-res/5.jpg",
			});
		});
	});

	describe("presigned uploads", () => {
		it("returns the signed upload URL and the public URL", async () => {
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { getPresignedUploadUrl } = await loadS3();

			await expect(getPresignedUploadUrl(11)).resolves.toEqual({
				uploadUrl: "https://signed.example.com",
				publicUrl: expect.stringContaining("authors/high-res/11.jpg"),
			});
			expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
			const [, command, options] = getSignedUrlMock.mock.calls[0] as [
				unknown,
				{ input: Record<string, unknown> },
				{ expiresIn: number },
			];
			expect(command.input.Key).toBe("authors/high-res/11.jpg");
			expect(options).toEqual({ expiresIn: 3600 });
		});
	});

	describe("uploadAuthorImage server function", () => {
		it("decodes the base64 payload, uploads it and returns the derived URL", async () => {
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { uploadAuthorImage } = await loadS3();

			const result = await uploadAuthorImage({
				data: {
					authorId: 4,
					fileName: "pic.png",
					contentType: "image/png",
					base64Data: Buffer.from("hello").toString("base64"),
				},
			});

			expect(sendMock).toHaveBeenCalledTimes(1);
			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			expect(command.input.Key).toBe("authors/high-res/4.jpg");
			expect((command.input.Body as Buffer).toString()).toBe("hello");
			expect(result.imageUrl).toContain("authors/high-res/4.jpg");
		});
	});
});
