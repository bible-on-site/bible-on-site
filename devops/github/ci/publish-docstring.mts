import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PUBLISH_SOURCE_PATH = "data/annotations/publish.py";
export const DOCSTRING_PYTHON =
	process.platform === "win32" ? "python" : "python3";

/** Read only immutable Git blobs; missing evidence keeps normal delivery. */
export function isPublishDocstringOnlyChange({
	baseSha,
	headSha,
	cwd,
	python = DOCSTRING_PYTHON,
}: {
	baseSha: string;
	headSha: string;
	cwd?: string;
	python?: string;
}): boolean {
	const git = (...args: string[]) => execFileSync("git", args, { cwd });
	const readBlob = (sha: string) => {
		const entries = git("ls-tree", "-z", sha, "--", PUBLISH_SOURCE_PATH)
			.toString("utf8")
			.split("\0");
		if (entries.length !== 2 || entries[1] !== "") return null;
		const tab = entries[0].indexOf("\t");
		if (tab < 0 || entries[0].slice(tab + 1) !== PUBLISH_SOURCE_PATH)
			return null;
		const [mode, type, blob] = entries[0].slice(0, tab).split(" ");
		if (!["100644", "100755"].includes(mode) || type !== "blob" || !blob)
			return null;
		return { mode, bytes: git("cat-file", "blob", blob) };
	};
	try {
		const before = readBlob(baseSha);
		const after = readBlob(headSha);
		if (!before || !after || before.mode !== after.mode) return false;
		const result = execFileSync(
			python,
			[
				"-I",
				"-S",
				fileURLToPath(new URL("./publish-docstring-proof.py", import.meta.url)),
			],
			{
				cwd,
				input: JSON.stringify({
					base: before.bytes.toString("base64"),
					head: after.bytes.toString("base64"),
				}),
				encoding: "utf8",
			},
		);
		return result.trim() === "true";
	} catch {
		// Git/interpreter/parser failures must never weaken the existing release gate.
		console.warn(
			"Annotation docstring proof unavailable; retaining normal data delivery.",
		);
		return false;
	}
}
