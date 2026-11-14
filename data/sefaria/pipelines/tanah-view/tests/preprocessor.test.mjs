import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Execute the exact preprocessing function used by the Mongo aggregation.
const stage = JSON.parse(readFileSync(new URL("../src/stages/project_inner.json", import.meta.url), "utf8"));
const body = stage.perakim.$map.in.pesukim.$map.in.segments.$let.vars.processedPasuk.$function.body;
const preprocess = runInNewContext(`(${body})`);

test("editorial repetitions do not turn the final word into orphan qri", () => {
	assert.equal(preprocess("עַד־מְאֹֽד׃<br><small>[השיבנו יהוה אליך ונשובה]</small>"), "עַד־ מְאֹֽד׃");
	assert.equal(preprocess("וְאִם־רָֽע׃<br><small>[סוף דבר הכל נשמע]</small>"), "וְאִם־ רָֽע׃");
});

test("inline formatting preserves scripture and genuine qri brackets", () => {
	assert.equal(preprocess("<b>בְּרֵאשִׁית</b> [קרי אחד] אֶת־הָאָרֶץ"), "בְּרֵאשִׁית [קרי_אחד] אֶת־ הָאָרֶץ");
});
