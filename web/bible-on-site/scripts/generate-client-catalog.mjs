import { createHash } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Derive browser metadata and individual books from the existing canonical source.
const source = new URL(
	"../src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
	import.meta.url,
);
const output = new URL(
	"../src/data/db/client-catalog.generated.json",
	import.meta.url,
);
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
const books = sefarim.map((sefer) => {
	const payload = `${JSON.stringify(sefer)}\n`;
	const digest = createHash("sha256").update(payload).digest("hex");
	const filename = `${sefer.perekFrom}.${digest}.json`;
	files.add(filename);
	writeFileSync(join(booksDirectory, filename), payload);
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
	if (/^\d+\.[a-f0-9]{64}\.json$/.test(filename) && !files.has(filename))
		unlinkSync(join(booksDirectory, filename));
}
writeFileSync(output, `${JSON.stringify({ books, volumes, schedule })}\n`);
console.log(
	`Generated browser catalog and reader assets: ${books.length} books, ${schedule.length} chapters`,
);
