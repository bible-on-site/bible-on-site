import { render, screen, within } from "@testing-library/react";
import TanahpediaLandingPage from "@/app/pedia/page";
import {
	CATEGORY_LABELS,
	getCategoryCounts,
	getRecentEntries,
	getTodayInTanahEvents,
} from "@/lib/tanahpedia/service";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import { HebrewDate } from "@/util/hebdates-util";

jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("@/lib/tanahpedia/service", () => ({
	...jest.requireActual("@/lib/tanahpedia/service"),
	getCategoryCounts: jest.fn(),
	getRecentEntries: jest.fn(),
	getTodayInTanahEvents: jest.fn(),
}));

const counts = Object.fromEntries(
	Object.keys(CATEGORY_LABELS).map((key) => [key, 3]),
) as Record<CategoryKey, number>;

beforeEach(() => {
	jest.useFakeTimers().setSystemTime(new Date("2026-10-02T12:00:00+03:00"));
	jest.mocked(getCategoryCounts).mockResolvedValue(counts);
	jest.mocked(getRecentEntries).mockResolvedValue([]);
	jest.mocked(getTodayInTanahEvents).mockResolvedValue([]);
});

afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
});

test("shows category counts without empty event or recent-entry sections", async () => {
	render(await TanahpediaLandingPage());
	expect(screen.getByRole("heading", { name: "תנכפדיה" })).toBeVisible();
	expect(screen.getAllByText("3 ערכים").length).toBeGreaterThan(0);
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.queryByRole("heading", { name: 'היום בתנ"ך' })).toBeNull();
	expect(screen.queryByRole("heading", { name: "עודכנו לאחרונה" })).toBeNull();
	expect(
		screen.getByRole("link", { name: "חזרה לעמוד הראשי" }),
	).toHaveAttribute("href", "/");
});

test("uses today's Hebrew date and renders linked and unlinked events and recent entries", async () => {
	const today = HebrewDate.fromGregorian(new Date());
	jest.mocked(getTodayInTanahEvents).mockResolvedValue([
		{
			entityId: "1",
			entityName: "אירוע ראשון",
			entryUniqueName: "אירוע-ראשון",
			entryTitle: "כותרת האירוע",
			startDate: null,
		},
		{
			entityId: "2",
			entityName: "אירוע שני",
			entryUniqueName: "אירוע-שני",
			entryTitle: null,
			startDate: null,
		},
		{
			entityId: "3",
			entityName: "אירוע ללא ערך",
			entryUniqueName: null,
			entryTitle: null,
			startDate: null,
		},
	]);
	jest.mocked(getRecentEntries).mockResolvedValue([
		{
			id: "recent",
			title: "ערך חדש",
			uniqueName: "ערך-חדש",
			content: "",
			createdAt: "2026-10-01",
			updatedAt: "2026-10-02",
		},
	]);
	render(await TanahpediaLandingPage());
	expect(getTodayInTanahEvents).toHaveBeenCalledWith(
		today.getUniformMonth(),
		today.day,
	);
	expect(screen.getByText(today.toTraditionalHebrewString())).toBeVisible();
	expect(getRecentEntries).toHaveBeenCalledWith(8);
	expect(screen.getByRole("link", { name: "כותרת האירוע" })).toHaveAttribute(
		"href",
		`/pedia/${encodeURIComponent("אירוע-ראשון")}`,
	);
	expect(screen.getByRole("link", { name: "אירוע שני" })).toHaveAttribute(
		"href",
		`/pedia/${encodeURIComponent("אירוע-שני")}`,
	);
	expect(screen.getByText("אירוע ללא ערך").tagName).toBe("STRONG");
	expect(screen.queryByRole("link", { name: "אירוע ללא ערך" })).toBeNull();
	expect(screen.getByRole("link", { name: "ערך חדש" })).toHaveAttribute(
		"href",
		`/pedia/${encodeURIComponent("ערך-חדש")}`,
	);
});

test.each([
	new Error("private database failure"),
	"private connection failure",
])(
	"shows a safe fallback when a database request fails: %s",
	async (failure) => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		jest.mocked(getCategoryCounts).mockRejectedValueOnce(failure);
		render(await TanahpediaLandingPage());
		const alert = screen.getByRole("alert");
		expect(within(alert).getByText("התוכן אינו זמין כרגע")).toBeVisible();
		expect(alert).toHaveTextContent("נסו לרענן את העמוד מאוחר יותר");
		expect(alert).not.toHaveTextContent("private");
		expect(screen.getAllByText("0 ערכים").length).toBeGreaterThan(0);
		expect(
			screen.queryByRole("heading", { name: "עודכנו לאחרונה" }),
		).toBeNull();
	},
);

test("logs the original development failure and offers diagnostic details", async () => {
	jest.replaceProperty(process.env, "NODE_ENV", "development");
	const failure = new Error("MySQL connection refused");
	const log = jest.spyOn(console, "error").mockImplementation(() => {});
	jest.mocked(getRecentEntries).mockRejectedValueOnce(failure);
	render(await TanahpediaLandingPage());
	expect(log).toHaveBeenCalledWith(
		"[tanahpedia] landing DB load failed:",
		failure,
	);
	expect(screen.getByRole("alert")).toHaveTextContent(failure.message);
	expect(screen.getByRole("alert")).toHaveTextContent("npm run dev");
});
