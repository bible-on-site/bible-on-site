const { readFileSync, writeFileSync } = require("node:fs");

const lines = readFileSync(process.argv[2], "utf8").trim().split("\n");
const out = [];
for (const l of lines) {
	const m = l.match(/^(.*\.cs)(\d+) ?$/);
	if (!m) continue;
	const file = m[1].replace(/^.*issue-2114-lint-audit\\/, "");
	const ln = Number(m[2]);
	const src = readFileSync(file, "utf8").split("\n");
	out.push(`=== ${file}:${ln} ===`);
	for (let i = ln - 2; i < ln + 8 && i < src.length; i++) {
		out.push(`${i + 1}|${src[i]}`);
	}
}
writeFileSync(process.argv[3], out.join("\n"));
console.log(`${out.length} lines`);
