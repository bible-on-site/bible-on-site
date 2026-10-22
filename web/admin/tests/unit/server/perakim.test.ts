import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	query: queryMock,
	queryOne: queryOneMock,
}));

import { getPerakim, getPerek } from "~/server/perakim";

describe("perakim api", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("lists all perakim", async () => {
		queryMock.mockResolvedValue([{ id: 1, perek: 3 }]);

		await expect(getPerakim()).resolves.toEqual([{ id: 1, perek: 3 }]);
		expect(queryMock.mock.calls[0]?.[0]).toContain("FROM tanah_perek_view");
	});

	it("returns a perek by id", async () => {
		queryOneMock.mockResolvedValue({ id: 2, perek: 5 });

		await expect(getPerek({ data: 2 })).resolves.toEqual({
			id: 2,
			perek: 5,
		});
		expect(queryOneMock.mock.calls[0]?.[1]).toEqual([2]);
	});

	it("throws when the perek does not exist", async () => {
		queryOneMock.mockResolvedValue(null);

		await expect(getPerek({ data: 999 })).rejects.toThrow("Perek not found");
	});
});
