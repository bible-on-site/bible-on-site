import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/auto-create-pr.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");
const step = workflow.split("      - name: Create Pull Request\n")[1];
assert.ok(step, "Exercise the actual PR creation step");
const script = step
	.split("        run: |\n")[1]
	.split("\n")
	.map((line) => {
		assert.ok(!line.trim() || line.startsWith("          "));
		return line.slice(10);
	})
	.join("\n");
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
  [ "$1 $2 $3 $4 $5" = "pr list --base master --head" ] || return 99
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
		const result = spawnSync(shell, ["-e", "-o", "pipefail", "-c", mock + script], {
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
		});
		assert.equal(result.status, expected, result.stderr);
	});
}
