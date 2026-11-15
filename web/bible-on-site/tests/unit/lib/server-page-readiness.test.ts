/** @jest-environment node */

const validPage = () =>
	new Response("<!DOCTYPE html><html><body>ready</body></html>", {
		headers: { "content-type": "text/html; charset=utf-8" },
	});

let mockFetch: jest.SpyInstance;
beforeEach(() => {
	jest.resetModules();
	jest.replaceProperty(process, "env", {
		...process.env,
		NODE_ENV: "production",
	});
	delete process.env.PORT;
	mockFetch = jest
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => validPage());
});
afterEach(() => jest.restoreAllMocks());

test("development and unit environments do not require a listening production server", async () => {
	jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "test" });
	const { warmServerPages } = await import("@/lib/server-page-readiness");
	await warmServerPages();
	expect(mockFetch).not.toHaveBeenCalled();
});

test.each([undefined, "43123"])(
	"prepares every public renderer once on loopback, port %s",
	async (port) => {
		if (port) process.env.PORT = port;
		const { warmServerPages } = await import("@/lib/server-page-readiness");
		await Promise.all([warmServerPages(), warmServerPages()]);
		await warmServerPages();
		expect(mockFetch).toHaveBeenCalledTimes(5);
		expect(mockFetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/929/1",
			"/929/authors",
			"/pedia",
			"/%D7%9C%D7%95%D7%97",
			"/search",
		]);
		for (const [url, options] of mockFetch.mock.calls) {
			expect(new URL(url).origin).toBe(`http://127.0.0.1:${port ?? 3000}`);
			expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
			expect(options.signal).toBeInstanceOf(AbortSignal);
		}
	},
);

test.each(["0", "65536", "1.5", "not-a-port"])(
	"rejects invalid server port %s",
	async (port) => {
		process.env.PORT = port;
		const { warmServerPages } = await import("@/lib/server-page-readiness");
		await expect(warmServerPages()).rejects.toThrow("Invalid website port");
		expect(mockFetch).not.toHaveBeenCalled();
	},
);

test("waits for every body and shares in-flight preparation", async () => {
	let finish!: (value: string) => void;
	const text = jest.fn(
		() =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
	);
	mockFetch.mockResolvedValueOnce({
		ok: true,
		headers: new Headers({ "content-type": "text/html" }),
		text,
	});
	const { warmServerPages } = await import("@/lib/server-page-readiness");
	let admitted = false;
	const first = warmServerPages().then(() => {
		admitted = true;
	});
	const second = warmServerPages();
	await Promise.resolve();
	expect(text).toHaveBeenCalledTimes(1);
	expect(admitted).toBe(false);
	expect(mockFetch).toHaveBeenCalledTimes(5);
	finish("<html></html>");
	await Promise.all([first, second]);
	expect(admitted).toBe(true);
});

test.each([
	() =>
		new Response("<html>error</html>", {
			status: 503,
			headers: { "content-type": "text/html" },
		}),
	() =>
		new Response("<html></html>", {
			headers: { "content-type": "application/json" },
		}),
	() => new Response("<html></html>"),
	() =>
		new Response("incomplete", { headers: { "content-type": "text/html" } }),
])(
	"rejects unsuccessful or incomplete page responses without caching readiness",
	async (response) => {
		mockFetch.mockResolvedValueOnce(response());
		const { warmServerPages } = await import("@/lib/server-page-readiness");
		await expect(warmServerPages()).rejects.toThrow(
			"Page preparation failed: /929/1",
		);
		await warmServerPages();
		expect(mockFetch).toHaveBeenCalledTimes(10);
	},
);

test("settles other requests after transport failure before the next health probe can prepare again", async () => {
	let finish!: (value: Response) => void;
	mockFetch.mockRejectedValueOnce(new Error("connection closed"));
	mockFetch.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	const { warmServerPages } = await import("@/lib/server-page-readiness");
	const first = warmServerPages();
	const rejected = expect(first).rejects.toThrow("connection closed");
	await Promise.resolve();
	const concurrent = expect(warmServerPages()).rejects.toThrow(
		"connection closed",
	);
	expect(mockFetch).toHaveBeenCalledTimes(5);
	finish(validPage());
	await Promise.all([rejected, concurrent]);
	await warmServerPages();
	expect(mockFetch).toHaveBeenCalledTimes(10);
});

test("a stalled response body expires at the existing two-second request deadline", async () => {
	mockFetch.mockImplementationOnce(async (_url, options) => ({
		ok: true,
		headers: new Headers({ "content-type": "text/html" }),
		text: () =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener(
					"abort",
					() => reject(options.signal.reason),
					{ once: true },
				);
			}),
	}));
	const { warmServerPages } = await import("@/lib/server-page-readiness");
	await expect(warmServerPages()).rejects.toThrow(
		"The operation was aborted due to timeout",
	);
	await warmServerPages();
	expect(mockFetch).toHaveBeenCalledTimes(10);
});
