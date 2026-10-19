/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { TosSection } from "@/app/components/TosSection";

describe("TosSection", () => {
	it("renders main heading", () => {
		render(<TosSection />);
		expect(
			screen.getByRole("heading", { level: 1, name: "תנאי שימוש" }),
		).toBeInTheDocument();
	});

	it("renders privacy policy section", () => {
		render(<TosSection />);
		expect(
			screen.getByRole("heading", { level: 2, name: "מדיניות פרטיות" }),
		).toBeInTheDocument();
	});

	it("renders Sefaria and Dan Beeri links", () => {
		render(<TosSection />);
		const sefaria = screen.getByRole("link", { name: "ספאריה" });
		expect(sefaria).toHaveAttribute("href", "http://sefaria.org");
		const danBeeri = screen.getByRole("link", { name: "הרב דן בארי" });
		expect(danBeeri).toHaveAttribute(
			"href",
			"https://he.wikipedia.org/wiki/%D7%93%D7%9F_%D7%91%D7%90%D7%A8%D7%99",
		);
	});

	it("renders section with id tos", () => {
		render(<TosSection />);
		expect(document.getElementById("tos")).toBeInTheDocument();
	});

	describe("privacy policy accuracy (#2400)", () => {
		// The manifest strips the AD_ID permission, and analytics providers do
		// receive usage data, so the notice must not claim either otherwise.
		it("does not claim the app collects Android Advertising ID", () => {
			render(<TosSection />);
			const policy = document.getElementById("privacyPolicy");
			expect(policy?.textContent).not.toContain("לרבות מזהה");
		});

		it("names the third-party analytics providers", () => {
			render(<TosSection />);
			const policy = document.getElementById("privacyPolicy");
			expect(policy?.textContent).toContain("Google Analytics");
			expect(policy?.textContent).toContain("Firebase");
			expect(policy?.textContent).toContain("Ahrefs");
			expect(policy?.textContent).not.toContain("לשום גורם צד ג'");
		});

		it("describes the analytics consent and opt-out path", () => {
			render(<TosSection />);
			const policy = document.getElementById("privacyPolicy");
			expect(policy?.textContent).toContain("הסכמה");
		});
	});
});
