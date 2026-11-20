import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	ContributionArticleLinkFields,
	type ContributionArticlePreview,
	type ContributionArticleTarget,
	type DiscoverContributionArticleLinks,
	type PreviewContributionArticle,
	type SearchContributionArticles,
} from "~/components/tanahpedia/ContributionArticleLinks";
import { ContributionDiff } from "~/components/tanahpedia/ContributionDiff";
import type {
	ArticleLinkCommand,
	ArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";
import type {
	ChangeState,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";

const base: ArticleLinkState = {
	contentHash: "a".repeat(32),
	sourceHash: "b".repeat(64),
	perekId: 1,
	authorId: 2,
	coverageVerified: true,
	coveringSources: [{ perekId: 1, pasuk: 1 }],
	dedicationAssignments: [{ dedicationId: 3, expiresAt: null }],
	moedIds: [4],
};
const labels = {
	"article:17": "מאמר לדוגמה",
	"perek:1": "בראשית א",
	"perek:2": "בראשית ב",
	"dedication:3": "לעילוי נשמה",
	"dedication:5": "להצלחה",
	"moed:4": "פסח",
	"moed:6": "סוכות",
};
const preview: ContributionArticlePreview = {
	id: "17",
	title: "מאמר לדוגמה",
	state: base,
	labels,
	references: {
		dedication: [{ id: 3, name: "לעילוי נשמה" }],
		moed: [{ id: 4, name: "פסח" }],
	},
	hasMore: { dedication: false, moed: false },
};
function Editor({
	initial,
	loader,
	search,
	discover,
	open,
}: {
	initial: ArticleLinkCommand[];
	loader?: PreviewContributionArticle;
	search?: SearchContributionArticles;
	discover?: DiscoverContributionArticleLinks;
	open?: (id: string) => unknown;
}) {
	const [targetId, setTargetId] = useState("17");
	const [commands, setCommands] = useState(JSON.stringify(initial));
	return (
		<>
			<ContributionArticleLinkFields
				targetId={targetId}
				commands={commands}
				onTargetChange={setTargetId}
				onCommandsChange={setCommands}
				previewArticle={loader}
				searchArticles={search}
				discoverLinks={discover}
				openPr={open}
				references={{
					perek: [{ id: 1, name: "בראשית א" }],
					dedication: [{ id: 5, name: "להצלחה" }],
				}}
			/>
			<output aria-label="Draft">{commands}</output>
		</>
	);
}
function setup(
	initial: ArticleLinkCommand[] = [],
	loader?: PreviewContributionArticle,
	extras: {
		search?: SearchContributionArticles;
		discover?: DiscoverContributionArticleLinks;
		open?: (id: string) => unknown;
	} = {},
) {
	return render(<Editor initial={initial} loader={loader} {...extras} />);
}
function draft(): ArticleLinkCommand[] {
	return JSON.parse(screen.getByLabelText("Draft").textContent ?? "[]");
}
function changeType(type: ArticleLinkCommand["relationshipKey"]) {
	fireEvent.change(screen.getByLabelText("סוג קישור 1"), {
		target: { value: type },
	});
}
function add() {
	fireEvent.click(screen.getByRole("button", { name: "+ הוספת קישור מוצע" }));
}

describe("article-link contribution fields", () => {
	it.each(["coveringSources", "moadim"] as const)(
		"retains existing %s targets when changing a populated draft's action",
		(relationshipKey) => {
			const target =
				relationshipKey === "moadim"
					? { moedIds: [4, 6] }
					: { pasukCoordinates: [{ perekId: 1, pasuk: 1 }] };
			setup([{ relationshipKey, action: "add", target } as ArticleLinkCommand]);
			fireEvent.change(screen.getByLabelText("פעולת קישור 1"), {
				target: { value: "remove" },
			});
			expect(draft()[0]).toEqual({ relationshipKey, action: "remove", target });
		},
	);
	it("shows a numeric chapter when an exact preview has no chapter label", async () => {
		setup([], vi.fn().mockResolvedValue({ ...preview, labels: {} }));
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		expect(
			await screen.findByRole("region", { name: "המאמר שנבחר" }),
		).toHaveTextContent("1");
	});
	it("loads exactly the selected article without including its prose or hashes", async () => {
		const loader = vi.fn().mockResolvedValue({
			...preview,
			hasMore: { dedication: true, moed: false },
		});
		setup([], loader);
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		expect(loader).toHaveBeenCalledWith("17");
		expect(
			await screen.findByRole("link", { name: "מאמר לדוגמה" }),
		).toHaveAttribute("href", "/articles/17");
		expect(screen.getByText(/הרשימות מציגות חלק/)).toBeInTheDocument();
		expect(
			screen.getByRole("region", { name: "המאמר שנבחר" }),
		).toHaveTextContent("בראשית א");
		expect(screen.queryByText(base.contentHash)).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "18" },
		});
		expect(
			screen.queryByRole("link", { name: "מאמר לדוגמה" }),
		).not.toBeInTheDocument();
	});
	it.each([new Error("Article unavailable"), "offline"])(
		"reports a failed preview and permits another lookup (%s)",
		async (failure) => {
			const loader = vi
				.fn()
				.mockRejectedValueOnce(failure)
				.mockResolvedValue(preview);
			setup([], loader);
			fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
			expect(await screen.findByRole("alert")).toHaveTextContent(
				failure instanceof Error ? failure.message : "טעינת המאמר נכשלה",
			);
			fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
			expect(
				await screen.findByRole("link", { name: "מאמר לדוגמה" }),
			).toBeInTheDocument();
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		},
	);
	it("rejects noncanonical IDs before requesting an article", async () => {
		const loader = vi.fn();
		setup([], loader);
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "017" },
		});
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"canonical article ID required",
		);
		expect(loader).not.toHaveBeenCalled();
	});
	it("ignores an earlier preview response after the target changes", async () => {
		let resolve: (result: ContributionArticlePreview) => void = () => {};
		const loader = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<ContributionArticlePreview>((done) => {
						resolve = done;
					}),
			)
			.mockResolvedValue({ ...preview, id: "18", title: "מאמר אחר" });
		setup([], loader);
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		expect(screen.getByRole("button", { name: "טוען מאמר..." })).toBeDisabled();
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "18" },
		});
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		expect(
			await screen.findByRole("link", { name: "מאמר אחר" }),
		).toBeInTheDocument();
		await act(async () => resolve(preview));
		expect(screen.getByRole("link", { name: "מאמר אחר" })).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "מאמר לדוגמה" }),
		).not.toBeInTheDocument();
	});
	it("does not surface a stale preview failure after changing the target", async () => {
		let reject: (failure: Error) => void = () => {};
		setup(
			[],
			() =>
				new Promise((_, fail) => {
					reject = fail;
				}),
		);
		fireEvent.click(screen.getByRole("button", { name: "טעינת המאמר" }));
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "" },
		});
		await act(async () => reject(new Error("Stale failure")));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "טעינת המאמר" })).toBeDisabled();
	});
	it("edits primary-chapter replacement while retaining the input's identity", () => {
		setup();
		add();
		changeType("primaryPerek");
		const chapter = screen.getByLabelText("פרק ראשי 1");
		fireEvent.change(chapter, { target: { value: "2" } });
		expect(screen.getByLabelText("פרק ראשי 1")).toBe(chapter);
		expect(draft()).toEqual([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 2 },
			},
		]);
		expect(
			within(screen.getByLabelText("פעולת קישור 1")).getAllByRole("option"),
		).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "הסרת קישור 1" }));
		expect(draft()).toEqual([]);
	});
	it("edits coverage coordinates, preserves remaining inputs on removal and explicitly chooses verification", () => {
		setup();
		add();
		fireEvent.change(screen.getByLabelText("פרק בקישור 1 פסוק 1"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("מספר פסוק בקישור 1 פסוק 1"), {
			target: { value: "2" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "+ הוספת פסוק לקישור 1" }),
		);
		const remaining = screen.getByLabelText("פרק בקישור 1 פסוק 2");
		fireEvent.change(remaining, { target: { value: "2" } });
		fireEvent.change(screen.getByLabelText("מספר פסוק בקישור 1 פסוק 2"), {
			target: { value: "3" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "הסרת פסוק 1 מקישור 1" }),
		);
		expect(screen.getByLabelText("פרק בקישור 1 פסוק 1")).toBe(remaining);
		for (const value of ["true", "false", "preserve"])
			fireEvent.change(screen.getByLabelText("אימות כיסוי 1"), {
				target: { value },
			});
		expect(draft()).toEqual([
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: [{ perekId: 2, pasuk: 3 }] },
			},
		]);
		fireEvent.change(screen.getByLabelText("פעולת קישור 1"), {
			target: { value: "clear" },
		});
		expect(draft()).toEqual([
			{
				relationshipKey: "coveringSources",
				action: "clear",
				target: { pasukCoordinates: [] },
			},
		]);
		expect(screen.queryByLabelText("אימות כיסוי 1")).not.toBeInTheDocument();
	});
	it("retains and edits dedication expiry in UTC, including seconds and an ongoing assignment", () => {
		setup();
		add();
		changeType("dedicationAssignments");
		fireEvent.change(screen.getByLabelText("מספר הקדשה 1"), {
			target: { value: "3" },
		});
		fireEvent.change(screen.getByLabelText("פעולת קישור 1"), {
			target: { value: "replace" },
		});
		fireEvent.change(screen.getByLabelText("תוקף הקדשה 1"), {
			target: { value: "2030-01-02T03:04" },
		});
		expect(draft()[0].target).toEqual({
			dedicationId: 3,
			expiresAt: "2030-01-02 03:04:00",
		});
		fireEvent.change(screen.getByLabelText("תוקף הקדשה 1"), {
			target: { value: "2030-01-02T03:04:05" },
		});
		expect(draft()[0].target).toEqual({
			dedicationId: 3,
			expiresAt: "2030-01-02 03:04:05",
		});
		fireEvent.change(screen.getByLabelText("תוקף הקדשה 1"), {
			target: { value: "" },
		});
		expect(draft()[0].target).toEqual({ dedicationId: 3, expiresAt: null });
		fireEvent.change(screen.getByLabelText("פעולת קישור 1"), {
			target: { value: "remove" },
		});
		expect(screen.queryByLabelText("תוקף הקדשה 1")).not.toBeInTheDocument();
	});
	it("edits a bounded list of moed links and supports clearing that whole set", () => {
		setup();
		add();
		changeType("moadim");
		fireEvent.change(screen.getByLabelText("מספר מועד 1 בקישור 1"), {
			target: { value: "4" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "+ הוספת מועד לקישור 1" }),
		);
		const remaining = screen.getByLabelText("מספר מועד 2 בקישור 1");
		fireEvent.change(remaining, { target: { value: "6" } });
		fireEvent.click(
			screen.getByRole("button", { name: "הסרת מועד 1 מקישור 1" }),
		);
		expect(screen.getByLabelText("מספר מועד 1 בקישור 1")).toBe(remaining);
		expect(draft()[0].target).toEqual({ moedIds: [6] });
		fireEvent.change(screen.getByLabelText("פעולת קישור 1"), {
			target: { value: "clear" },
		});
		expect(draft()[0].target).toEqual({ moedIds: [] });
		expect(
			screen.queryByLabelText("מספר מועד 1 בקישור 1"),
		).not.toBeInTheDocument();
	});
	it("keeps the second command's fields intact when removing the first", () => {
		setup();
		add();
		add();
		const remaining = screen.getByLabelText("פרק בקישור 2 פסוק 1");
		fireEvent.change(remaining, { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: "הסרת קישור 1" }));
		expect(screen.getByLabelText("פרק בקישור 1 פסוק 1")).toBe(remaining);
	});
	it("prevents adding more than forty typed commands", () => {
		setup(
			Array.from({ length: 40 }, () => ({
				relationshipKey: "coveringSources",
				action: "clear",
				target: { pasukCoordinates: [] },
			})),
		);
		expect(
			screen.getByRole("button", { name: "+ הוספת קישור מוצע" }),
		).toBeDisabled();
	});
});

