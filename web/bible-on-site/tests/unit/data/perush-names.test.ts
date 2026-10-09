import { perushNames } from "@/data/db/perush-names";
import { perushim } from "@/data/db/perushim";

describe("perush names", () => {
	it("matches every unique name in the perushim catalog", () => {
		const catalogNames = [...new Set(perushim.map(({ name }) => name))].sort();
		const projectedNames = [...perushNames].sort();

		expect(projectedNames).toEqual(catalogNames);
	});
});