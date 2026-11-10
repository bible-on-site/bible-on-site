/** @jest-environment jsdom */
import type { ReactNode } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	RecitationLink,
	RecitationWordControl,
} from "@/app/929/[number]/components/RecitationPlayer";
import {
	RangeRecitationControls,
	RangeRecitationPlayer,
} from "@/app/components/reading/RangeRecitationPlayer";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { RecitationAudio } from "@/lib/recitation-audio";

jest.mock("@/lib/recitation-audio");
const clipPlay = jest.fn();
const setOptions = jest.fn();
const playRanges = jest.fn();
const clipStop = jest.fn();
const clipDispose = jest.fn();
const clipPause = jest.fn();
const clipResume = jest.fn();
let positionMs: number | null;
let rangeIndex: number | null;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let clipEnded: () => void;

const perek1Pesukim = [
	{
		segments: [
			{ type: "qri", value: "אֶחָד" },
			{ type: "qri", value: "שְׁנַיִם" },
		],
	},
	{ segments: [{ type: "qri", value: "שָׁלֹשׁ" }] },
] as Pasuk[];
const perek2Pesukim = [
	{ segments: [{ type: "qri", value: "אַחַת" }] },
] as Pasuk[];

const manifestFor = (
	perekId: number,
	words: {
		pasuk: number;
		segment: number;
		text: string;
		startMs: number;
		endMs: number;
	}[],
) => ({
	version: 1,
	audioSha256: "a".repeat(64),
	textSha256: "b".repeat(64),
	alignmentStatus: "ready",
	perekId,
	audioUrl: `https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/${perekId}_record.mp3`,
	durationMs: 10000,
	words,
});

const perek1Manifest = manifestFor(1, [
	{ pasuk: 1, segment: 1, text: "אֶחָד", startMs: 0, endMs: 100 },
	{ pasuk: 1, segment: 2, text: "שְׁנַיִם", startMs: 100, endMs: 200 },
	{ pasuk: 2, segment: 1, text: "שָׁלֹשׁ", startMs: 300, endMs: 400 },
]);
const perek2Manifest = manifestFor(2, [
	{ pasuk: 1, segment: 1, text: "אַחַת", startMs: 0, endMs: 150 },
]);

const range = (
	startPerek: number,
	startPasuk: number,
	endPerek: number,
	endPasuk: number,
): ScriptureRange => ({
	start: { perekId: startPerek, pasuk: startPasuk },
	end: { perekId: endPerek, pasuk: endPasuk },
});

const perakim = [
	{ perekId: 1, pesukim: perek1Pesukim, hasRecording: true },
	{ perekId: 2, pesukim: perek2Pesukim, hasRecording: true },
];

beforeEach(() => {
	localStorage.clear();
	positionMs = null;
	rangeIndex = null;
	frames.clear();
	jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.set(++frameId, callback);
		return frameId;
	});
	jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
		frames.delete(id);
	});
	playRanges.mockImplementation(async (_ranges, _pauseMs, ended) => {
		positionMs = _ranges[0]?.startMs ?? null;
		rangeIndex = 0;
		clipEnded = ended;
		return true;
	});
	clipPause.mockReturnValue(true);
	clipResume.mockResolvedValue(true);
	clipPlay.mockImplementation(async (_start, _end, ended) => {
		positionMs = _start;
		rangeIndex = 0;
		clipEnded = ended;
		return true;
	});
	(RecitationAudio as jest.Mock).mockImplementation(() => ({
		setOptions,
		playRanges,
		play: clipPlay,
		get positionMs() {
			return positionMs;
		},
		get positionRangeIndex() {
			return rangeIndex;
		},
		stop: clipStop,
		dispose: clipDispose,
		pause: clipPause,
		resume: clipResume,
	}));
	global.fetch = jest.fn().mockImplementation(async (url: string) => {
		if (url === "/api/recitation/1")
			return { ok: true, json: async () => perek1Manifest };
		if (url === "/api/recitation/2")
			return { ok: true, json: async () => perek2Manifest };
		return { ok: false, status: 404 };
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

async function openListening(ranges: ScriptureRange[], children: ReactNode) {
	const view = render(
		<RangeRecitationPlayer ranges={ranges} perakim={perakim}>
			<RangeRecitationControls />
			{children}
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByRole("button", { name: "השמעת הקריאה" });
	return view;
}

test("play runs the declared pieces in order across perakim", async () => {
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 2, 1, 2)],
		<RecitationWordControl perek={1} pasuk={1} segment={1}>
			אֶחָד
		</RecitationWordControl>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 200, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 150, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(3));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 300, endMs: 400, pasuk: 2 }],
		expect.any(Number),
		expect.any(Function),
	);
	act(() => clipEnded());
	await screen.findByRole("button", { name: "השמעת הקריאה" });
	expect(playRanges).toHaveBeenCalledTimes(3);
});

