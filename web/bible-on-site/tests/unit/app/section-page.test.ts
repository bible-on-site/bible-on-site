/**
 * @jest-environment node
 */
import Home, { generateStaticParams } from "@/app/[section]/page";

describe("[section]/page", () => {
	describe("generateStaticParams", () => {
		it("returns all section slugs", async () => {
			const params = await generateStaticParams();
			expect(params).toEqual([
				{ section: "dailyBulletin" },
				{ section: "whatsappGroup" },
				{ section: "tos" },
				{ section: "app" },
				{ section: "contact" },
				{ section: "donation" },
				{ section: "tanah-sefarim" },
			]);
		});
	});

	describe("Home", () => {
		it("resolves scrollTarget for contact, tos, app, tanah-sefarim", async () => {
			const contact = await Home({ params: Promise.resolve({ section: "contact" }) });
			const tos = await Home({ params: Promise.resolve({ section: "tos" }) });
			const app = await Home({ params: Promise.resolve({ section: "app" }) });
			const tanah = await Home({
				params: Promise.resolve({ section: "tanah-sefarim" }),
			});
			expect(contact).toBeDefined();
			expect(tos).toBeDefined();
			expect(app).toBeDefined();
			expect(tanah).toBeDefined();
		});

		it("resolves for other sections without scroll target", async () => {
			const daily = await Home({
				params: Promise.resolve({ section: "dailyBulletin" }),
			});
			expect(daily).toBeDefined();
		});
	});
});
