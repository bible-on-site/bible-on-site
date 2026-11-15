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

	it("separates the brand font license from third-party font rights", () => {
		render(<TosSection />);
		const fontSection = document.getElementById("fontLicense");
		expect(fontSection).toHaveTextContent("Al Heperek Font");
		expect(fontSection).toHaveTextContent("צפייה בתוכן ושימוש רגיל");
		expect(fontSection).toHaveTextContent("הרשאה מראש ובכתב");
		expect(fontSection).toHaveTextContent("סעיף זה אינו מגביל זכויות");
		expect(fontSection).toHaveTextContent("רישיון GPL של Taamey D");
		expect(
			screen.getByRole("link", { name: "רישיון גופן על הפרק" }),
		).toHaveAttribute("href", "/font-license.txt");
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
});
