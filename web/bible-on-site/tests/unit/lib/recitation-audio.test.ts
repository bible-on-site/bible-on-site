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
const close = jest.fn();
const resume = jest.fn();
const originalContext = global.AudioContext;
const originalFetch = global.fetch;

beforeEach(() => {
	sources.length = 0;
	audioClock = 10;
	decode.mockResolvedValue({ duration: 10 });
	close.mockResolvedValue(undefined);
	resume.mockResolvedValue(undefined);
	Object.defineProperty(global, "crypto", {
		value: webcrypto,
		configurable: true,
	});
	global.fetch = jest.fn().mockImplementation(async () => ({
		ok: true,
		arrayBuffer: async () => bytes.slice(0),
	}));
	global.AudioContext = jest.fn().mockImplementation(() => ({
		get currentTime() {
			return audioClock;
		},
		decodeAudioData: decode,
		resume,
		close,
		destination: {},
		createBufferSource: () => {
			const source = {
				start: jest.fn(),
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

test("a stop during decoding prevents delayed playback; newest request wins", async () => {
	let resolve: (value: { duration: number }) => void = () => {};
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
	resolve({ duration: 10 });
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
	resolve({ ok: true, arrayBuffer: async () => bytes.slice(0) });
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
