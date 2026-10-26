/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TosSection } from "@/app/components/TosSection";

function policyText() {
	return document.getElementById("privacyPolicy")?.textContent ?? "";
}

describe("TosSection", () => {
	it("renders the terms and privacy headings", () => {
		render(<TosSection />);
		expect(
			screen.getByRole("heading", { level: 2, name: "תנאי שימוש" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 3, name: "מדיניות פרטיות" }),
		).toBeInTheDocument();
	});

	it("keeps terms in the server HTML while excluding them from search snippets", () => {
		const html = renderToString(<TosSection />);
		expect(html).toContain('id="tos"');
		expect(html).toContain("data-nosnippet");
		expect(html).toContain('id="privacyPolicy"');
		render(<TosSection />);
		expect(document.getElementById("tos")).toHaveAttribute("data-nosnippet");
	});

	it("preserves the source attribution links", () => {
		render(<TosSection />);
		expect(screen.getByRole("link", { name: "ספאריה" })).toHaveAttribute(
			"href",
			"http://sefaria.org",
		);
		expect(screen.getByRole("link", { name: "הרב דן בארי" })).toHaveAttribute(
			"href",
			"https://he.wikipedia.org/wiki/%D7%93%D7%9F_%D7%91%D7%90%D7%A8%D7%99",
		);
	});

	it("explains technical collection despite the absence of user accounts", () => {
		render(<TosSection />);
		const policy = policyText();
		for (const detail of [
			"אינו דורש חשבון",
			"כתובת IP",
			"עוגיות",
			"מזהה התקנה",
			"מילות חיפוש",
			"מקור ההפניה",
		]) {
			expect(policy).toContain(detail);
		}
		expect(policy).toContain("אינו אוסף מזהי פרסום");
		expect(policy).not.toContain("לרבות מזהה");
	});

	it("names external processors and links their technical disclosures", () => {
		render(<TosSection />);
		for (const provider of [
			"Google Analytics",
			"Firebase Analytics",
			"Ahrefs",
			"BotD",
			"Fingerprint",
			"Mapbox",
			"OpenStreetMap",
		]) {
			expect(policyText()).toContain(provider);
		}
		expect(
			screen.getByRole("link", {
				name: "מדיניות Google לשירותים באתרים ובישומונים",
			}),
		).toHaveAttribute(
			"href",
			"https://policies.google.com/technologies/partner-sites",
		);
		expect(
			screen.getByRole("link", { name: "פרטים על Ahrefs" }),
		).toHaveAttribute(
			"href",
			"https://help.ahrefs.com/en/articles/10247870-about-ahrefs-web-analytics",
		);
		expect(policyText()).toContain("מזהה יומי");
		expect(policyText()).toContain("ניטור השימוש של BotD כבוי");
		expect(policyText()).toContain("אין בקשה למיקום המכשיר");
	});

	it("keeps ordinary statistics in the existing policy without approval or preference controls", () => {
		render(<TosSection />);
		const policy = policyText();
		expect(policy).toContain("ללא מטרת רווח ואינו מציג פרסומות");
		expect(policy).toContain("סטטיסטיקת שימוש ושיפור הלימוד");
		expect(policy).not.toContain("בכניסה מוצגת הודעה");
		expect(policy).not.toContain("העדפות הישומון");
		expect(policy).not.toContain("הסכמה מפורשת");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("distinguishes Israeli service hosting from external provider processing and configurable retention", () => {
		render(<TosSection />);
		const policy = policyText();
		expect(policy).toContain("ישראל של AWS");
		expect(policy).toContain("גם מחוץ לישראל");
		expect(policy).toContain("משך שמירת המידע תלוי");
		expect(policy).toContain("בהגדרות השירות ובמדיניות הספק");
		expect(policy).not.toContain("אינם מועברים לגורמים נוספים");
	});

	it("provides an actual contact and qualified access, correction and deletion request rights", () => {
		render(<TosSection />);
		expect(
			screen.getByRole("link", { name: "tanah.site@gmail.com" }),
		).toHaveAttribute("href", "mailto:tanah.site@gmail.com");
		expect(policyText()).toContain("זכויות עיון ותיקון לפי הדין");
		expect(policyText()).toContain("לבקשות מחיקת מידע");
		expect(policyText()).toContain("נבחן כל בקשה בהתאם לדין");
	});
});
