import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ZipEntry, createZipArchiveSync } from "node:zlib";
import { audit, main, BASE_MODULE_MAX_COMPRESSED, SEARCH_INDEX, SEARCH_INDEX_MAX_UNCOMPRESSED } from "./audit-android-aab-size.mjs";

function searchIndex({ slim = true, empty = false, missingIdentity = false } = {}) {
	const db = new DatabaseSync(":memory:");
	try {
		const columns = slim ? "NoteIdx INTEGER" : "Text TEXT";
		db.exec(`CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER, ${columns})`);
		if (!empty) db.exec("INSERT INTO notes_documents VALUES (1,1,1,7,1,0)");
		if (missingIdentity) db.exec("ALTER TABLE notes_documents DROP COLUMN PasukNum");
		return db.serialize();
	} finally {
		db.close();
	}
}

function fixture(t, options = {}) {
	const root = mkdtempSync(join(tmpdir(), "aab-audit-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const packagePath = join(root, "app.aab");
	const entries = [];
	const add = (name, data, method = "deflate") => entries.push(ZipEntry.createSync(name, Buffer.from(data), { method }));
	if (options.base !== false) {
		add("base/manifest/AndroidManifest.xml", "manifest");
		add("base/assets/sefaria-dump-5784-sivan-4.tanah_view.sqlite", "tanah");
		add("base/assets/sefaria-dump-5784-sivan-4.perushim_catalog.sqlite", "catalog");
	}
	const manifest = Buffer.from(options.delivery ?? "on-demand", options.encoding ?? "utf8");
	if (options.perushim !== false) {
		if (options.manifest !== false) add("perushim_notes/manifest/AndroidManifest.xml", manifest);
		add("perushim_notes/assets/sefaria-dump-5784-sivan-4.perushim_notes.sqlite", "notes");
		if (options.index !== false) add(`perushim_notes/assets/${SEARCH_INDEX}`, options.indexBuffer ?? searchIndex(options));
	}
	for (let sefer = 1; sefer <= (options.recitations ?? 2); sefer++) {
		add(`recitation_${sefer}/manifest/AndroidManifest.xml`, manifest);
		add(`recitation_${sefer}/assets/book.zip`, "audio");
	}
	for (const entry of options.extra ?? []) add(...entry);
	writeFileSync(packagePath, Buffer.concat([...createZipArchiveSync(entries)]));
	return { root, packagePath };
}

test("reports module byte sizes and the slim index schema", (t) => {
	const { packagePath } = fixture(t);
	const report = audit(packagePath);
	assert.equal(report.package, "app.aab");
	assert.deepEqual(Object.keys(report.modules).sort(), ["base", "perushim_notes", "recitation_1", "recitation_2"]);
	assert.equal(report.searchIndex.notesDocumentRows, 1);
	assert.ok(report.searchIndex.notesDocumentColumns.includes("NoteIdx"));
	assert.ok(!report.searchIndex.notesDocumentColumns.includes("Text"));
	assert.ok(report.modules.perushim_notes.uncompressedBytes > report.modules.perushim_notes.compressedBytes);
});

for (const [name, options, error] of [
	["missing base module", { base: false }, /no base module/],
	["missing commentary pack", { perushim: false }, /missing the perushim_notes/],
	["missing recitation packs", { recitations: 0 }, /no recitation_/],
	["missing pack manifest", { manifest: false }, /lacks a manifest/],
	["install-time delivery", { delivery: "install-time" }, /not declared on-demand/],
	["fast-follow delivery", { delivery: "fast-follow" }, /not declared on-demand/],
	["ambiguous delivery", { delivery: "on-demand install-time" }, /not declared on-demand/],
	["missing search index", { index: false }, /lacks its delivered search index/],
	["legacy duplicated text", { slim: false }, /still stores the note text/],
	["empty search index", { empty: true }, /not a usable slim index/],
	["incomplete note identity", { missingIdentity: true }, /not a usable slim index/],
	["corrupt SQLite payload", { indexBuffer: Buffer.from("not sqlite") }, /database/],
	["commentary leaked into base", { extra: [[`base/assets/${SEARCH_INDEX}`, "fat"]] }, /leaked into the base module/],
	["new pack delivered at install time", { extra: [["future_pack/manifest/AndroidManifest.xml", "install-time"]] }, /future_pack is not declared on-demand/],
]) {
	test(`rejects ${name}`, (t) => {
		const { packagePath } = fixture(t, options);
		assert.throws(() => audit(packagePath), error);
	});
}

test("accepts compiled manifests whose names use UTF-16", (t) => {
	assert.equal(audit(fixture(t, { encoding: "utf16le" }).packagePath).searchIndex.notesDocumentRows, 1);
});

test("rejects a base module above the compressed budget", (t) => {
	const { packagePath } = fixture(t, { extra: [["base/assets/bloat.bin", Buffer.alloc(BASE_MODULE_MAX_COMPRESSED + 1), "store"]] });
	assert.throws(() => audit(packagePath), /55 MB compressed budget/);
});

test("rejects an oversized index before deserialization", (t) => {
	const { packagePath } = fixture(t, { indexBuffer: Buffer.alloc(SEARCH_INDEX_MAX_UNCOMPRESSED + 1) });
	assert.throws(() => audit(packagePath), /160 MB uncompressed budget/);
});

test("CLI writes a machine-readable breakdown", (t) => {
	const { packagePath, root } = fixture(t);
	const path = join(root, "reports", "report.json");
	const messages = [];
	assert.equal(main(["--package", packagePath, "--json-out", path], { log: (text) => messages.push(text) }), 0);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).searchIndex.notesDocumentRows, 1);
	assert.ok(messages.some((text) => text.startsWith("base:")));
});

test("CLI fails on malformed, missing, or mispackaged bundles", (t) => {
	const { packagePath } = fixture(t, { slim: false });
	const errors = [];
	const output = { error: (text) => errors.push(text) };
	assert.equal(main(["--package", packagePath], output), 1);
	writeFileSync(packagePath, "broken zip");
	assert.equal(main(["--package", packagePath], output), 1);
	assert.equal(main(["--package", `${packagePath}.missing`], output), 1);
	assert.equal(main([], output), 1);
	assert.equal(main(["--unknown"], output), 1);
	assert.equal(errors.length, 5);
});

test("CLI explains its arguments", () => {
	let message;
	assert.equal(main(["--help"], { log: (text) => { message = text; } }), 0);
	assert.match(message, /--package/);
});
