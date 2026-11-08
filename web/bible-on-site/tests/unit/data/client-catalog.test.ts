import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import catalog from "../../../src/data/db/client-catalog.generated.json";
import { sefarim } from "../../../src/data/db/sefarim";
import { getAllPerakim } from "../../../src/data/sefer-dto";

it("retains canonical book order, names and chapter ranges", () => {
	expect(catalog.books.map(({ file: _file, ...book }) => book)).toEqual(
		sefarim.map(({ name, helek, perekFrom, perekTo }) => ({
			name,
			helek,
			perekFrom,
			perekTo,
		})),
	);
});
it("retains every chapter's learning dates in canonical order", () => {
	expect(catalog.schedule).toEqual(
		getAllPerakim().map(({ date, perekId }) => ({ perekId, date })),
	);
});
it("keeps scripture and timing data outside the small browser catalog", () => {
	const bytes = readFileSync(
		resolve(__dirname, "../../../src/data/db/client-catalog.generated.json"),
	);
	expect(bytes.length).toBeLessThan(128 * 1024);
	expect(bytes.toString()).not.toMatch(
		/pesukim|segments|recordingTimeFrame|audioUrl/,
	);
});

it("retains citation volumes and their exact chapter ranges", () => {
	expect(catalog.volumes).toEqual(
		sefarim.flatMap((sefer) =>
			("perakim" in sefer ? [sefer] : sefer.additionals).map(
				({ name, perekFrom, perakim }) => ({
					name,
					perekFrom,
					perekTo: perekFrom + perakim.length - 1,
				}),
			),
		),
	);
});

it("reader assets retain every canonical field, including approved timing precision", () => {
	for (const [index, book] of catalog.books.entries()) {
		// The public URL keeps the raw payload hash; the served file is that
		// same name under public/generated/sefarim holding Brotli bytes that
		// next.config.mjs labels Content-Encoding: br (#3095).
		const file = resolve(
			__dirname,
			"../../../public/generated/sefarim",
			basename(book.file),
		);
		expect(
			JSON.parse(brotliDecompressSync(readFileSync(file)).toString("utf8")),
		).toEqual(sefarim[index]);
	}
});
