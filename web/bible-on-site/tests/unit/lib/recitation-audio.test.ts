/** @jest-environment node */
import { createHash, webcrypto } from "node:crypto";
import { RecitationAudio } from "@/lib/recitation-audio";

const bytes = new Uint8Array([1, 2, 3]).buffer;
const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
let audioClock = 10;
const sources: {
	start: jest.Mock;
	stop: jest.Mock;
	disconnect: jest.Mock;
	onended: null | (() => void);
}[] = [];
const decode = jest.fn();
const free = jest.fn();
const pcm = {
	channelData: [new Float32Array(1000)],
	samplesDecoded: 1000,
	sampleRate: 100,
	errors: [],
};
jest.mock("mpg123-decoder", () => ({
	MPEGDecoderWebWorker: jest
		.fn()
		.mockImplementation(() => ({ ready: Promise.resolve(), decode, free })),
}));
const gain = { gain: { value: 1 }, connect: jest.fn(), disconnect: jest.fn() };
const close = jest.fn();
const resume = jest.fn();
const originalContext = global.AudioContext;
const originalFetch = global.fetch;

beforeEach(() => {
	sources.length = 0;
	audioClock = 10;
	decode.mockResolvedValue(pcm);
	free.mockResolvedValue(undefined);
	close.mockResolvedValue(undefined);
	resume.mockResolvedValue(undefined);
	Object.defineProperty(global, "crypto", {
		value: webcrypto,
		configurable: true,
	});
	global.fetch = jest
		.fn()
		.mockImplementation(
			async () =>
				new Response(bytes.slice(0), { headers: { "content-length": "3" } }),
		);
	global.AudioContext = jest.fn().mockImplementation(() => ({
		get currentTime() {
			return audioClock;
		},
		createBuffer: () => ({
			duration: 10,
			getChannelData: () => new Float32Array(1000),
		}),
		resume,
		close,
		destination: {},
		createGain: () => gain,
		createBufferSource: () => {
			const source = {
				start: jest.fn(),
				playbackRate: { value: 1 },
				stop: jest.fn(),
				connect: jest.fn(),
				disconnect: jest.fn(),
				onended: null,
			};
			sources.push(source);
			return source;
		},
	}));
});
afterEach(() => {
	global.AudioContext = originalContext;
	global.fetch = originalFetch;
});

test("uses original timestamps and audio-clock duration, reuses decoded chapter", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	await player.play(1442, 1983, ended);
	expect(sources[0].start).toHaveBeenCalledWith(0, 1442 / 1000, 541 / 1000);
	await player.play(2144, 2925, ended);
	expect(sources[0].stop).toHaveBeenCalled();
	expect(sources[1].start).toHaveBeenCalledWith(0, 2.144, 0.781);
	expect(decode).toHaveBeenCalledTimes(1);
	expect(global.fetch).toHaveBeenCalledTimes(1);
	sources[1].onended?.();
	expect(ended).toHaveBeenCalledTimes(1);
	player.dispose();
	expect(close).toHaveBeenCalledTimes(1);
});

test("rejects changed audio before decoding or playback", async () => {
	const player = new RecitationAudio("/audio.mp3", "0".repeat(64));
	await expect(player.play(100, 200, jest.fn())).rejects.toThrow("differs");
	expect(decode).not.toHaveBeenCalled();
	expect(sources).toHaveLength(0);
	player.dispose();
});

test.each([
	{ ...pcm, errors: [{ message: "invalid MP3 frame" }] },
	{ ...pcm, samplesDecoded: 0 },
])(
	"rejects incomplete decoding, frees the worker and allows a clean retry",
	async (invalid) => {
		decode.mockResolvedValueOnce(invalid);
		const player = new RecitationAudio("/audio.mp3", hash);
		await expect(player.play(100, 200, jest.fn())).rejects.toThrow(
			"accurately",
		);
		expect(sources).toHaveLength(0);
		expect(free).toHaveBeenCalledTimes(1);
		await expect(player.play(100, 200, jest.fn())).resolves.toBe(true);
		expect(free).toHaveBeenCalledTimes(2);
		player.dispose();
	},
);

test("a stop during decoding prevents delayed playback; newest request wins", async () => {
	let resolve: (value: typeof pcm) => void = () => {};
	decode.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const player = new RecitationAudio("/audio.mp3", hash);
	const first = player.play(100, 200, jest.fn());
	while (!decode.mock.calls.length)
		await new Promise((done) => setTimeout(done, 0));
	player.stop();
	const latest = player.play(300, 700, jest.fn());
	resolve(pcm);
	expect(await first).toBe(false);
	expect(await latest).toBe(true);
	expect(sources).toHaveLength(1);
	expect(sources[0].start).toHaveBeenCalledWith(0, 0.3, 0.4);
	player.dispose();
});

test("dispose aborts a pending download and suppresses later playback", async () => {
	let resolve: (value: unknown) => void = () => {};
	(global.fetch as jest.Mock).mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const player = new RecitationAudio("/audio.mp3", hash);
	const pending = player.play(100, 200, jest.fn());
	const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal;
	player.dispose();
	expect(signal.aborted).toBe(true);
	resolve(new Response(bytes.slice(0)));
	await expect(pending).rejects.toThrow("disposed");
	expect(sources).toHaveLength(0);
});

