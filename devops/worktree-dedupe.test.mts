import assert from "node:assert/strict";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	mkdtempSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dedupe, isDedupePath, parseDays } from "./worktree-dedupe.mts";

const OLD = new Date(Date.now() - 48 * 60 * 60 * 1000); // settled

function makeTree(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "dedupe-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function settled(dir: string, rel: string, content: string | Buffer): string {
	const p = join(dir, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, content);
	utimesSync(p, OLD, OLD);
	return p;
}

const CLI = {
	repos: [],
	worktrees: [],
	apply: true,
	minBytes: 8,
	settleMs: 60_000,
	maxFiles: 100_000,
};

describe("isDedupePath", () => {
	it("accepts only node_modules payload", () => {
		for (const p of [
			"web/bible-on-site/node_modules/lodash/index.js",
			"node_modules/.bin/x",
		])
			assert.ok(isDedupePath(p), p);
	});
	it("rejects in-place-rewritten payloads, source, secrets and build outputs", () => {
		for (const p of [
			"app/BibleOnSite/Platforms/Windows/ExtensionPacks/pack.bin",
			"web/bible-on-site/public/generated/img.png",
			"web/bible-on-site/src/data/db/dump.tanah_view.json.br",
			"app/AssetPacks/x.perushim_notes.sqlite",
			"src/index.ts",
			".env",
			"website/.next/server.js",
			"app/bin/Debug/app.dll",
			"notes.md",
		])
			assert.ok(!isDedupePath(p), p);
	});
});

describe("dedupe", () => {
	it("hardlinks identical settled files across worktrees", () => {
		const { dir, cleanup } = makeTree();
		try {
			const payload = Buffer.alloc(64 * 1024, "x");
			const a = settled(dir, "wt1/node_modules/pkg/blob.bin", payload);
			const b = settled(dir, "wt2/node_modules/pkg/blob.bin", payload);
			const r = dedupe([join(dir, "wt1"), join(dir, "wt2")], CLI);
			assert.equal(r.linked, 1);
			assert.equal(r.reclaimedBytes, payload.length);
			assert.equal(statSync(a).ino, statSync(b).ino);
		} finally {
			cleanup();
		}
	});
	it("dry-run counts links without changing files", () => {
		const { dir, cleanup } = makeTree();
		try {
			const payload = Buffer.alloc(32 * 1024, "y");
			const a = settled(dir, "wt1/node_modules/p/x", payload);
			const b = settled(dir, "wt2/node_modules/p/x", payload);
			const r = dedupe([join(dir, "wt1"), join(dir, "wt2")], {
				...CLI,
				apply: false,
			});
			assert.equal(r.linked, 1);
			assert.notEqual(statSync(a).ino, statSync(b).ino);
		} finally {
			cleanup();
		}
	});
	it("skips fresh, small and same-size-different-content files", () => {
		const { dir, cleanup } = makeTree();
		try {
			const payload = Buffer.alloc(64 * 1024, "z");
			const other = Buffer.alloc(64 * 1024, "w");
			settled(dir, "wt1/node_modules/p/x", payload);
			mkdirSync(join(dir, "wt2/node_modules"), { recursive: true });
			writeFileSync(join(dir, "wt2/node_modules/x"), payload); // fresh
			settled(dir, "wt3/node_modules/p/x", other); // same size, diff content
			settled(dir, "wt4/src/x", payload); // not a payload path
			const r = dedupe(
				["wt1", "wt2", "wt3", "wt4"].map((w) => join(dir, w)),
				CLI,
			);
			assert.equal(r.linked, 0);
			assert.equal(r.errors.length, 0);
		} finally {
			cleanup();
		}
	});
	it("relinks every alias of a pre-linked donor inode and reclaims it once", () => {
		const { dir, cleanup } = makeTree();
		try {
			const payload = Buffer.alloc(64 * 1024, "q");
			const a = settled(dir, "wt1/node_modules/p/x", payload);
			const b = settled(dir, "wt2/node_modules/p/x", payload);
			const c = join(dir, "wt2/node_modules/p/y");
			linkSync(b, c); // b and c already share an inode
			utimesSync(c, OLD, OLD);
			const r = dedupe([join(dir, "wt1"), join(dir, "wt2")], CLI);
			assert.equal(r.linked, 2); // both aliases leave the donor inode
			assert.equal(r.reclaimedBytes, payload.length); // reclaimed once
			assert.equal(statSync(a).ino, statSync(c).ino);
		} finally {
			cleanup();
		}
	});
	it("drops a drifted alias instead of hashing its replacement content", () => {
		const { dir, cleanup } = makeTree();
		try {
			const contentA = Buffer.alloc(64 * 1024, "a");
			const contentB = Buffer.alloc(64 * 1024, "b");
			settled(dir, "wt1/node_modules/p/x", contentB); // canonical = B
			const b = settled(dir, "wt2/node_modules/p/x", contentA);
			const c = join(dir, "wt2/node_modules/p/y");
			linkSync(b, c); // b,c share inode holding A
			utimesSync(c, OLD, OLD);
			// installer replaces b's path with B's content: unlink+write
			// gives a new inode while c keeps the original inode+content A
			unlinkSync(b);
			writeFileSync(b, contentB);
			utimesSync(b, OLD, OLD); // forged old mtime; inode still differs
			const inoC = statSync(c).ino;
			const r = dedupe([join(dir, "wt1"), join(dir, "wt2")], CLI);
			// b now holds B's content, so relinking it to canonical B is
			// legitimate; the invariant is that c — still holding A —
			// must never be relinked to mismatched bytes.
			assert.equal(r.linked, 1);
			assert.equal(statSync(c).ino, inoC);
			assert.equal(readFileSync(c).toString(), contentA.toString());
		} finally {
			cleanup();
		}
	});
	it("is idempotent on a second pass", () => {
		const { dir, cleanup } = makeTree();
		try {
			const payload = Buffer.alloc(64 * 1024, "q");
			const a = settled(dir, "wt1/node_modules/p/x", payload);
			const b = settled(dir, "wt2/node_modules/p/x", payload);
			const r1 = dedupe([join(dir, "wt1"), join(dir, "wt2")], CLI);
			assert.equal(r1.linked, 1);
			const r2 = dedupe([join(dir, "wt1"), join(dir, "wt2")], CLI);
			assert.equal(r2.linked, 0); // same inode now
			assert.equal(statSync(a).ino, statSync(b).ino);
		} finally {
			cleanup();
		}
	});
});

describe("parseDays", () => {
	it("rejects blank and non-numeric input", () => {
		for (const v of ["", "  ", "abc", "14d"]) {
			assert.throws(() => parseDays("--min-kb", v), /--min-kb/);
		}
		assert.equal(parseDays("--min-kb", "10"), 10);
	});
});
