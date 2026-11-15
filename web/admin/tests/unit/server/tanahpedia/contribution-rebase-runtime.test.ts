import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("~/server/tanahpedia/contribution-rebases.server", () => ({
	resumePendingContributionRebases: mocks.resume,
}));
beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	mocks.resume.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
it("starts one drain and resumes a failed durable refresh on the next scheduled pass", async () => {
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.resume.mockRejectedValueOnce(new Error("offline"));
	const { ensureContributionRebasesStarted } = await import(
		"~/server/tanahpedia/contribution-rebase-runtime.server"
	);
	ensureContributionRebasesStarted();
	ensureContributionRebasesStarted();
	await vi.advanceTimersByTimeAsync(0);
	expect(mocks.resume).toHaveBeenCalledTimes(1);
	expect(logged).toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(30000);
	expect(mocks.resume).toHaveBeenCalledTimes(2);
});
it("does not overlap drains while a previous pass is still running", async () => {
	let release: () => void = () => {};
	mocks.resume.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const { ensureContributionRebasesStarted } = await import(
		"~/server/tanahpedia/contribution-rebase-runtime.server"
	);
	ensureContributionRebasesStarted();
	await vi.advanceTimersByTimeAsync(0);
	await vi.advanceTimersByTimeAsync(30000);
	expect(mocks.resume).toHaveBeenCalledTimes(1);
	release();
	await vi.advanceTimersByTimeAsync(0);
});
