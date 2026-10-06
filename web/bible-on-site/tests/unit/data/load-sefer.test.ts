import type { SefarimItem } from "@/data/db/tanah-view-types";

const originalFetch = global.fetch;
let loadSefer: typeof import("@/data/load-sefer").loadSefer;
let mockFetch: jest.Mock;

beforeEach(() => {
	jest.resetModules();
	loadSefer = require("@/data/load-sefer").loadSefer;
	mockFetch = jest
		.fn()
		.mockImplementation(async (file: string) => ({
			ok: true,
			json: async () => ({ name: file }),
		}));
	global.fetch = mockFetch;
});
afterAll(() => {
	global.fetch = originalFetch;
});

it("shares a request for the same immutable book", async () => {
	const first = loadSefer("/book.json");
	const second = loadSefer("/book.json");
	expect(second).toBe(first);
	expect(await first).toEqual({ name: "/book.json" });
	expect(mockFetch).toHaveBeenCalledTimes(1);
	expect(mockFetch).toHaveBeenCalledWith("/book.json", {
		cache: "no-cache",
	});
});
it("retries a failed request rather than caching its rejection", async () => {
	mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
	await expect(loadSefer("/book.json")).rejects.toThrow("503");
	await expect(loadSefer("/book.json")).resolves.toMatchObject({
		name: "/book.json",
	});
	expect(mockFetch).toHaveBeenCalledTimes(2);
});
it("evicts the least recently used book after four entries", async () => {
	for (const file of ["/1", "/2", "/3", "/4"]) await loadSefer(file);
	await loadSefer("/1");
	await loadSefer("/5");
	await loadSefer("/1");
	expect(mockFetch).toHaveBeenCalledTimes(5);
	await loadSefer("/2");
	expect(mockFetch).toHaveBeenCalledTimes(6);
});
it("does not remove a newer request when an evicted request later fails", async () => {
	let fail!: (error: Error) => void;
	mockFetch.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				fail = reject;
			}),
	);
	const old = loadSefer("/1");
	const rejection = expect(old).rejects.toThrow("old request");
	await Promise.resolve();
	for (const file of ["/2", "/3", "/4", "/5"]) await loadSefer(file);
	const replacement = loadSefer("/1");
	await replacement;
	fail(new Error("old request"));
	await rejection;
	expect(loadSefer("/1")).toBe(replacement as Promise<SefarimItem>);
});
