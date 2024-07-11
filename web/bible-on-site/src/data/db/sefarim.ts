import * as tanah from "./sefaria-dump-5784-sivan-4.tanah_view.json";
import type { Sefarim } from "./tanah-view-types";

const sefarim: Sefarim = Array.from(
	process.env.IS_TEST_ENV
		? (eval(
				"require('./sefaria-dump-5784-sivan-4.tanah_view.json')",
			) as Sefarim)
		: (tanah as Sefarim),
);

export { sefarim };
