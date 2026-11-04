import { afterEach, describe, expect, it, vi } from "vitest";
import { runOutboxSweep } from "~/server/outbox-deadline.server";
import { deferred } from "../../util/deferred";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("whole-sweep deadline", () => {
	it("returns at the existing 15-second deadline while a DB wait never resolves", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
			const deadline = new AbortController();
			setTimeout(() => deadline.abort(), milliseconds);
			return deadline.signal;
		});
		const operation = vi.fn(() => new Promise<void>(() => {}));
		let finished = false;
		const pending = runOutboxSweep(undefined, operation);
		const stopped = expect(pending).rejects.toThrow("sweep stopped");
		void pending.then(
			() => {
				finished = true;
			},
			() => {
				finished = true;
			},
		);
		await vi.advanceTimersByTimeAsync(14_999);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await stopped;
		expect(finished).toBe(true);
		expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(15_000);
		expect(operation).toHaveBeenCalledOnce();
	});
	it.each(["resolve", "reject"])(
		"observes a late %s after shutdown without starting another operation",
		async (settlement) => {
			const shutdown = new AbortController();
			const gate = deferred<void>();
			const operation = vi.fn(() => gate.promise);
			const pending = runOutboxSweep(shutdown.signal, operation);
			const stopped = expect(pending).rejects.toThrow("sweep stopped");
			await Promise.resolve();
			shutdown.abort();
			await stopped;
			if (settlement === "resolve") gate.resolve();
			else gate.reject(new Error("late DB error"));
			await Promise.resolve();
			expect(operation).toHaveBeenCalledOnce();
		},
	);
	it("starts nothing when already stopped and observes ordinary operation failure", async () => {
		const shutdown = new AbortController();
		shutdown.abort();
		const operation = vi.fn(async () => {});
		await expect(runOutboxSweep(shutdown.signal, operation)).rejects.toThrow();
		expect(operation).not.toHaveBeenCalled();
		await expect(
			runOutboxSweep(undefined, async () => {
				throw new Error("fixture failure");
			}),
		).rejects.toThrow("fixture failure");
	});
	it("resolves a completed operation and removes its abort listener", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const remove = vi.spyOn(deadline.signal, "removeEventListener");
		await expect(
			runOutboxSweep(undefined, async () => {}),
		).resolves.toBeUndefined();
		expect(remove).toHaveBeenCalledOnce();
		deadline.abort();
	});
});
