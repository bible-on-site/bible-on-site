/** @jest-environment jsdom */
import { type ReactNode, useContext } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	RecitationLink,
	RecitationTextContext,
	RecitationWordControl,
} from "@/app/929/[number]/components/RecitationPlayer";
import {
	RangeRecitationControls,
	RangeRecitationPlayer,
} from "@/app/components/reading/RangeRecitationPlayer";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import { RecitationAudio } from "@/lib/recitation-audio";
import {
	OPEN_READER_SETTINGS_EVENT,
	RECITATION_SETTINGS_EVENT,
	RECITATION_SETTINGS_KEY,
} from "@/lib/recitation-settings";

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

// Runs one animation-frame round: each callback reschedules itself, so
// clear first and the new registrations survive for the next step.
const stepFrame = () =>
	act(() => {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(0);
	});

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

test("settings changes reach live audio and a storage event reloads them", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	expect(setOptions).toHaveBeenLastCalledWith(1, 1);
	act(() =>
		window.dispatchEvent(
			new CustomEvent(RECITATION_SETTINGS_EVENT, {
				detail: { speed: 2, volume: 0.5, versePauseMs: null },
			}),
		),
	);
	expect(setOptions).toHaveBeenLastCalledWith(2, 0.5);
	localStorage.setItem(
		RECITATION_SETTINGS_KEY,
		JSON.stringify({ speed: 1.5, volume: 0.75 }),
	);
	act(() => window.dispatchEvent(new Event("storage")));
	expect(setOptions).toHaveBeenLastCalledWith(1.5, 0.75);
});

test("hiding the tab while preparing closes listening and stops audio", async () => {
	(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
	render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	const hiddenSpy = jest.spyOn(document, "hidden", "get").mockReturnValue(true);
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	hiddenSpy.mockRestore();
	expect(
		screen.getByRole("button", { name: "מצב הקראה" }),
	).toHaveAttribute("aria-pressed", "false");
});

test("hiding the tab during playback stops the reading", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	const hiddenSpy = jest.spyOn(document, "hidden", "get").mockReturnValue(true);
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	hiddenSpy.mockRestore();
	expect(clipStop).toHaveBeenCalled();
	await screen.findByRole("button", { name: "השמעת הקריאה" });
});

test("recordings missing for every perek keep an unrecorded notice", async () => {
	(global.fetch as jest.Mock).mockImplementation(async () => ({
		ok: false,
		status: 404,
	}));
	render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByText("עדיין אין הקלטה לקריאה זו.");
});

test("a manifest fetch failure asks to reopen listening", async () => {
	(global.fetch as jest.Mock).mockImplementation(async () => ({
		ok: false,
		status: 500,
	}));
	render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByText("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב.");
});

test("a playback failure asks to retry", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	playRanges.mockRejectedValueOnce(new Error("buffer"));
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
});

test("download progress fills the loading ring and ignores stale audio", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={1}>
			אֶחָד
		</RecitationWordControl>,
	);
	const progress = () =>
		(RecitationAudio as jest.Mock).mock.calls[0]?.[2] as (
			percent: number,
		) => void;
	// The preview stays "loading" while its clip promise pends, so the
	// progress callback has a live ring to fill.
	clipPlay.mockImplementationOnce(() => {
		positionMs = 0;
		progress()(50);
		return new Promise(() => {});
	});
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	const bar = await screen.findByRole("progressbar");
	expect(bar).toHaveAttribute("aria-valuenow", "50");
	// A foreign player taking over releases this audio — its progress
	// callback must no longer touch the ring.
	act(() =>
		window.dispatchEvent(new CustomEvent("recitation-stop", { detail: "x" })),
	);
	expect(clipDispose).toHaveBeenCalled();
	act(() => progress()(75));
});

test("a tapped-word preview failure asks to retry", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={1}>
			אֶחָד
		</RecitationWordControl>,
	);
	clipPlay.mockRejectedValueOnce(new Error("clip"));
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
});

