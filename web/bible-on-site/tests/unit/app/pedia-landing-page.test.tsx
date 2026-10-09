import { render, screen, within } from "@testing-library/react";
import TanahpediaLandingPage from "@/app/pedia/page";
import {
	CATEGORY_LABELS,
	getCategoryCounts,
	getRecentEntries,
	getTodayInTanahEntities,
} from "@/lib/tanahpedia/service";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("@/lib/tanahpedia/service", () => ({
	...jest.requireActual("@/lib/tanahpedia/service"),
	getCategoryCounts: jest.fn(),
	getRecentEntries: jest.fn(),
	getTodayInTanahEntities: jest.fn(),
}));

const counts = Object.fromEntries(
	Object.keys(CATEGORY_LABELS).map((key) => [key, 3]),
) as Record<CategoryKey, number>;

beforeEach(() => {
	jest.useFakeTimers().setSystemTime(new Date("2026-10-02T12:00:00+03:00"));
	jest.mocked(getCategoryCounts).mockResolvedValue(counts);
	jest.mocked(getRecentEntries).mockResolvedValue([]);
	jest.mocked(getTodayInTanahEntities).mockResolvedValue([]);
});

afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
});

test("shows category counts without empty anniversary or recent-entry sections", async () => {
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

test("mutes zero-entry categories with a coming-soon label but keeps them linked", async () => {
	jest.mocked(getCategoryCounts).mockResolvedValue({
		...counts,
		OBJECT: 0,
		ASTRONOMICAL_OBJECT: 0,
	});
	render(await TanahpediaLandingPage());
	const emptyCard = screen.getByRole("link", { name: /^חפצים/ });
	expect(emptyCard).toHaveTextContent("בקרוב");
	expect(emptyCard).not.toHaveTextContent("0 ערכים");
	expect(emptyCard).toHaveClass("categoryCardEmpty");
	expect(emptyCard).toHaveAttribute("href", "/pedia/חפצים");
	const emptySub = screen.getByRole("link", { name: /^גרמי שמיים/ });
	expect(emptySub).toHaveTextContent("בקרוב");
	expect(emptySub).toHaveClass("subcategoryCardEmpty");
	const populatedCard = screen.getByRole("link", { name: /^אישים/ });
	expect(populatedCard).toHaveTextContent("3 ערכים");
	expect(populatedCard).not.toHaveClass("categoryCardEmpty");
	expect(screen.queryByText("0 ערכים")).toBeNull();
});

test("uses today's Hebrew date and renders events, sayings, people, and recent entries", async () => {
	const today = constructTsetAwareHDate(new Date());
	jest.mocked(getTodayInTanahEntities).mockResolvedValue([
		{
			entityId: "1",
			entityType: "EVENT",
			entityName: "אירוע ראשון",
			linkedEntries: [
				{ id: "entry-1", uniqueName: "אירוע-ראשון", title: "כותרת האירוע" },
				{ id: "entry-2", uniqueName: "אירוע-שני", title: "אירוע שני" },
			],
		},
		{
			entityId: "2",
			entityType: "SAYING",
			entityName: "אמרה ללא ערך",
			linkedEntries: [],
		},
		{
			entityId: "3",
			entityType: "PERSON",
			entityName: "איש ללא ערך",
			linkedEntries: [],
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
	expect(getTodayInTanahEntities).toHaveBeenCalledWith(
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
	expect(screen.getByText("אמרה ללא ערך").tagName).toBe("STRONG");
	expect(screen.getByText("איש ללא ערך")).toBeVisible();
	const section = screen
		.getByRole("heading", { name: 'היום בתנ"ך' })
		.closest("section");
	if (!section) throw new Error("Today's section is missing");
	expect(within(section).getAllByRole("listitem")).toHaveLength(3);
	expect(screen.queryByRole("link", { name: "אמרה ללא ערך" })).toBeNull();
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
		expect(screen.queryByText("בקרוב")).toBeNull();
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

test.each([
	["2026-10-02T22:30:00Z", 22],
	["2026-10-03T17:00:00Z", 23],
])(
	"uses the Jerusalem Hebrew date at %s, including nightfall rollover",
	async (instant, expectedDay) => {
		jest.setSystemTime(new Date(instant));
		render(await TanahpediaLandingPage());
		expect(getTodayInTanahEntities).toHaveBeenCalledWith(1, expectedDay);
	},
);
