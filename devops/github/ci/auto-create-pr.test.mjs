import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/auto-create-pr.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");
function stepScript(name) {
	const step = workflow
		.split(`      - name: ${name}\n`)[1]
		?.split("      - name: ")[0];
	assert.ok(step, `Exercise the actual ${name} step`);
	return step
		.split("        run: |\n")[1]
		.split("\n")
		.map((line) => {
			assert.ok(!line.trim() || line.startsWith("          "));
			return line.slice(10);
		})
		.join("\n");
}
const script = stepScript("Create Pull Request");
const lookup = stepScript("Check if PR exists");
const mock = `
gh() {
  if [ "$1 $2" = "pr create" ]; then
    [ "$3" = "--title" ] && [ "$4" = "$PR_TITLE" ] || return 99
    [ "$5 $6 $7 $8 $9" = "--body-file - --base master --head" ] || return 99
    [ "\${10}" = "$PR_HEAD" ] || return 99
    body=$(cat)
    [ "$body" = "$PR_BODY" ] || return 99
    return "$CREATE_EXIT"
  fi
  [ "$1 $2 $3 $4 $5" = "pr list --state open --head" ] || return 99
  [ "$6" = "$PR_HEAD" ] || return 99
  [ "$LIST_EXIT" -eq 0 ] || return "$LIST_EXIT"
  printf '%s\\n' "$EXISTING"
}
`;
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

for (const [name, create, existing, list, expected] of [
	["new PR succeeds", 0, 0, 0, 0],
	["concurrently created PR succeeds", 1, 1, 0, 0],
	["creation failure with no PR remains a failure", 1, 0, 0, 1],
	["lookup failure remains a failure", 1, 1, 2, 2],
]) {
	test(name, () => {
		const result = spawnSync(
			shell,
			["-e", "-o", "pipefail", "-c", mock + script],
			{
				encoding: "utf8",
				env: {
					...process.env,
					CREATE_EXIT: String(create),
					EXISTING: String(existing),
					LIST_EXIT: String(list),
					PR_HEAD: "codex/test-$literal",
					PR_TITLE: "Literal title $(unexecuted)",
					PR_BODY: "First line\nSecond line with `literal` and $text",
				},
			},
		);
		assert.equal(result.status, expected, result.stderr);
	});
}

for (const existing of [0, 1]) {
	test(
		existing
			? "existing stacked PR skips duplicate creation"
			: "a branch with no open PR creates one",
		() => {
			const directory = mkdtempSync(join(tmpdir(), "auto-create-pr-"));
			const output = join(directory, "github-output");
			try {
				const result = spawnSync(
					shell,
					[
						"-e",
						"-o",
						"pipefail",
						"-c",
						mock +
							lookup +
							'\nif [ "$PR_EXISTS" -eq 0 ]; then\n' +
							script +
							"\nfi",
					],
					{
						encoding: "utf8",
						env: {
							...process.env,
							CREATE_EXIT: existing ? "99" : "0",
							EXISTING: String(existing),
							LIST_EXIT: "0",
							GITHUB_OUTPUT: output.split("\\").join("/"),
							PR_HEAD: "codex/stacked-$literal",
							PR_TITLE: "Stacked branch",
							PR_BODY: "Body",
						},
					},
				);
				assert.equal(result.status, 0, result.stderr);
				assert.equal(readFileSync(output, "utf8").trim(), `exists=${existing}`);
			} finally {
				assert.ok(directory.startsWith(join(tmpdir(), "auto-create-pr-")));
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
}
