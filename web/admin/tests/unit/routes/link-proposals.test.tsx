import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolve: vi.fn(),
	redirect: vi.fn((value: unknown) => value),
}));
vi.mock("~/server/article-link-proposals", () => ({
	getArticleLinkContribution: mocks.resolve,
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: unknown) => config,
	redirect: mocks.redirect,
}));

import { Route } from "~/routes/link-proposals";

const route = Route as unknown as {
	validateSearch: (value: Record<string, unknown>) => {
		articleId: number | undefined;
		id?: string;
	};
	beforeLoad: (value: { search: Record<string, unknown> }) => Promise<unknown>;
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolve.mockResolvedValue(null);
});
it("redirects the legacy queue into the ordinary home PR tab", async () => {
	await expect(
		route.beforeLoad({ search: { articleId: undefined } }),
	).rejects.toEqual({ to: "/", search: { tab: "prs" }, replace: true });
});
it("preserves a selected legacy article/proposal by resolving its stable ordinary PR", async () => {
	mocks.resolve.mockResolvedValue("ordinary-pr");
	const search = route.validateSearch({ articleId: "123", id: "legacy-id" });
	expect(search).toEqual({ articleId: 123, id: "legacy-id" });
	await expect(route.beforeLoad({ search })).rejects.toEqual({
		to: "/",
		search: { tab: "prs", id: "ordinary-pr" },
		replace: true,
	});
	expect(mocks.resolve).toHaveBeenCalledWith({ data: search });
});
it.each([0, -1, "abc", 1.5])(
	"discards invalid legacy article filter %s",
	(value) => {
		expect(
			route.validateSearch({ articleId: value }).articleId,
		).toBeUndefined();
	},
);
it("propagates lookup/storage failures without redirecting away from missing evidence", async () => {
	mocks.resolve.mockRejectedValue(new Error("Database unavailable"));
	await expect(
		route.beforeLoad({ search: { articleId: 123 } }),
	).rejects.toThrow("Database unavailable");
	expect(mocks.redirect).not.toHaveBeenCalled();
});