test("rejects out-of-range clips and retries failed downloads", async () => {
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
	const player = new RecitationAudio("/audio.mp3", hash);
	await expect(player.play(100, 200, jest.fn())).rejects.toThrow("download");
	await expect(player.play(100, 11000, jest.fn())).rejects.toThrow("outside");
	expect(sources).toHaveLength(0);
	await expect(player.play(100, 200, jest.fn())).resolves.toBe(true);
	player.dispose();
});

test("pause and resume preserve the audio-clock position and original clip end", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	await player.play(1200, 2300, ended);
	audioClock = 10.5;
	expect(player.pause()).toBe(true);
	expect(sources[0].stop).toHaveBeenCalled();
	audioClock = 20;
	await player.resume();
	expect(sources[1].start).toHaveBeenCalledWith(0, 1.7, 0.6);
	expect(decode).toHaveBeenCalledTimes(1);
	sources[1].onended?.();
	expect(ended).toHaveBeenCalledTimes(1);
	player.dispose();
});

test("pausing after the audio clock reaches the clip end completes it exactly once", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	expect(player.pause()).toBe(false);
	await expect(player.resume()).resolves.toBe(false);
	await player.play(1200, 2300, ended);
	audioClock = 12;
	expect(player.pause()).toBe(false);
	expect(ended).toHaveBeenCalledTimes(1);
	expect(sources[0].stop).toHaveBeenCalledTimes(1);
	expect(sources[0].onended).toBeNull();
	await expect(player.resume()).resolves.toBe(false);
	player.dispose();
});

test("disposed players reject new playback and close their context only once", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	player.dispose();
	player.dispose();
	await expect(player.play(100, 200, jest.fn())).rejects.toThrow(
		"Player disposed",
	);
	expect(close).toHaveBeenCalledTimes(1);
	expect(global.fetch).not.toHaveBeenCalled();
	expect(sources).toHaveLength(0);
});

test("late ended callbacks from a replaced source cannot finish its successor", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const firstEnded = jest.fn();
	const latestEnded = jest.fn();
	await player.play(100, 200, firstEnded);
	const staleCallback = sources[0].onended;
	await player.play(300, 400, latestEnded);
	staleCallback?.();
	expect(firstEnded).not.toHaveBeenCalled();
	expect(latestEnded).not.toHaveBeenCalled();
	sources[1].onended?.();
	expect(latestEnded).toHaveBeenCalledTimes(1);
	player.dispose();
});

test("preparation reports actual received bytes and reuses the verified audio for playback", async () => {
	const progress = jest.fn();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([1]));
			controller.enqueue(new Uint8Array([2, 3]));
			controller.close();
		},
	});
	(global.fetch as jest.Mock).mockResolvedValueOnce(
		new Response(stream, { headers: { "content-length": "3" } }),
	);
	const player = new RecitationAudio("/audio.mp3", hash, progress);
	await player.prepare();
	expect(progress.mock.calls.map(([value]) => value)).toEqual([
		0,
		expect.closeTo(100 / 3),
		100,
		100,
	]);
	expect(decode).toHaveBeenCalledWith(new Uint8Array(bytes));
	expect(sources).toHaveLength(0);
	await player.play(100, 200, jest.fn());
	expect(global.fetch).toHaveBeenCalledTimes(1);
	expect(decode).toHaveBeenCalledTimes(1);
	player.dispose();
	await expect(player.prepare()).rejects.toThrow("disposed");
});

test.each([undefined, "bad", "0"])(
	"a missing or invalid content length (%s) remains indeterminate until download finishes",
	async (length) => {
		const progress = jest.fn();
		(global.fetch as jest.Mock).mockResolvedValueOnce(
			new Response(bytes.slice(0), {
				headers: length === undefined ? {} : { "content-length": length },
			}),
		);
		const player = new RecitationAudio("/audio.mp3", hash, progress);
		await player.prepare();
		expect(progress.mock.calls.map(([value]) => value)).toEqual([
			null,
			null,
			100,
		]);
		expect(decode).toHaveBeenCalledTimes(1);
		player.dispose();
	},
);

test("browsers without a response stream finish preparation using the complete bytes", async () => {
	const progress = jest.fn();
	(global.fetch as jest.Mock).mockResolvedValueOnce({
		ok: true,
		headers: new Headers(),
		body: null,
		arrayBuffer: async () => bytes.slice(0),
	});
	const player = new RecitationAudio("/audio.mp3", hash, progress);
	await player.prepare();
	expect(progress.mock.calls.map(([value]) => value)).toEqual([null, 100]);
	expect(decode).toHaveBeenCalledWith(new Uint8Array(bytes));
	player.dispose();
});