test("pressing play during a word preview starts the reading at its bookmark", async () => {
	await openListening(
		[range(1, 1, 1, 1), range(2, 1, 2, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={2}>
			שְׁנַיִם
		</RecitationWordControl>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	// The preview is still playing — Play swaps it for the bookmarked queue.
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

test("a failed resume ends playback instead of hanging", async () => {
	await openListening([range(1, 1, 1, 2)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "השהיית ההקראה" }),
	);
	clipResume.mockResolvedValueOnce(false);
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	await screen.findByRole("button", { name: "השמעת הקריאה" });
});

test("a pause landing between pieces resumes the held piece", async () => {
	await openListening([range(1, 1, 1, 1), range(2, 1, 2, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	// The live audio could not hold — the held queue index owns resume.
	clipPause.mockReturnValueOnce(false);
	fireEvent.click(
		screen.getByRole("button", { name: "השהיית ההקראה" }),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 150, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
});

test("a held position past the queue ends playback", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	clipPause.mockReturnValueOnce(false);
	fireEvent.click(
		screen.getByRole("button", { name: "השהיית ההקראה" }),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	await screen.findByRole("button", { name: "השמעת הקריאה" });
	expect(playRanges).toHaveBeenCalledTimes(1);
});

test("a resume failure asks to retry", async () => {
	await openListening([range(1, 1, 1, 2)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "השהיית ההקראה" }),
	);
	clipResume.mockRejectedValueOnce(new Error("resume"));
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
});

test("the settings button opens reader settings scoped to recitation", async () => {
	let detail: { section?: string; scoped?: boolean } | undefined;
	window.addEventListener(
		OPEN_READER_SETTINGS_EVENT,
		(event) => {
			detail = (event as CustomEvent).detail;
		},
		{ once: true },
	);
	await openListening([range(1, 1, 1, 1)], null);
	fireEvent.click(
		screen.getByRole("button", { name: "הגדרות קריינות" }),
	);
	expect(detail).toMatchObject({ section: "recitation", scoped: true });
});

test("a refused audio start leaves the player's state alone", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	// The recording declined to start (already superseded) — no fail, no
	// playing state; the player simply settles back.
	playRanges.mockResolvedValueOnce(false);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
});

test("another player opening while preparing closes listening", async () => {
	(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
	render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	// A different player's listen toggle releases this one mid-prepare.
	act(() =>
		window.dispatchEvent(new CustomEvent("recitation-stop", { detail: "x" })),
	);
	expect(
		screen.getByRole("button", { name: "מצב הקראה" }),
	).toHaveAttribute("aria-pressed", "false");
	// Both recorded perakim's manifest fetches were already dispatched.
	expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("unmounting during manifest fetch aborts and cleans up", async () => {
	// Every recorded perek fetches its manifest — keep them all pending
	// until the late release below.
	const pending: Array<() => void> = [];
	(global.fetch as jest.Mock).mockImplementation(
		(url: string) =>
			new Promise((resolve) => {
				pending.push(() =>
					resolve(
						url === "/api/recitation/1"
							? { ok: true, json: async () => perek1Manifest }
							: { ok: true, json: async () => perek2Manifest },
					),
				);
			}),
	);
	const view = render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	view.unmount();
	// The aborted load resolves late — nothing applies afterwards.
	await act(async () => {
		for (const release of pending) release();
	});
});

test("a reading without recordings keeps the toggle disabled", () => {
	render(
		<RangeRecitationPlayer
			ranges={[range(3, 1, 3, 1)]}
			perakim={[{ perekId: 3, pesukim: perek2Pesukim, hasRecording: false }]}
		>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	const toggle = screen.getByRole("button", { name: "מצב הקראה" });
	expect(toggle).toBeDisabled();
	expect(toggle).toHaveAttribute("title", "אין הקלטה לקריאה זו");
});

test("a visibility change on a visible tab keeps the reading playing", async () => {
	await openListening([range(1, 1, 1, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	// document.hidden is false in jsdom — nothing stops.
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	expect(
		screen.getByRole("button", { name: "השהיית ההקראה" }),
	).toBeInTheDocument();
});

test("a piece ending while pause is held does not advance the queue", async () => {
	await openListening([range(1, 1, 1, 1), range(2, 1, 2, 1)], null);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	clipPause.mockReturnValueOnce(false);
	fireEvent.click(
		screen.getByRole("button", { name: "השהיית ההקראה" }),
	);
	// The piece's ended callback lands while the index is held — it must
	// not advance the queue; resume still plays the held piece.
	act(() => clipEnded());
	expect(playRanges).toHaveBeenCalledTimes(1);
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(2));
	expect(playRanges).toHaveBeenLastCalledWith(
		[{ startMs: 0, endMs: 150, pasuk: 1 }],
		expect.any(Number),
		expect.any(Function),
	);
});

test("a stale playback failure is ignored once a newer request owns playback", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
			אֶחָד
		</RecitationWordControl>,
	);
	let reject: (error: Error) => void = () => {};
	playRanges.mockImplementationOnce(
		() =>
			new Promise((_resolve, rej) => {
				reject = rej;
			}),
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() => expect(playRanges).toHaveBeenCalledTimes(1));
	// A word tap supersedes the pending queue start.
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	// The stale queue rejection lands late — no failure surfaces.
	await act(async () => reject(new Error("late")));
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
});

let contextPlay:
	| ((start: number, end: number, perekId?: number, occurrence?: number) => void)
	| undefined;
const ContextPlayProbe = () => {
	contextPlay = useContext(RecitationTextContext)?.play;
	return null;
};

test("a play call without a manifest perek is a no-op", async () => {
	await openListening([range(1, 1, 1, 1)], <ContextPlayProbe />);
	// No perek id and an unloaded perek id both return before any audio.
	act(() => contextPlay?.(0, 100));
	act(() => contextPlay?.(0, 100, 999));
	expect(clipPlay).not.toHaveBeenCalled();
	// A manifest-backed perek previews normally.
	act(() => contextPlay?.(0, 150, 2));
	await waitFor(() => expect(clipPlay).toHaveBeenCalledTimes(1));
});

test("a word tap outside the plan previews without a resume bookmark", async () => {
	// The plan covers only pasuk 2; the pasuk-1 word previews anyway but
	// cannot bookmark into the plan.
	await openListening(
		[range(1, 2, 1, 2)],
		<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
			אֶחָד
		</RecitationWordControl>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await waitFor(() =>
		expect(clipPlay).toHaveBeenCalledWith(0, 100, expect.any(Function)),
	);
	// A frame during the preview resolves against the null bookmark.
	stepFrame();
	// Play then starts the plan from its beginning — no bogus bookmark.
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await waitFor(() =>
		expect(playRanges).toHaveBeenCalledWith(
			[{ startMs: 300, endMs: 400, pasuk: 2 }],
			expect.any(Number),
			expect.any(Function),
		),
	);
});

test("a stale piece ending does not steal a newer preview's audio", async () => {
	await openListening(
		[range(1, 1, 1, 2)],
		<RecitationWordControl perek={2} pasuk={1} segment={1} occurrence={0}>
			אַחַת
		</RecitationWordControl>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	const queueEnded = clipEnded;
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אַחַת" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	// The superseded piece's ended callback lands late — the preview's
	// active audio survives, so word tracking keeps working.
	act(() => queueEnded());
	positionMs = 50;
	await waitFor(() => expect(frames.size).toBeGreaterThan(0));
	stepFrame();
	const word = screen.getByRole("button", { name: "השמעת המילה אַחַת" });
	expect(word.getAttribute("data-recitation-active")).toBe("true");
});

test("a declined word preview leaves the reading alone", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
			אֶחָד
		</RecitationWordControl>,
	);
	// The recording declined to start — no failure, no transition.
	clipPlay.mockResolvedValueOnce(false);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
});

test("a superseded word preview drops its late start", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={2} occurrence={0}>
				שְׁנַיִם
			</RecitationWordControl>
		</>,
	);
	let release: () => void = () => {};
	clipPlay.mockImplementationOnce(
		() =>
			new Promise<boolean>((resolve) => {
				release = () => resolve(true);
			}),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	// The second tap supersedes before the first preview resolves.
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledTimes(2));
	await act(async () => release());
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
});

test("a superseded word preview drops its late failure", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={2} occurrence={0}>
				שְׁנַיִם
			</RecitationWordControl>
		</>,
	);
	let reject: (error: Error) => void = () => {};
	clipPlay.mockImplementationOnce(
		() =>
			new Promise<boolean>((_resolve, rej) => {
				reject = rej;
			}),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledTimes(2));
	await act(async () => reject(new Error("late")));
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
});

test.each([
	{ label: "refusal", outcome: "false" },
	{ label: "resume", outcome: "true" },
	{ label: "rejection", outcome: "reject" },
] as const)("a superseded resume drops its $label", async ({ outcome }) => {
	await openListening(
		[range(1, 1, 1, 2)],
		<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
			אֶחָד
		</RecitationWordControl>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "השהיית ההקראה" }),
	);
	let release: (ok: boolean) => void = () => {};
	let reject: (error: Error) => void = () => {};
	clipResume.mockImplementationOnce(
		() =>
			new Promise<boolean>((resolve, rej) => {
				release = resolve;
				reject = rej;
			}),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "המשך ההקראה" }),
	);
	// A word tap takes over before the resume settles.
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalled());
	await act(async () => {
		if (outcome === "reject") reject(new Error("late"));
		else release(outcome === "true");
	});
	// The stale resume applies nothing: no failure, no state hijack.
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
	expect(
		screen.getByRole("button", { name: "השמעת הקריאה" }),
	).toBeInTheDocument();
});

test("a verse pause releases the highlight", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={2} occurrence={0}>
			שְׁנַיִם
		</RecitationWordControl>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	positionMs = 150;
	stepFrame();
	const word = screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" });
	expect(word.getAttribute("data-recitation-active")).toBe("true");
	// Between scheduled intervals both position getters return null — no
	// word is being read, so the highlight releases until the next pasuk.
	positionMs = null;
	rangeIndex = null;
	stepFrame();
	expect(word.getAttribute("data-recitation-active")).toBeNull();
});

