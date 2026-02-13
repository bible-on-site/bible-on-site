jest.mock("next/navigation", () => ({
	redirect: jest.fn(),
	RedirectType: { replace: "replace" },
}));

jest.mock("../../../src/data/perek-dto", () => ({
	getTodaysPerekId: jest.fn().mockReturnValue(42),
}));

import { redirect } from "next/navigation";
import TodaysPerek from "../../../src/app/929/page";

const mockRedirect = redirect as jest.MockedFunction<typeof redirect>;

describe("929/page (TodaysPerek)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("redirects with string search param", async () => {
		await TodaysPerek({
			searchParams: Promise.resolve({ book: "true" }),
		});

		expect(mockRedirect).toHaveBeenCalledWith("/929/42?book=true", "replace");
	});

	it("redirects with array search params", async () => {
		await TodaysPerek({
			searchParams: Promise.resolve({ tag: ["a", "b"] }),
		});

		expect(mockRedirect).toHaveBeenCalledWith("/929/42?tag=a&tag=b", "replace");
	});

	it("skips undefined values in search params", async () => {
		await TodaysPerek({
			searchParams: Promise.resolve({ keep: "yes", drop: undefined }),
		});

		expect(mockRedirect).toHaveBeenCalledWith("/929/42?keep=yes", "replace");
	});

	it("redirects without query string when no params", async () => {
		await TodaysPerek({
			searchParams: Promise.resolve({}),
		});

		expect(mockRedirect).toHaveBeenCalledWith("/929/42", "replace");
	});
});