describe("article title search and link discovery", () => {
	const found: ContributionArticleTarget[] = [
		{
			id: "17",
			title: "מאמר לדוגמה",
			perekLabel: "בראשית א",
			authorName: "הרב דוגמה",
		},
		{ id: "42", title: "מאמר לדוגמה", perekLabel: "שמות ב", authorName: null },
	];
	it("finds articles by title and selects one, filling the ID and loading the article", async () => {
		const search = vi.fn().mockResolvedValue(found);
		const loader = vi.fn().mockResolvedValue(preview);
		setup([], loader, { search });
		fireEvent.change(screen.getByLabelText("חיפוש מאמר לפי שם"), {
			target: { value: "לדוגמה" },
		});
		const list = await screen.findByRole("list", {
			name: "תוצאות חיפוש המאמרים",
		});
		expect(search).toHaveBeenCalledWith("לדוגמה");
		await act(async () =>
			fireEvent.click(
				within(list).getAllByRole("button", { name: /מאמר לדוגמה/ })[1],
			),
		);
		expect(screen.getByLabelText("מספר מאמר")).toHaveValue("42");
		expect(loader).toHaveBeenCalledWith("42");
		expect(
			screen.queryByRole("list", { name: "תוצאות חיפוש המאמרים" }),
		).not.toBeInTheDocument();
	});
	it("shows enough context to tell same-name articles apart", async () => {
		setup([], undefined, { search: vi.fn().mockResolvedValue(found) });
		fireEvent.change(screen.getByLabelText("חיפוש מאמר לפי שם"), {
			target: { value: "מאמר" },
		});
		const list = await screen.findByRole("list", {
			name: "תוצאות חיפוש המאמרים",
		});
		const [first, second] = within(list).getAllByRole("button");
		expect(first).toHaveTextContent("בראשית א");
		expect(first).toHaveTextContent("מאמר 17");
		expect(first).toHaveTextContent("הרב דוגמה");
		expect(second).toHaveTextContent("שמות ב");
		expect(second).toHaveTextContent("מאמר 42");
	});
	it("reports an empty title search while keeping numeric entry available", async () => {
		setup([], undefined, { search: vi.fn().mockResolvedValue([]) });
		fireEvent.change(screen.getByLabelText("חיפוש מאמר לפי שם"), {
			target: { value: "אין כזה" },
		});
		expect(
			await screen.findByText(/לא נמצאו מאמרים בשם הזה/),
		).toBeInTheDocument();
		expect(screen.getByLabelText("מספר מאמר")).toHaveValue("17");
	});
	it("reports a failed search and recovers on the next query", async () => {
		const search = vi
			.fn()
			.mockRejectedValueOnce(new Error("Search failed"))
			.mockResolvedValue(found);
		setup([], undefined, { search });
		const input = screen.getByLabelText("חיפוש מאמר לפי שם");
		fireEvent.change(input, { target: { value: "ראשון" } });
		expect(await screen.findByRole("alert")).toHaveTextContent("Search failed");
		fireEvent.change(input, { target: { value: "שני" } });
		expect(
			await screen.findByRole("list", { name: "תוצאות חיפוש המאמרים" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
	it("ignores superseded responses and paints only the latest query", async () => {
		const resolvers: Array<(hits: ContributionArticleTarget[]) => void> = [];
		const rejecters: Array<(failure: unknown) => void> = [];
		const search = vi.fn().mockImplementation(
			() =>
				new Promise<ContributionArticleTarget[]>((resolve, reject) => {
					resolvers.push(resolve);
					rejecters.push(reject);
				}),
		);
		setup([], undefined, { search });
		const input = screen.getByLabelText("חיפוש מאמר לפי שם");
		fireEvent.change(input, { target: { value: "ראשון" } });
		await waitFor(() => expect(search).toHaveBeenCalledWith("ראשון"));
		fireEvent.change(input, { target: { value: "שני" } });
		await waitFor(() => expect(search).toHaveBeenCalledWith("שני"));
		// The first query's late resolution must not paint stale results.
		await act(async () => resolvers[0](found));
		expect(
			screen.queryByRole("list", { name: "תוצאות חיפוש המאמרים" }),
		).not.toBeInTheDocument();
		fireEvent.change(input, { target: { value: "שלישי" } });
		await waitFor(() => expect(search).toHaveBeenCalledWith("שלישי"));
		// Nor may the second query's late rejection surface a stale error.
		await act(async () => rejecters[1](new Error("Stale failure")));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		await act(async () => resolvers[2](found));
		expect(
			await screen.findByRole("list", { name: "תוצאות חיפוש המאמרים" }),
		).toBeInTheDocument();
	});
	it("falls back to a generic message for a non-error search failure", async () => {
		setup([], undefined, { search: vi.fn().mockRejectedValue("offline") });
		fireEvent.change(screen.getByLabelText("חיפוש מאמר לפי שם"), {
			target: { value: "מאמר" },
		});
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"חיפוש המאמרים נכשל",
		);
	});
	it("selects a search hit without a preview when no loader is provided", async () => {
		setup([], undefined, { search: vi.fn().mockResolvedValue(found) });
		fireEvent.change(screen.getByLabelText("חיפוש מאמר לפי שם"), {
			target: { value: "מאמר" },
		});
		const list = await screen.findByRole("list", {
			name: "תוצאות חיפוש המאמרים",
		});
		await act(async () =>
			fireEvent.click(
				within(list).getAllByRole("button", { name: /מאמר לדוגמה/ })[1],
			),
		);
		expect(screen.getByLabelText("מספר מאמר")).toHaveValue("42");
		expect(
			screen.queryByRole("region", { name: "המאמר שנבחר" }),
		).not.toBeInTheDocument();
	});
	it("discovers links for the chosen article and opens the ordinary PR", async () => {
		const discover = vi.fn().mockResolvedValue(["existing-pr"]);
		const open = vi.fn();
		setup([], undefined, { discover, open });
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		expect(discover).toHaveBeenCalledWith("17");
		await waitFor(() => expect(open).toHaveBeenCalledWith("existing-pr"));
	});
	it("explains an empty discovery without opening a PR", async () => {
		const discover = vi.fn().mockResolvedValue([]);
		const open = vi.fn();
		setup([], undefined, { discover, open });
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		expect(
			await screen.findByText(/לא נמצאו קישורים חדשים/),
		).toBeInTheDocument();
		expect(open).not.toHaveBeenCalled();
	});
	it("falls back to a generic message for a non-error discovery failure", async () => {
		setup([], undefined, {
			discover: vi.fn().mockRejectedValue("offline"),
			open: vi.fn(),
		});
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"איתור הקישורים נכשל",
		);
	});
	it("keeps the article ID after a failed discovery and permits a retry", async () => {
		const discover = vi
			.fn()
			.mockRejectedValueOnce(new Error("Discovery failed"))
			.mockResolvedValue(["existing-pr"]);
		const open = vi.fn();
		setup([], undefined, { discover, open });
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Discovery failed",
		);
		expect(screen.getByLabelText("מספר מאמר")).toHaveValue("17");
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		await waitFor(() => expect(open).toHaveBeenCalledWith("existing-pr"));
	});
	it("runs discovery once while pending", async () => {
		let finish: (ids: string[]) => void = () => {};
		const discover = vi.fn().mockImplementation(
			() =>
				new Promise<string[]>((done) => {
					finish = done;
				}),
		);
		setup([], undefined, { discover, open: vi.fn() });
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		const pending = screen.getByRole("button", { name: "מאתר קישורים..." });
		expect(pending).toBeDisabled();
		fireEvent.click(pending);
		expect(discover).toHaveBeenCalledTimes(1);
		await act(async () => finish([]));
	});
	it("rejects noncanonical article IDs before running discovery", async () => {
		const discover = vi.fn();
		setup([], undefined, { discover, open: vi.fn() });
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "017" },
		});
		await act(async () =>
			fireEvent.click(
				screen.getByRole("button", { name: "איתור קישורים ופתיחת PR" }),
			),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"canonical article ID required",
		);
		expect(discover).not.toHaveBeenCalled();
	});
});

