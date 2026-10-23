const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const out = execFileSync(
	"rg",
	["-n", "catch \\((Exception|System\\.Exception)", "app", "-g", "*.cs", "--no-heading"],
	{ encoding: "utf8" },
);
const hits = out.trim().split("\n");
let justified = 0;
const bare = [];
for (const hit of hits) {
	const m = hit.match(/^([^:]+):(\d+):(.*)$/);
	if (!m) continue;
	const [, file, ln, text] = m;
	const src = readFileSync(file, "utf8").split("\n");
	const i = Number(ln) - 1;
	const context = `${src[i - 1] || ""}\n${text}`;
	if (/NOSONAR|pragma warning disable|catch \w+ [a-zA-Z_]/.test(text) === false) {
		// NOSONAR on same or previous line counts as justified boundary
	}
	if (/NOSONAR/.test(context)) justified++;
	else bare.push(`${file}:${ln}: ${text.trim()}`);
}
console.log(`total ${hits.length} justified ${justified} bare ${bare.length}`);
console.log(bare.join("\n"));
