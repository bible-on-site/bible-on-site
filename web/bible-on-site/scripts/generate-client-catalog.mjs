import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
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
// The reader route serves the compressed bytes with Content-Encoding: br;
// the catalog names the public URL, the file on disk carries a .br suffix.
const booksDirectory = fileURLToPath(
	new URL("../src/data/db/sefer-books/", import.meta.url),
);
const legacyBooksDirectory = fileURLToPath(
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
	const filename = `${sefer.perekFrom}.${digest}.json`;
	files.add(`${filename}.br`);
	const target = join(booksDirectory, `${filename}.br`);
	// The name already commits to the raw payload's hash: an existing file is
	// the compressed form of these exact bytes, so recompressing can be skipped.
	if (!existsSync(target))
		writeFileSync(
			target,
			brotliCompressSync(payload, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: 9,
					[constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(payload),
				},
			}),
		);
	const { name, helek, perekFrom, perekTo } = sefer;
	return {
		name,
		helek,
		perekFrom,
		perekTo,
		file: `/generated/sefarim/${filename}`,
	};
});
// Remove only obsolete files produced by this generator, after replacements exist.
for (const filename of readdirSync(booksDirectory)) {
	if (/^\d+\.[a-f0-9]{64}\.json\.br$/.test(filename) && !files.has(filename))
		unlinkSync(join(booksDirectory, filename));
}
// Raw payloads predate the compressed route: the public directory must not
// shadow the dynamic reader asset path with uncompressed copies.
rmSync(legacyBooksDirectory, { recursive: true, force: true });
writeIfChanged(output, `${JSON.stringify({ books, volumes, schedule })}\n`);
console.log(
	`Generated browser catalog and reader assets: ${books.length} books, ${schedule.length} chapters`,
);
