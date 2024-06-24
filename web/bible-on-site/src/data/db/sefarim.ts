import * as tanah from "./sefaria-dump-5784-sivan-4.tanah_view.json";
import { Sefarim } from "./types";
const sefarim = Array.from(tanah as never) as Sefarim;
export { sefarim };
