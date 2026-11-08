import { render, screen } from "@testing-library/react";
import NotFound, { metadata } from "@/app/not-found";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

describe("app/not-found", () => {
	describe("metadata", () => {
		it("titles the page as missing and strips the homepage OG block", () => {
			// A missing page is not shareable: the root layout's homepage
			// OpenGraph block must not advertise the site's URL as the
			// missing page's own (issue #2935 regression contract).
			expect(metadata.title).toBe("העמוד לא נמצא");
			expect(metadata.openGraph).toBeNull();
		});
	});

	describe("NotFound", () => {
		it("renders the branded Hebrew missing-page with a home recovery link", () => {
			render(<NotFound />);

			expect(screen.getByText("404")).toBeInTheDocument();
			expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
				"הֲתָעִיף עֵינֶיךָ בּוֹ וְאֵינֶנּוּ",
			);
			expect(screen.getByText("(משלי כג ה)")).toBeInTheDocument();
			expect(
				screen.getByRole("link", { name: "חזרה לעמוד הראשי" }),
			).toHaveAttribute("href", "/");
		});
	});
});
