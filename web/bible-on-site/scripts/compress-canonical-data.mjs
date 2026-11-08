import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";

// The server reads this 4 MB copy instead of the 40 MB original: a cold file
// cache made the first Sefer request wait ~1s on the raw read (issue #2881).
const source = new URL(
	"../src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
	import.meta.url,
);
const bytes = readFileSync(source);
writeFileSync(
	new URL(`${source.href}.br`),
	brotliCompressSync(bytes, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 9,
			[constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
		},
	}),
);
