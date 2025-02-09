import * as tanah from "./sefaria-dump-5784-sivan-4.tanah_view.json";
import type { Sefarim } from "./tanah-view-types";

const sefarim: Sefarim = Array.from(
	process.env.IS_TEST_ENV
		? // biome-ignore lint/security/noGlobalEval: didn't manage to ignore for the entire directory. this code runs just in testing env
			(eval(
				"require('./sefaria-dump-5784-sivan-4.tanah_view.json')",
			) as Sefarim)
		: /* istanbul ignore next: will never be reached in testing env */ (tanah as Sefarim),
);

export { sefarim };
