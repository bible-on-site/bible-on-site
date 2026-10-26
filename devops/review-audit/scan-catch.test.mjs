import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "scan-catch.cjs");

/** Fixture repo tree exercising every rule branch of the generic-catch gate. */
const FILES = {
	// Red: unannotated generic catches in production code.
	"app/BibleOnSite/Pages/Red.cs": [
		"class Red {",
		"    private async void OnTapped()",
		"    {",
		"        try { await Go(); }",
		"        catch (Exception ex) { Log(ex); }   // async-void boundary, no reason",
		"    }",
		"    private void Bare()",
		"    {",
		"        try { Go(); }",
		"        catch { Log(); throw; }",
		"    }",
		"    private void Cond()",
		"    {",
		"        try { Go(); }",
		"        catch (Exception ex) when (retries < 3) { Log(ex); throw; }",
		"    }",
		"}",
	],
	// Green: the documented pragma+NOSONAR pair.
	"app/BibleOnSite/Pages/Green.cs": [
		"class Green {",
		"    private async void OnTapped()",
		"    {",
		"        try { await Go(); }",
		"        #pragma warning disable S2221 // Deliberate failure boundary: nav failure must not crash",
		"        catch (Exception ex) //NOSONAR — nav failure must not crash the page.",
		"        {",
		"            #pragma warning restore S2221",
		"            Log(ex);",
		"        }",
		"    }",
		"}",
	],
	// Green: near-misses — narrow filters, typed catches, masked mentions.
	"app/BibleOnSite/Services/Narrow.cs": [
		"class Narrow {",
		"    private async void Probe()",
		"    {",
		"        try { await Go(); }",
		"        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }",
		"        catch (Exception ex) when (ex is not GraphQLException) { Log(ex); throw; }",
		"        catch (Exception ex) when (ex.GetType().Name == \"X\") { }",
		"        catch (IOException ex) { }",
		"    }",
		"    // catch (Exception) inside a comment is not a site",
		"    private string doc = \"catch (Exception ex) inside a literal is not a site\";",
		"    private string verb = @\"catch (Exception ex) inside a verbatim literal\";",
		"}",
	],
	// NOSONAR-only justification (bare catch precedent: Build.Run.cs).
	"app/devops/Probe.cs": [
		"class Probe {",
		"    private static bool Adb()",
		"    {",
		"        try { return Probe(); }",
		"        catch { return false; } //NOSONAR — any probe failure counts as failed.",
		"    }",
		"}",
	],
	// Out of scope: test assemblies carry no annotation by audit verdict.
	"app/BibleOnSite.Tests/Fixtures/Fixture.cs": [
		"class Fixture {",
		"    private void Kill()",
		"    {",
		"        try { proc.Kill(); }",
		"        catch (Exception ex) { Log(ex); }",
		"    }",
		"}",
	],
};

let root;
before(() => {
	root = mkdtempSync(join(tmpdir(), "scan-catch-"));
	for (const [rel, lines] of Object.entries(FILES)) {
		const abs = join(root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, `${lines.join("\n")}\n`);
	}
});
after(() => rmSync(root, { recursive: true, force: true }));

function run(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		env: { ...process.env, SCAN_CATCH_ROOT: root },
		encoding: "utf8",
	});
}

describe("scan-catch gate mode", () => {
	it("flags every unannotated generic catch in a file", () => {
		const r = run(["app/BibleOnSite/Pages/Red.cs"]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /Red\.cs:5:/); // catch (Exception ex)
		assert.match(r.stderr, /Red\.cs:10:/); // bare catch
		assert.match(r.stderr, /Red\.cs:15:/); // when (retries < 3)
	});

	it("passes the pragma+NOSONAR pair convention", () => {
		const r = run(["app/BibleOnSite/Pages/Green.cs"]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /0 unjustified/);
	});

	it("passes type-narrowing filters, typed catches and masked mentions", () => {
		const r = run(["app/BibleOnSite/Services/Narrow.cs"]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});

	it("passes NOSONAR-only justification on a bare catch", () => {
		const r = run(["app/devops/Probe.cs"]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});

	it("skips test-assembly files", () => {
		const r = run(["app/BibleOnSite.Tests/Fixtures/Fixture.cs"]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /0 file\(s\) checked/);
	});
});

describe("scan-catch audit mode", () => {
	it("reports all unjustified sites across the in-scope tree", () => {
		const r = run([]);
		assert.equal(r.status, 1);
		assert.match(r.stdout, /4 file\(s\) checked/); // Fixture.cs excluded
		assert.match(r.stdout, /3 unjustified/);
		assert.match(r.stderr, /Red\.cs:5:/);
	});
});