test("pause holds and resume continues the live audio", async () => {
	await openListening([range(1, 1, 1, 2)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	expect(clipPause).toHaveBeenCalled();
	const resume = await screen.findByRole("button", { name: "המשך ההקראה" });
	fireEvent.click(resume);
	await waitFor(() => expect(clipResume).toHaveBeenCalled());
	await screen.findByRole("button", { name: "השהיית ההקראה" });
});

test("a tapped word previews and the next play resumes at its piece", async () => {
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={2}>
			שְׁנַיִם
		</RecitationWordControl>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledWith(
		100,
		200,
		expect.any(Function),
	));
	act(() => clipEnded());
	// Play resumes inside the tapped pasuk interval — not from the top.
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 100, endMs: 200, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 150, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
});

test("a tap on the second copy of a repeated pasuk resumes that copy", async () => {
	// Perek 1's first pasuk legitimately appears twice in the reading;
	// each rendered copy carries its own ordinal, so tapping the second
	// copy bookmarks its piece even before any playback.
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={1}>
				אֶחָד
			</RecitationWordControl>
		</>,
	);
	const copies = screen.getAllByRole("button", { name: "השמעת המילה אֶחָד" });
	expect(copies).toHaveLength(2);
	fireEvent.click(copies[1]);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledWith(
		0,
		100,
		expect.any(Function),
	));
	act(() => clipEnded());
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 200, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
	act(() => clipEnded());
	// The bookmarked copy was the last piece — a first-copy bookmark
	// would replay the perek-2 piece and the second copy as well.
	expect(playRanges).toHaveBeenCalledTimes(1);
});

test("a word tapped after a repeated passage played resumes its later copy", async () => {
	// Perek 1's first pasuk legitimately appears twice in the reading.
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={1}>
				אֶחָד
			</RecitationWordControl>
		</>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(3));
	act(() => clipEnded());
	// The full reading finished; tapping the second copy still bookmarks
	// its own piece, not the identical earlier one.
	fireEvent.click(
		screen.getAllByRole("button", { name: "השמעת המילה אֶחָד" })[1],
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	act(() => clipEnded());
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(4));
	act(() => clipEnded());
	// Resume from the last piece ends the queue — a first-copy bookmark
	// would replay the perek-2 piece and the second copy again.
	expect(playRanges).toHaveBeenCalledTimes(4);
});

test("only the playing copy of a repeated pasuk highlights", async () => {
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={1}>
				אֶחָד
			</RecitationWordControl>
		</>,
	);
	const copies = screen.getAllByRole("button", { name: "השמעת המילה אֶחָד" });
	const stepFrame = () =>
		act(() => {
			// Each callback reschedules itself — clear first so the new
			// frame registrations survive for the next step.
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		});
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	// The first copy's piece is playing — only its control highlights.
	positionMs = 50;
	stepFrame();
	expect(copies[0].getAttribute("data-recitation-active")).toBe("true");
	expect(copies[1].getAttribute("data-recitation-active")).toBeNull();
	// The repeated copy's piece plays later — the highlight moves to it.
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	act(() => clipEnded());
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(3));
	stepFrame();
	expect(copies[0].getAttribute("data-recitation-active")).toBeNull();
	expect(copies[1].getAttribute("data-recitation-active")).toBe("true");
});

test("a silent perek keeps its entity links while sibling perakim play", async () => {
	const silentPerakim = [
		{ perekId: 1, pesukim: perek1Pesukim, hasRecording: true },
		{ perekId: 3, pesukim: perek2Pesukim, hasRecording: false },
	];
	render(
		<RangeRecitationPlayer
			ranges={[range(1, 1, 1, 1), range(3, 1, 3, 1)]}
			perakim={silentPerakim}
		>
			<RangeRecitationControls />
			<RecitationLink perek={1} link={<a href="/pedia/one">קישור א</a>}>
				אֶחָד
			</RecitationLink>
			<RecitationLink perek={3} link={<a href="/pedia/three">קישור ג</a>}>
				שלישית
			</RecitationLink>
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByRole("button", { name: "השמעת הקריאה" });
	// Listening mode is on for perek 1 — its link is unwrapped…
	expect(screen.queryByRole("link", { name: "קישור א" })).toBeNull();
	// …but perek 3 has no recording, so its link stays.
	expect(screen.getByRole("link", { name: "קישור ג" })).toBeTruthy();
});
