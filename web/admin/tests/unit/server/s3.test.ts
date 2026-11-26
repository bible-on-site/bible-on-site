import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, getSignedUrlMock, clientConfigMock } = vi.hoisted(() => ({
	sendMock: vi.fn(),
	getSignedUrlMock: vi.fn(),
	clientConfigMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: class {
		constructor(config: Record<string, unknown>) {
			clientConfigMock(config);
		}
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
		clientConfigMock.mockReset();
		sendMock.mockReset().mockResolvedValue({});
		getSignedUrlMock
			.mockReset()
			.mockResolvedValue("https://signed.example.com");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		["http://localhost:4566", "il-central-1", "eu-west-1", "us-east-1"],
		["", "il-central-1", "eu-west-1", "il-central-1"],
		["", "", "eu-west-1", "eu-west-1"],
		["", "", "", "il-central-1"],
	])(
		"uses the endpoint's region for signing and URLs (%s, %s, %s)",
		async (endpoint, region, awsRegion, expected) => {
			vi.stubEnv("S3_ENDPOINT", endpoint);
			vi.stubEnv("S3_REGION", region);
			vi.stubEnv("AWS_REGION", awsRegion);
			vi.stubEnv("ASSETS_BASE_URL", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { getAuthorImageUrl, getPresignedUploadUrl } = await loadS3();
			expect(clientConfigMock).toHaveBeenCalledWith(
				expect.objectContaining({ region: expected }),
			);
			const expectedUrl = endpoint
				? `${endpoint}/bucket-x/authors/high-res/7.jpg`
				: `https://bucket-x.s3.${expected}.amazonaws.com/authors/high-res/7.jpg`;
			expect(getAuthorImageUrl(7)).toBe(expectedUrl);
			expect((await getPresignedUploadUrl(7)).publicUrl).toBe(expectedUrl);
		},
	);

	it("falls back to the default bucket when S3_BUCKET is unset", async () => {
		vi.stubEnv("S3_ENDPOINT", "");
		vi.stubEnv("S3_REGION", "il-central-1");
		vi.stubEnv("ASSETS_BASE_URL", "");
		vi.stubEnv("S3_BUCKET", "");
		const { getAuthorImageUrl, uploadImage } = await loadS3();

		expect(getAuthorImageUrl(7)).toBe(
			"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/authors/high-res/7.jpg",
		);
		await uploadImage(Buffer.from("img"), "image/png", 3);
		const command = sendMock.mock.calls[0]?.[0] as {
			input: Record<string, unknown>;
		};
		expect(command.input.Bucket).toBe("bible-on-site-assets");
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

	describe("when a CDN base URL is configured", () => {
		it("builds CDN public URLs without the bucket segment", async () => {
			vi.stubEnv("ASSETS_BASE_URL", "https://assets.xn--febl3a.co.il/");
			vi.stubEnv("S3_ENDPOINT", "http://localhost:4566");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { getAuthorImageUrl, getPresignedUploadUrl } = await loadS3();

			expect(getAuthorImageUrl(7)).toBe(
				"https://assets.xn--febl3a.co.il/authors/high-res/7.jpg",
			);
			const { publicUrl } = await getPresignedUploadUrl(8);
			expect(publicUrl).toBe(
				"https://assets.xn--febl3a.co.il/authors/high-res/8.jpg",
			);
		});

		it("deletes an image by deriving the key from a CDN URL", async () => {
			vi.stubEnv("ASSETS_BASE_URL", "https://assets.xn--febl3a.co.il");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { deleteImage } = await loadS3();

			await deleteImage(
				"https://assets.xn--febl3a.co.il/authors/high-res/5.jpg",
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

	describe("uploadPediaImage", () => {
		it("rejects an unsupported content type before touching S3", async () => {
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { uploadPediaImage } = await loadS3();

			await expect(
				uploadPediaImage(Buffer.from("x"), "image/gif"),
			).rejects.toThrow("Unsupported image content type: image/gif");
			expect(sendMock).not.toHaveBeenCalled();
		});

		it.each([
			["image/jpeg", "jpg"],
			["image/png", "png"],
			["image/webp", "webp"],
		])("uploads a %s image under pedia/images", async (contentType, ext) => {
			vi.stubEnv("S3_ENDPOINT", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const { uploadPediaImage } = await loadS3();

			const url = await uploadPediaImage(Buffer.from("img"), contentType);

			expect(sendMock).toHaveBeenCalledTimes(1);
			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			expect(command.input).toMatchObject({
				Bucket: "bucket-x",
				ContentType: contentType,
			});
			const key = command.input.Key as string;
			const keyMatch = key.match(/^pedia\/images\/([^/]+)\.([^./]+)$/);
			const stem = keyMatch?.[1];
			if (!stem) {
				throw new Error(`upload key must keep a nonempty filename stem: ${key}`);
			}
			expect(keyMatch?.[2]).toBe(ext);
			expect(url).toContain(`pedia/images/${stem}.${ext}`);
		});
	});

	describe("chunked pedia image uploads", () => {
		const CHUNK = 384 * 1024;

		async function loadUploads() {
			vi.stubEnv("S3_ENDPOINT", "");
			vi.stubEnv("S3_BUCKET", "bucket-x");
			const mod = await loadS3();
			mod.__resetPediaImageUploadsForTests();
			return mod;
		}

		it("rejects an unsupported content type", async () => {
			const { createPediaImageUpload } = await loadUploads();
			await expect(
				createPediaImageUpload({
					data: { contentType: "image/gif", totalSize: 10 },
				}),
			).rejects.toThrow("Unsupported image content type");
		});

		it.each([[0], [-5], [9 * 1024 * 1024], [1.5]])(
			"rejects an out-of-range total size (%s)",
			async (totalSize) => {
				const { createPediaImageUpload } = await loadUploads();
				await expect(
					createPediaImageUpload({
						data: { contentType: "image/png", totalSize },
					}),
				).rejects.toThrow("Image size must be between 1 byte and 8 MiB");
			},
		);

		it("rejects chunks for an unknown upload id", async () => {
			const { uploadPediaImageChunk } = await loadUploads();
			await expect(
				uploadPediaImageChunk({
					data: {
						uploadId: "missing",
						chunkIndex: 0,
						base64Data: "",
					},
				}),
			).rejects.toThrow("Upload expired or was not found");
		});

		it("assembles received chunks and publishes the image", async () => {
			const { createPediaImageUpload, uploadPediaImageChunk } =
				await loadUploads();
			const totalSize = CHUNK + 5;
			const created = await createPediaImageUpload({
				data: { contentType: "image/jpeg", totalSize },
			});
			expect(created).toEqual({
				uploadId: expect.any(String),
				chunkBytes: CHUNK,
				chunkCount: 2,
			});

			const first = Buffer.alloc(CHUNK, 1);
			const second = Buffer.alloc(5, 2);
			const partial = await uploadPediaImageChunk({
				data: {
					uploadId: created.uploadId,
					chunkIndex: 0,
					base64Data: first.toString("base64"),
				},
			});
			expect(partial).toEqual({
				complete: false,
				receivedBytes: CHUNK,
			});

			const done = await uploadPediaImageChunk({
				data: {
					uploadId: created.uploadId,
					chunkIndex: 1,
					base64Data: second.toString("base64"),
				},
			});
			expect(done.complete).toBe(true);
			expect(done.receivedBytes).toBe(totalSize);
			expect(done.imageUrl).toContain("pedia/images/");
			expect(done.imageUrl).toContain(".jpg");

			const command = sendMock.mock.calls[0]?.[0] as {
				input: Record<string, unknown>;
			};
			const expectedBody = Buffer.concat([first, second]);
			expect((command.input.Body as Buffer).equals(expectedBody)).toBe(true);
		});

		it("rejects an invalid chunk index", async () => {
			const { createPediaImageUpload, uploadPediaImageChunk } =
				await loadUploads();
			const created = await createPediaImageUpload({
				data: { contentType: "image/png", totalSize: 10 },
			});
			await expect(
				uploadPediaImageChunk({
					data: {
						uploadId: created.uploadId,
						chunkIndex: 5,
						base64Data: Buffer.alloc(10).toString("base64"),
					},
				}),
			).rejects.toThrow("Invalid image upload chunk");
		});

		it("rejects a chunk that was already received", async () => {
			const { createPediaImageUpload, uploadPediaImageChunk } =
				await loadUploads();
			const created = await createPediaImageUpload({
				data: { contentType: "image/png", totalSize: CHUNK + 10 },
			});
			const base64Data = Buffer.alloc(CHUNK, 1).toString("base64");
			await uploadPediaImageChunk({
				data: { uploadId: created.uploadId, chunkIndex: 0, base64Data },
			});
			await expect(
				uploadPediaImageChunk({
					data: {
						uploadId: created.uploadId,
						chunkIndex: 0,
						base64Data,
					},
				}),
			).rejects.toThrow("Image upload chunk was already received");
		});

		it("rejects a chunk whose size does not match the expected span", async () => {
			const { createPediaImageUpload, uploadPediaImageChunk } =
				await loadUploads();
			const created = await createPediaImageUpload({
				data: { contentType: "image/png", totalSize: 10 },
			});
			await expect(
				uploadPediaImageChunk({
					data: {
						uploadId: created.uploadId,
						chunkIndex: 0,
						base64Data: Buffer.alloc(9).toString("base64"),
					},
				}),
			).rejects.toThrow("Image upload chunk size mismatch");
		});

		it("rejects chunks once the upload has expired", async () => {
			const { createPediaImageUpload, uploadPediaImageChunk } =
				await loadUploads();
			const created = await createPediaImageUpload({
				data: { contentType: "image/png", totalSize: 10 },
			});
			vi.useFakeTimers();
			try {
				vi.setSystemTime(Date.now() + 11 * 60 * 1000);
				await expect(
					uploadPediaImageChunk({
						data: {
							uploadId: created.uploadId,
							chunkIndex: 0,
							base64Data: Buffer.alloc(10).toString("base64"),
						},
					}),
				).rejects.toThrow("Upload expired or was not found");
			} finally {
				vi.useRealTimers();
			}
		});

		it("cleans expired reservations and evicts the oldest after the cap is exceeded", async () => {
			vi.useFakeTimers();
			try {
				const { createPediaImageUpload, uploadPediaImageChunk } =
					await loadUploads();
				vi.setSystemTime(1_000_000);
				const stale = await createPediaImageUpload({
					data: { contentType: "image/png", totalSize: 10 },
				});
				vi.setSystemTime(1_000_000 + 11 * 60 * 1000);
				// This create sweeps the expired reservation before capacity math.
				const oldest = await createPediaImageUpload({
					data: { contentType: "image/png", totalSize: 10 },
				});
				const secondOldest = await createPediaImageUpload({
					data: { contentType: "image/png", totalSize: 10 },
				});
				// oldest + secondOldest + these fourteen reach the live-upload cap.
				for (let i = 0; i < 14; i++) {
					await createPediaImageUpload({
						data: { contentType: "image/png", totalSize: 10 },
					});
				}
				// The seventeenth live create crosses the cap and must evict only
				// the insertion-oldest reservation before inserting the new one.
				await createPediaImageUpload({
					data: { contentType: "image/png", totalSize: 10 },
				});

				const secondStillLive = await uploadPediaImageChunk({
					data: {
						uploadId: secondOldest.uploadId,
						chunkIndex: 0,
						base64Data: Buffer.alloc(10).toString("base64"),
					},
				});
				expect(secondStillLive.complete).toBe(true);
				for (const uploadId of [stale.uploadId, oldest.uploadId]) {
					await expect(
						uploadPediaImageChunk({
							data: {
								uploadId,
								chunkIndex: 0,
								base64Data: Buffer.alloc(10).toString("base64"),
							},
						}),
					).rejects.toThrow("Upload expired or was not found");
				}
			} finally {
				vi.useRealTimers();
			}
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