test("a word resolving at an interval boundary still highlights", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<RecitationWordControl perek={1} pasuk={1} segment={2} occurrence={0}>
			שְׁנַיִם
		</RecitationWordControl>,
	);
	fireEvent.click(screen.getByRole("button", { name: "השמעת הקריאה" }));
	await screen.findByRole("button", { name: "השהיית ההקראה" });
	// positionMs and positionRangeIndex each read context.currentTime; at
	// an interval boundary the position can still resolve its word while
	// the index already reports the range as finished.
	positionMs = 150;
	rangeIndex = null;
	stepFrame();
	const word = screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" });
	expect(word.getAttribute("data-recitation-active")).toBe("true");
});

test("a manifest whose words fall outside every range still previews", async () => {
	// Pasuk 9 is beyond every word in the perek-2 manifest, and perek 3
	// is not even listed — the plan is empty while aligned words remain
	// for tapping.
	render(
		<RangeRecitationPlayer
			ranges={[range(2, 9, 2, 9), range(3, 1, 3, 1)]}
			perakim={perakim}
		>
			<RangeRecitationControls />
			<RecitationWordControl perek={2} pasuk={1} segment={1} occurrence={0}>
				אַחַת
			</RecitationWordControl>
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByText("בחרו אות מילה להקראה");
	// No pieces — no play button — but the word preview still works.
	expect(
		screen.queryByRole("button", { name: "השמעת הקריאה" }),
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אַחַת" }),
	);
	await waitFor(() =>
		expect(clipPlay).toHaveBeenCalledWith(0, 150, expect.any(Function)),
	);
	await waitFor(() => expect(frames.size).toBeGreaterThan(0));
	stepFrame();
	const word = screen.getByRole("button", { name: "השמעת המילה אַחַת" });
	expect(word.getAttribute("data-recitation-active")).toBe("true");
});

test("range controls render nothing outside a player", () => {
	const view = render(<RangeRecitationControls />);
	expect(view.container.firstChild).toBeNull();
});

test("a superseded preview's late end leaves the newer preview alone", async () => {
	await openListening(
		[range(1, 1, 1, 1)],
		<>
			<RecitationWordControl perek={1} pasuk={1} segment={1} occurrence={0}>
				אֶחָד
			</RecitationWordControl>
			<RecitationWordControl perek={1} pasuk={1} segment={2} occurrence={0}>
				שְׁנַיִם
			</RecitationWordControl>
		</>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה אֶחָד" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledTimes(1));
	const firstEnded = clipEnded;
	fireEvent.click(
		screen.getByRole("button", { name: "השמעת המילה שְׁנַיִם" }),
	);
	await waitFor(() => expect(clipPlay).toHaveBeenCalledTimes(2));
	// The first preview's ended callback arrives after the second took
	// over — it must not finish the newer preview.
	act(() => firstEnded());
	// Ending the current preview still finishes the reading cleanly.
	act(() => clipEnded());
	await screen.findByRole("button", { name: "השמעת הקריאה" });
});

test("unmounting with a failing manifest fetch stays quiet", async () => {
	const pending: Array<() => void> = [];
	(global.fetch as jest.Mock).mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				pending.push(() => reject(new Error("gone")));
			}),
	);
	const view = render(
		<RangeRecitationPlayer ranges={[range(1, 1, 1, 1)]} perakim={perakim}>
			<RangeRecitationControls />
		</RangeRecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	view.unmount();
	// The aborted load rejects late — no failure message reaches the DOM.
	await act(async () => {
		for (const release of pending) release();
	});
});
