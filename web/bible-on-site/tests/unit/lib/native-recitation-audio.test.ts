/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

test("the shipped native PCM decoder inserts silence only between exact sample ranges", async () => {
	const document = new DOMParser().parseFromString(
		readFileSync(
			resolve(
				process.cwd(),
				"../../app/BibleOnSite/Resources/Raw/recitation-audio.html",
			),
			"utf8",
		),
		"text/html",
	);
	const context = {
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
		recitationMpeg: {
			MPEGDecoder: class {
				ready = Promise.resolve();
				free() {}
				decode() {
					return {
						errors: [],
						samplesDecoded: 1000,
						sampleRate: 1000,
						channelData: [
							Float32Array.from({ length: 1000 }, (_, i) => (i + 1) / 2000),
						],
					};
				}
			},
		},
	};
	const script = document.querySelector("script")?.textContent;
	expect(script).toBeTruthy();
	runInNewContext(script ?? "", context);
	const api = Reflect.get(context, "recitation");
	api.load("AA==");
	await Promise.resolve();
	await Promise.resolve();
	expect(api.status().state).toBe("ready");
	const ranges = [
		{ start: 100, end: 200 },
		{ start: 400, end: 500 },
	];
	api.clip(ranges, 300);
	const wave = Buffer.from(api.chunk(0, 49152).data, "base64");
	expect(wave.readUInt32LE(40)).toBe(500 * 2);
	expect(wave.readInt16LE(44)).toBe(Math.round((101 / 2000) * 32768));
	expect(wave.readInt16LE(44 + 99 * 2)).toBe(Math.round((200 / 2000) * 32768));
	expect(
		wave.subarray(44 + 100 * 2, 44 + 400 * 2).every((byte) => byte === 0),
	).toBe(true);
	expect(wave.readInt16LE(44 + 400 * 2)).toBe(Math.round((401 / 2000) * 32768));
	expect(wave.readInt16LE(wave.length - 2)).toBe(
		Math.round((500 / 2000) * 32768),
	);
	api.clip(ranges);
	expect(Buffer.from(api.chunk(0, 49152).data, "base64").readUInt32LE(40)).toBe(
		200 * 2,
	);
	expect(() => api.clip(ranges, -1)).toThrow("pause");
	expect(() => api.clip(ranges, Number.NaN)).toThrow("pause");
});
