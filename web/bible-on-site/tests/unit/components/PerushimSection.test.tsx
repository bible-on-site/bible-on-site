/**
 * @jest-environment jsdom
 */
jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		onClick,
		className,
	}: {
		children: React.ReactNode;
		href: string;
		onClick?: React.MouseEventHandler;
		className?: string;
	}) => (
		<a href={href} onClick={onClick} className={className}>
			{children}
		</a>
	),
}));

jest.mock("../../../src/app/929/[number]/actions", () => ({
	getPerushNotesForPage: jest.fn(),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { getPerushNotesForPage } from "../../../src/app/929/[number]/actions";
import { PerushimSection } from "../../../src/app/929/[number]/components/PerushimSection";
import type { PerushSummary } from "../../../src/lib/perushim";

const mockGetPerushNotesForPage = getPerushNotesForPage as jest.MockedFunction<
	typeof getPerushNotesForPage
>;

describe("PerushimSection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("renders section header and empty message when no perushim", () => {
		render(<PerushimSection perekId={1} perushim={[]} />);
		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		expect(screen.getByText("אין פרשנות לפרק זה")).toBeTruthy();
	});

	it("renders carousel links when perushim provided (SEO mode)", () => {
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
			{
				id: 14,
				name: "ביאור שטיינזלץ",
				parshanName: "עדין שטיינזלץ",
				noteCount: 31,
			},
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);
		expect(screen.getByRole("link", { name: /רש״י/ })).toBeTruthy();
		expect(screen.getByRole("link", { name: /ביאור שטיינזלץ/ })).toBeTruthy();
		expect(screen.getByText("55 פסוקים")).toBeTruthy();
	});

	it("renders links with correct href for SEO", () => {
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(<PerushimSection perekId={5} perushim={perushim} />);
		const link = screen.getByRole("link", { name: /רש״י/ });
		expect(link).toHaveAttribute(
			"href",
			`/929/5/${encodeURIComponent("רש״י")}`,
		);
	});

	it("clicking a perush link calls getPerushNotesForPage and pushes history", async () => {
		mockGetPerushNotesForPage.mockResolvedValue([]);
		const pushStateSpy = jest.spyOn(history, "pushState");
		const perushim: PerushSummary[] = [
			{
				id: 14,
				name: "ביאור שטיינזלץ",
				parshanName: "עדין שטיינזלץ",
				noteCount: 31,
			},
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);
		const link = screen.getByRole("link", { name: /ביאור שטיינזלץ/ });

		await act(async () => {
			fireEvent.click(link);
		});

		expect(mockGetPerushNotesForPage).toHaveBeenCalledWith(14, 1);
		expect(pushStateSpy).toHaveBeenCalledWith(
			{ perushId: 14 },
			"",
			expect.stringContaining("/929/1/"),
		);
		pushStateSpy.mockRestore();
	});

	it("delegates to onPerushClick when provided (renders buttons)", () => {
		const onPerushClick = jest.fn();
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(
			<PerushimSection
				perekId={1}
				perushim={perushim}
				onPerushClick={onPerushClick}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /רש״י/ }));
		expect(onPerushClick).toHaveBeenCalledWith(perushim[0]);
		expect(mockGetPerushNotesForPage).not.toHaveBeenCalled();
	});

	it("handles error in internal handlePerushClick", async () => {
		mockGetPerushNotesForPage.mockRejectedValue(new Error("fail"));
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: /רש״י/ }));
		});

		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
	});

	it("pushes history back to perek on handleBack", async () => {
		mockGetPerushNotesForPage.mockResolvedValue([
			{ pasuk: 1, noteIdx: 0, noteContent: "<p>test</p>" },
		]);
		const pushStateSpy = jest.spyOn(history, "pushState");
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(<PerushimSection perekId={5} perushim={perushim} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: /רש״י/ }));
		});

		pushStateSpy.mockClear();

		const backButton = screen.getByText(/חזרה לפרשנים/);
		fireEvent.click(backButton);

		expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/929/5");
		pushStateSpy.mockRestore();
	});
});
