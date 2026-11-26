import { readFile, writeFile } from "node:fs/promises";
import { packScriptureCorpus } from "../src/server/tanahpedia/contribution-scripture-occurrences.server";

const [source, output] = process.argv.slice(2);
if (!source || !output) {
	throw new Error(
		"Supply the canonical Scripture input and the packed output path",
	);
}
const corpus = JSON.parse(await readFile(source, "utf8"));
const chapters = packScriptureCorpus(corpus);
if (
	chapters.length !== 929 ||
	new Set(chapters.map((chapter) => chapter.perekId)).size !== 929
) {
	throw new Error("Expected one complete canonical Tanakh");
}
await writeFile(output, JSON.stringify(chapters));
