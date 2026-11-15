/** Audit the exact Android bundle shipped to Play for #3309 size regressions. */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { ZipFile } from "node:zlib";

export const SEARCH_INDEX = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite";
export const BASE_MODULE_MAX_COMPRESSED = 55 * 1024 * 1024;
export const SEARCH_INDEX_MAX_UNCOMPRESSED = 160 * 1024 * 1024;
const PERUSHIM_PACK = "perushim_notes";
const BASE_PAYLOAD_ALLOWLIST = new Set([
	"sefaria-dump-5784-sivan-4.tanah_view.sqlite",
	"sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
]);
const PAYLOAD_SUFFIXES = [".sqlite", ".zip", ".ogg", ".mp3", ".aac", ".wav"];
const tokens = (mode) => [Buffer.from(mode), Buffer.from(mode, "utf16le")];
const ON_DEMAND = tokens("on-demand");
const OTHER_DELIVERY = [...tokens("install-time"), ...tokens("fast-follow")];

function auditSearchIndex(entry) {
	if (entry.size > SEARCH_INDEX_MAX_UNCOMPRESSED) {
		throw new Error(`${SEARCH_INDEX} exceeds the 160 MB uncompressed budget; store note identity instead of duplicated text (#3309)`);
	}
	const index = new DatabaseSync(":memory:");
	let columns;
	let documents;
	try {
		index.deserialize(entry.contentSync({ maxSize: SEARCH_INDEX_MAX_UNCOMPRESSED }));
		columns = index.prepare("PRAGMA table_info(notes_documents)").all().map((row) => row.name);
		documents = index.prepare("SELECT COUNT(*) AS count FROM notes_documents").get().count;
	} finally {
		index.close();
	}
	if (columns.includes("Text")) {
		throw new Error(`${SEARCH_INDEX} still stores the note text inside notes_documents; regenerate the indexed perushim artifact (#3309)`);
	}
	const required = ["PerekId", "PasukNum", "PerushId", "SeferId", "NoteIdx"];
	if (!required.every((column) => columns.includes(column)) || documents === 0) {
		throw new Error(`${SEARCH_INDEX} is not a usable slim index (columns: ${columns.join(", ")}, rows: ${documents})`);
	}
	return { uncompressedBytes: entry.size, notesDocumentColumns: columns.sort(), notesDocumentRows: documents };
}

/** Only the central directory and the inspected manifests/index are read. */
export function audit(packagePath) {
	const archive = ZipFile.openSync(packagePath);
	try {
		const entries = new Map(archive.entriesSync());
		const modules = Object.create(null);
		for (const [name, entry] of entries) {
			if (name.endsWith("/")) continue;
			const moduleName = name.split("/", 1)[0];
			const module = modules[moduleName] ??= { files: 0, compressedBytes: 0, uncompressedBytes: 0 };
			module.files++;
			module.compressedBytes += entry.compressedSize;
			module.uncompressedBytes += entry.size;
		}
		if (!modules.base) throw new Error("AAB has no base module");
		if (modules.base.compressedBytes > BASE_MODULE_MAX_COMPRESSED) {
			throw new Error("base module exceeds its 55 MB compressed budget (v5.1.19 baseline: ~43.4 MB)");
		}
		const leaks = [...entries.keys()].filter((name) => name.startsWith("base/")
			&& PAYLOAD_SUFFIXES.some((suffix) => posix.basename(name).toLowerCase().endsWith(suffix))
			&& !BASE_PAYLOAD_ALLOWLIST.has(posix.basename(name)));
		if (leaks.length) throw new Error(`Optional payloads leaked into the base module: ${leaks.sort().join(", ")}`);
		const packs = Object.keys(modules).filter((name) => name !== "base" && (
			name === PERUSHIM_PACK || name.startsWith("recitation_") || entries.has(`${name}/manifest/AndroidManifest.xml`)));
		if (!packs.includes(PERUSHIM_PACK)) throw new Error(`AAB is missing the ${PERUSHIM_PACK} asset pack`);
		if (!packs.some((name) => name.startsWith("recitation_"))) throw new Error("AAB contains no recitation_* asset packs");
		for (const pack of packs) {
			const entry = entries.get(`${pack}/manifest/AndroidManifest.xml`);
			if (!entry) throw new Error(`asset pack ${pack} lacks a manifest`);
			const manifest = entry.contentSync();
			if (!ON_DEMAND.some((token) => manifest.includes(token)) || OTHER_DELIVERY.some((token) => manifest.includes(token))) {
				throw new Error(`asset pack ${pack} is not declared on-demand; its download would count toward the listed app size`);
			}
		}
		const index = entries.get(`${PERUSHIM_PACK}/assets/${SEARCH_INDEX}`);
		if (!index) throw new Error(`${PERUSHIM_PACK} lacks its delivered search index ${SEARCH_INDEX}; commentary search stays unavailable`);
		return { package: basename(packagePath), modules, searchIndex: auditSearchIndex(index) };
	} finally {
		archive.closeSync();
	}
}

export function main(argv = process.argv.slice(2), output = console) {
	try {
		const { values } = parseArgs({ args: argv, options: {
			package: { type: "string" }, "json-out": { type: "string" }, help: { type: "boolean" },
		} });
		if (values.help) {
			output.log("Audit Android bundle sizes and on-demand packs: --package app.aab [--json-out report.json]");
			return 0;
		}
		if (!values.package) throw new Error("--package is required");
		const report = audit(values.package);
		if (values["json-out"]) {
			mkdirSync(dirname(values["json-out"]), { recursive: true });
			writeFileSync(values["json-out"], `${JSON.stringify(report, null, 2)}\n`);
		}
		for (const [name, module] of Object.entries(report.modules).sort((a, b) => b[1].compressedBytes - a[1].compressedBytes)) {
			const mb = 1024 * 1024;
			output.log(`${name}: ${(module.compressedBytes / mb).toFixed(1)} MB compressed, ${(module.uncompressedBytes / mb).toFixed(1)} MB uncompressed, ${module.files} files`);
		}
		return 0;
	} catch (error) {
		output.error(`::error::${error.message}`);
		return 1;
	}
}

if (import.meta.main) process.exitCode = main();
