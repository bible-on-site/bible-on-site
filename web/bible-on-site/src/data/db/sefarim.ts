import * as tanah from "./sefaria-dump-5784-sivan-4.tanah_view.json";
import { Sefarim } from "./tanah-view-types";

const sefarim = Array.from(
  process.env.IS_TEST_ENV
    ? eval("require('./sefaria-dump-5784-sivan-4.tanah_view.json')")
    : (tanah as never)
) as Sefarim;

export { sefarim };
