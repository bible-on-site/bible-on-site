/**
 * @jest-environment node
 */
import Home, {
	generateMetadata,
	generateStaticParams,
} from "@/app/[section]/page";

jest.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const params = (section?: string) =>
	Promise.resolve(section === undefined ? {} : { section });

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
			const contact = await Home({ params: params("contact") });
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

	describe("generateMetadata", () => {
		it("gives every section its own Hebrew title, description and canonical", async () => {
			const all = await Promise.all(
				generateStaticParams().map(({ section }) =>
					generateMetadata({ params: params(section) }),
				),
			);
			const titles = all.map((m) => m.title);
			expect(new Set(titles).size).toBe(titles.length);
			for (const [i, { section }] of generateStaticParams().entries()) {
				expect(all[i].title).toMatch(/ \| תנ"ך על הפרק$/);
				expect(all[i].description).toBeTruthy();
				expect(all[i].alternates?.canonical).toBe(`/${section}`);
			}
			expect(
				(await generateMetadata({ params: params("donation") })).title,
			).toBe('תרומות | תנ"ך על הפרק');
		});

		it("404s for an unknown section", async () => {
			await expect(
				generateMetadata({ params: params("toString") }),
			).rejects.toThrow("NEXT_NOT_FOUND");
		});
	});

	describe("Home routing", () => {
		const scrollTargetOf = async (section?: string) => {
			const tree = (await Home({ params: params(section) })) as {
				props: { children: unknown[] };
			};
			const scroll = tree.props.children.find(
				(c) => (c as { props?: { sectionId?: string } })?.props?.sectionId,
			) as { props: { sectionId: string } } | undefined;
			return scroll?.props.sectionId;
		};

		it("scrolls sections without their own block to contact", async () => {
			expect(await scrollTargetOf("donation")).toBe("contact");
			expect(await scrollTargetOf("dailyBulletin")).toBe("contact");
			expect(await scrollTargetOf("whatsappGroup")).toBe("contact");
			expect(await scrollTargetOf("tos")).toBe("tos");
		});

		it("does not scroll on the root page", async () => {
			expect(await scrollTargetOf()).toBeUndefined();
		});

		it("404s for an unknown section", async () => {
			await expect(Home({ params: params("nope") })).rejects.toThrow(
				"NEXT_NOT_FOUND",
			);
		});
	});
});