function showDiff(
	commands: ArticleLinkCommand[],
	withLabels = true,
	options: { before?: ArticleLinkState; labels?: Record<string, string> } = {},
) {
	const change: ReviewedChange = {
		kind: "article_links",
		targetId: "17",
		before: structuredClone(options.before ?? base) as unknown as ChangeState,
		after: { commands } as unknown as ChangeState,
		labels: options.labels ?? (withLabels ? labels : {}),
	};
	return render(<ContributionDiff changes={[change]} />);
}
describe("article-link domain diff", () => {
	it("shows human-readable link states instead of API commands or internal hashes", () => {
		showDiff([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 2 },
			},
			{
				relationshipKey: "coveringSources",
				action: "replace",
				target: {
					pasukCoordinates: [{ perekId: 2, pasuk: 3 }],
					coverageVerified: false,
				},
			},
			{
				relationshipKey: "dedicationAssignments",
				action: "replace",
				target: { dedicationId: 3, expiresAt: "2030-01-02 03:04:05" },
			},
			{
				relationshipKey: "moadim",
				action: "replace",
				target: { moedIds: [6] },
			},
		]);
		expect(screen.getByRole("link", { name: "מאמר לדוגמה" })).toHaveAttribute(
			"href",
			"/articles/17",
		);
		expect(screen.getByRole("table")).toHaveTextContent("בראשית א א");
		expect(screen.getByRole("table")).toHaveTextContent("בראשית ב ג");
		expect(screen.getByRole("table")).toHaveTextContent(
			"לעילוי נשמה (#3) (עד 2030-01-02 03:04:05 UTC)",
		);
		expect(screen.getByRole("table")).toHaveTextContent("פסח");
		expect(screen.getByRole("table")).toHaveTextContent("סוכות");
		expect(screen.queryByText(base.contentHash)).not.toBeInTheDocument();
		expect(screen.queryByText("commands")).not.toBeInTheDocument();
	});
	it("distinguishes replacing catalogue targets with the same name and dedication expiry", () => {
		const expiresAt = "2030-01-02 03:04:05";
		showDiff(
			[
				{
					relationshipKey: "dedicationAssignments",
					action: "remove",
					target: { dedicationId: 3, expiresAt: null },
				},
				{
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 5, expiresAt },
				},
				{
					relationshipKey: "moadim",
					action: "replace",
					target: { moedIds: [6] },
				},
			],
			true,
			{
				before: {
					...base,
					dedicationAssignments: [{ dedicationId: 3, expiresAt }],
				},
				labels: {
					...labels,
					"dedication:3": "שם משותף",
					"dedication:5": "שם משותף",
					"moed:4": "מועד משותף",
					"moed:6": "מועד משותף",
				},
			},
		);
		const dedications = within(
			screen.getByRole("row", { name: /הקדשות/ }),
		).getAllByRole("cell");
		expect(dedications[0]).toHaveTextContent(
			"שם משותף (#3) (עד 2030-01-02 03:04:05 UTC)",
		);
		expect(dedications[1]).toHaveTextContent(
			"שם משותף (#5) (עד 2030-01-02 03:04:05 UTC)",
		);
		const moadim = within(
			screen.getByRole("row", { name: /מועדים/ }),
		).getAllByRole("cell");
		expect(moadim[0]).toHaveTextContent("מועד משותף (#4)");
		expect(moadim[1]).toHaveTextContent("מועד משותף (#6)");
	});
	it("preserves every same-name assignment without duplicate-key warnings", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			showDiff(
				[
					{
						relationshipKey: "dedicationAssignments",
						action: "add",
						target: { dedicationId: 7, expiresAt: null },
					},
					{
						relationshipKey: "moadim",
						action: "add",
						target: { moedIds: [8] },
					},
				],
				true,
				{
					before: {
						...base,
						dedicationAssignments: [
							{ dedicationId: 3, expiresAt: null },
							{ dedicationId: 5, expiresAt: null },
						],
						moedIds: [4, 6],
					},
					labels: {
						...labels,
						"dedication:3": "שם משותף",
						"dedication:5": "שם משותף",
						"dedication:7": "שם משותף",
						"moed:4": "מועד משותף",
						"moed:6": "מועד משותף",
						"moed:8": "מועד משותף",
					},
				},
			);
			const dedications = within(
				screen.getByRole("row", { name: /הקדשות/ }),
			).getAllByRole("cell");
			expect(within(dedications[0]).getAllByRole("listitem")).toHaveLength(2);
			expect(within(dedications[1]).getAllByRole("listitem")).toHaveLength(3);
			expect(dedications[1]).toHaveTextContent("שם משותף (#3)");
			expect(dedications[1]).toHaveTextContent("שם משותף (#5)");
			expect(dedications[1]).toHaveTextContent("שם משותף (#7)");
			const moadim = within(
				screen.getByRole("row", { name: /מועדים/ }),
			).getAllByRole("cell");
			expect(within(moadim[0]).getAllByRole("listitem")).toHaveLength(2);
			expect(within(moadim[1]).getAllByRole("listitem")).toHaveLength(3);
			expect(moadim[1]).toHaveTextContent("מועד משותף (#4)");
			expect(moadim[1]).toHaveTextContent("מועד משותף (#6)");
			expect(moadim[1]).toHaveTextContent("מועד משותף (#8)");
			expect(error).not.toHaveBeenCalled();
		} finally {
			error.mockRestore();
		}
	});
	it("retains unrelated current links while showing add and remove intents", () => {
		showDiff([
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: [{ perekId: 2, pasuk: 3 }] },
			},
			{
				relationshipKey: "dedicationAssignments",
				action: "add",
				target: { dedicationId: 5, expiresAt: null },
			},
			{ relationshipKey: "moadim", action: "remove", target: { moedIds: [4] } },
		]);
		const source = screen.getByRole("row", { name: /כיסוי פסוקים/ });
		expect(within(source).getAllByText("בראשית א א")).toHaveLength(2);
		expect(within(source).getByText("בראשית ב ג")).toBeInTheDocument();
		expect(screen.getByRole("row", { name: /הקדשות/ })).toHaveTextContent(
			"להצלחה",
		);
		expect(
			screen.getByRole("row", { name: /מועדים/ }).querySelector(".added"),
		).toHaveTextContent("-");
	});
	it("supports canonical-ID fallbacks and renders a cleared set explicitly", () => {
		showDiff(
			[
				{
					relationshipKey: "coveringSources",
					action: "clear",
					target: { pasukCoordinates: [] },
				},
				{
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 5, expiresAt: null },
				},
				{ relationshipKey: "moadim", action: "add", target: { moedIds: [6] } },
			],
			false,
		);
		expect(screen.getByRole("link", { name: "מאמר 17" })).toBeInTheDocument();
		expect(screen.getByRole("table")).toHaveTextContent("פרק 1 א");
		expect(screen.getByRole("table")).toHaveTextContent("הקדשה 5");
		expect(screen.getByRole("table")).toHaveTextContent("מועד 6");
	});
	it("makes an already satisfied link intent an auditable no-op", () => {
		showDiff([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 1 },
			},
		]);
		expect(screen.getByText(/מצב היעד כבר תואם להצעה/)).toBeInTheDocument();
		expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
			1,
		);
	});
});
