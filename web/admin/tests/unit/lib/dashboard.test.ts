import { describe, expect, it } from "vitest";
import { dashboardStats } from "~/lib/dashboard";

describe("dashboardStats", () => {
	it("maps every count onto a card that links to its management page", () => {
		const stats = dashboardStats({
			articles: 12,
			rabbis: 5,
			activeDedications: 3,
			moadim: 17,
			todayHebrew: "כא בטבת",
		});
		expect(stats).toEqual([
			{ to: "/articles", label: "מאמרים", value: "12" },
			{ to: "/rabbis", label: "רבנים", value: "5" },
			{ to: "/dedications", label: "הקדשות פעילות", value: "3" },
			{ to: "/moadim", label: "מועדים", value: "17" },
			{ to: "/bulletins", label: "עלון יומי", value: "כא בטבת" },
		]);
	});

	it("renders missing counts as a dash while keeping the link", () => {
		const stats = dashboardStats({
			articles: undefined,
			rabbis: null,
			activeDedications: 0,
			moadim: undefined,
			todayHebrew: "",
		});
		expect(stats[0].value).toBe("-");
		expect(stats[1].value).toBe("-");
		expect(stats[2].value).toBe("0");
		for (const stat of stats) {
			expect(stat.to).toMatch(/^\/[a-z]+$/);
		}
	});
});