test("a broken download releases its reader and can be prepared again", async () => {
	const reader = {
		read: jest.fn().mockRejectedValue(new Error("interrupted stream")),
		releaseLock: jest.fn(),
	};
	(global.fetch as jest.Mock).mockResolvedValueOnce({
		ok: true,
		headers: new Headers(),
		body: { getReader: () => reader },
	});
	const player = new RecitationAudio("/audio.mp3", hash);
	await expect(player.prepare()).rejects.toThrow("interrupted stream");
	expect(reader.releaseLock).toHaveBeenCalledTimes(1);
	expect(decode).not.toHaveBeenCalled();
	await player.prepare();
	expect(decode).toHaveBeenCalledWith(new Uint8Array(bytes));
	player.dispose();
});

test("dispose tolerates a rejected audio-context close and prevents later playback", async () => {
	close.mockRejectedValueOnce(new Error("context already closed"));
	const player = new RecitationAudio("/audio.mp3", hash);
	player.dispose();
	await Promise.resolve();
	player.dispose();
	expect(close).toHaveBeenCalledTimes(1);
	await expect(player.play(100, 200, jest.fn())).rejects.toThrow(
		"Player disposed",
	);
	expect(sources).toHaveLength(0);
});

test("reported position follows the audio clock and retains its exact offset across pause and resume", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	expect(player.positionMs).toBeNull();
	await player.play(1200, 2300, jest.fn());
	expect(player.positionMs).toBe(1200);
	audioClock = 10.25;
	expect(player.positionMs).toBe(1450);
	player.pause();
	audioClock = 20;
	expect(player.positionMs).toBe(1450);
	await player.resume();
	expect(sources[1].start).toHaveBeenCalledWith(0, 1.45, 0.85);
	audioClock = 20.1;
	expect(player.positionMs).toBeCloseTo(1550);
	sources[1].onended?.();
	expect(player.positionMs).toBeNull();
	player.dispose();
});

test("full chapter uses actual decoded duration and the same playback clock as clips", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	await player.playChapter(jest.fn());
	expect(sources[0].start).toHaveBeenCalledWith(0, 0, 10);
	audioClock = 11.2;
	expect(player.positionMs).toBeCloseTo(1200);
	player.stop();
	expect(player.positionMs).toBeNull();
	player.dispose();
});

test("rate changes preserve the source position and gain changes apply without restarting", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	player.setOptions(2, 0.4);
	await player.play(1000, 5000, ended);
	audioClock = 10.5;
	expect(player.positionMs).toBe(2000);
	expect(gain.gain.value).toBe(0.4);
	player.setOptions(1, 0.2);
	expect(player.positionMs).toBe(2000);
	expect(sources[0].stop).toHaveBeenCalled();
	expect(sources[1].start).toHaveBeenCalledWith(0, 2, 3);
	audioClock = 11;
	expect(player.positionMs).toBe(2500);
	player.setOptions(1, 0);
	expect(sources).toHaveLength(2);
	expect(gain.gain.value).toBe(0);
	player.pause();
	player.setOptions(0.5, 1);
	audioClock = 20;
	await player.resume();
	audioClock = 21;
	expect(player.positionMs).toBe(3000);
	player.dispose();
});
test("approved verses have wall-clock gaps at every speed and pause/resume retains remaining silence", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	player.setOptions(2, 1);
	await player.playRanges(
		[
			{ startMs: 1000, endMs: 3000 },
			{ startMs: 5000, endMs: 7000 },
		],
		1000,
		ended,
	);
	expect(sources[0].start).toHaveBeenCalledWith(0, 1, 2);
	expect(sources[1].start).toHaveBeenCalledWith(12, 5, 2);
	audioClock = 11.25;
	expect(player.positionMs).toBeNull();
	expect(player.pause()).toBe(true);
	expect(sources.every((s) => s.stop.mock.calls.length === 1)).toBe(true);
	audioClock = 20;
	await player.resume();
	expect(sources[2].start).toHaveBeenCalledWith(20.75, 5, 2);
	audioClock = 20.5;
	expect(player.positionMs).toBeNull();
	audioClock = 21;
	expect(player.positionMs).toBe(5500);
	sources[2].onended?.();
	expect(ended).toHaveBeenCalledTimes(1);
	expect(player.positionMs).toBeNull();
	player.dispose();
});
test("speed changes during a verse gap preserve remaining silence; stop cancels all scheduled verses", async () => {
	const player = new RecitationAudio("/audio.mp3", hash);
	const ended = jest.fn();
	await player.playRanges(
		[
			{ startMs: 0, endMs: 1000 },
			{ startMs: 2000, endMs: 3000 },
		],
		500,
		ended,
	);
	const staleEnded = sources[1].onended;
	audioClock = 11.2;
	player.setOptions(2, 0.5);
	expect(player.positionMs).toBeNull();
	expect(sources[2].start.mock.calls[0][0]).toBeCloseTo(11.5);
	player.stop();
	staleEnded?.();
	expect(ended).not.toHaveBeenCalled();
	expect(sources[2].stop).toHaveBeenCalled();
	await expect(player.playRanges([], 0, ended)).rejects.toThrow("outside");
	expect(() => player.setOptions(Number.NaN, 1)).toThrow("settings");
	player.dispose();
});
