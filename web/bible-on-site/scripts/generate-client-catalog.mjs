import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

// Derive browser metadata and individual books from the existing canonical source.
const source = new URL(
	"../src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
	import.meta.url,
);
const output = new URL(
	"../src/data/db/client-catalog.generated.json",
	import.meta.url,
);
// The reader assets are precompressed Brotli bytes served as static files:
// the catalog names the public URL /generated/sefarim/{name}, and the file on
// disk is that same name holding Brotli bytes. next.config.mjs marks the path
// Content-Encoding: br with immutable caching. Serving through public/ (rather
// than a route handler) keeps Content-Encoding intact — the App Router response
// pipeline can drop it while still sending the encoded body (#3095).
const booksDirectory = fileURLToPath(
	new URL("../public/generated/sefarim/", import.meta.url),
);
const sefarim = JSON.parse(readFileSync(source, "utf8"));
const volumes = sefarim.flatMap((sefer) =>
	(sefer.perakim ? [sefer] : sefer.additionals).map(
		({ name, perekFrom, perakim }) => ({
			name,
			perekFrom,
			perekTo: perekFrom + perakim.length - 1,
		}),
	),
);
const schedule = sefarim.flatMap((sefer) => {
	const parts = sefer.perakim ? [sefer] : sefer.additionals;
	return parts.flatMap((part) =>
		part.perakim.map(({ date }, index) => ({
			perekId: part.perekFrom + index,
			date,
		})),
	);
});
if (
	schedule.length !== 929 ||
	schedule.some(({ perekId }, index) => perekId !== index + 1)
)
	throw new Error("Canonical chapter order must cover exactly 1 through 929");

mkdirSync(booksDirectory, { recursive: true });
const files = new Set();
// Rewriting identical bytes still bumps mtimes and re-triggers dev-server
// recompiles, so only write files whose content actually changed.
function writeIfChanged(filePath, payload) {
	if (existsSync(filePath) && readFileSync(filePath, "utf8") === payload)
		return;
	writeFileSync(filePath, payload);
}

const books = sefarim.map((sefer) => {
	const payload = `${JSON.stringify(sefer)}\n`;
	const digest = createHash("sha256").update(payload).digest("hex");
	const { name, helek, perekFrom, perekTo } = sefer;
	const filename = `${sefer.perekFrom}.${digest}.json`;
	files.add(filename);
	const target = join(booksDirectory, filename);
	// Earlier generators wrote raw JSON under this same payload hash. Upgrade
	// those bytes to the Brotli representation promised by the static headers,
	// while preserving already-compressed files and their modification times.
	if (!existsSync(target) || readFileSync(target).equals(Buffer.from(payload)))
		writeFileSync(
			target,
			brotliCompressSync(payload, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: 9,
					[constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(payload),
				},
			}),
		);
	return {
		name,
		helek,
		perekFrom,
		perekTo,
		file: `/generated/sefarim/${filename}`,
	};
});
// Remove only obsolete files produced by this generator, after replacements
// exist. The optional .br suffix also sweeps assets left by the earlier
// route-served layout, whose names were {name}.json.br.
for (const filename of readdirSync(booksDirectory)) {
	if (/^\d+\.[a-f0-9]{64}\.json(\.br)?$/.test(filename) && !files.has(filename))
		unlinkSync(join(booksDirectory, filename));
}
writeIfChanged(output, `${JSON.stringify({ books, volumes, schedule })}\n`);
console.log(
	`Generated browser catalog and reader assets: ${books.length} books, ${schedule.length} chapters`,
);
