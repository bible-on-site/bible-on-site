/** @jest-environment jsdom */
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import RecitationPlayer, {
	RecitationHeader,
	RecitationLink,
	RecitationPasukControl,
	RecitationWordControl,
	stopRecitation,
} from "@/app/929/[number]/components/RecitationPlayer";
import { RecitationAudio } from "@/lib/recitation-audio";

jest.mock("@/lib/recitation-audio");
const clipPlay = jest.fn();
const prepare = jest.fn();
let downloadProgress: (percent: number | null) => void;
const clipStop = jest.fn();
const clipDispose = jest.fn();
const clipPause = jest.fn();
const clipResume = jest.fn();
let clipEnded: () => void;

import type { Pasuk } from "@/data/db/tanah-view-types";

const pesukim = [
	{
		segments: [
			{ type: "qri", value: "בְּרֵאשִׁית" },
			{ type: "qri", value: "בָּרָא" },
		],
	},
] as Pasuk[];
const manifest = {
	version: 1,
	audioSha256: "a".repeat(64),
	textSha256: "b".repeat(64),
	alignmentStatus: "ready",
	perekId: 1,
	audioUrl:
		"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3",
	durationMs: 10000,
	words: [
		{ pasuk: 1, segment: 1, text: "בְּרֵאשִׁית", startMs: 1200, endMs: 1800 },
		{ pasuk: 1, segment: 2, text: "בָּרָא", startMs: 1900, endMs: 2300 },
	],
};
let play: jest.SpyInstance;
let pause: jest.SpyInstance;

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (reason: Error) => void = () => {};
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	prepare.mockResolvedValue(undefined);
	clipPause.mockReturnValue(true);
	clipResume.mockResolvedValue(true);
	clipPlay.mockImplementation(async (_start, _end, ended) => {
		clipEnded = ended;
		return true;
	});
	(RecitationAudio as jest.Mock).mockImplementation((_url, _hash, progress) => {
		downloadProgress = progress;
		return {
			prepare,
			play: clipPlay,
			stop: clipStop,
			dispose: clipDispose,
			pause: clipPause,
			resume: clipResume,
		};
	});
	global.fetch = jest
		.fn()
		.mockResolvedValue({ ok: true, json: async () => manifest });
	play = jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
	pause = jest
		.spyOn(HTMLMediaElement.prototype, "pause")
		.mockImplementation(() => {});
});
afterEach(() => {
	jest.restoreAllMocks();
});

async function openPlayer() {
	const view = render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
			<RecitationPasukControl pasuk={1}>א</RecitationPasukControl>
			<RecitationLink link={<a href="/pedia/example">בראשית</a>}>
				<RecitationWordControl pasuk={1} segment={1}>
					בְּרֵאשִׁית
				</RecitationWordControl>
			</RecitationLink>
			<RecitationWordControl pasuk={1} segment={2}>
				בָּרָא
			</RecitationWordControl>
		</RecitationPlayer>,
	);
	expect(global.fetch).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByRole("button", { name: "השמעת כל הפרק" });
	return view;
}

test("streams chapter and plays exact decoded verse and word intervals", async () => {
	const view = await openPlayer();
	const audio = view.container.querySelector("audio") as HTMLAudioElement;
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	expect(audio.currentTime).toBe(0);
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	expect(clipPlay).toHaveBeenLastCalledWith(1200, 2300, expect.any(Function));
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	expect(clipPlay).toHaveBeenLastCalledWith(1900, 2300, expect.any(Function));
	await screen.findByText("משמיע…");
	await act(async () => {
		clipEnded();
	});
	expect(pause).toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "השהיית ההקראה" })).toBeNull();
});

test("unmount stops audio and pending playback callbacks", async () => {
	const view = await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בְּרֵאשִׁית" }));
	await screen.findByText("משמיע…");
	const before = pause.mock.calls.length;
	view.unmount();
	expect(pause.mock.calls.length).toBeGreaterThan(before);
	expect(clipDispose).toHaveBeenCalled();
});

test("media errors are shown and playback can be retried", async () => {
	play.mockRejectedValueOnce(new Error("network"));
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await screen.findByText("משמיע…");
});

test("missing recording shows availability instead of a broken audio control", async () => {
	(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
	const view = render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
			<RecitationPasukControl pasuk={1}>א</RecitationPasukControl>
			<RecitationLink link={<a href="/pedia/example">בראשית</a>}>
				<RecitationWordControl pasuk={1} segment={1}>
					בְּרֵאשִׁית
				</RecitationWordControl>
			</RecitationLink>
			<RecitationWordControl pasuk={1} segment={2}>
				בָּרָא
			</RecitationWordControl>
		</RecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByText("עדיין אין הקלטה לפרק זה.");
	expect(view.container.querySelector("audio")).toBeNull();
});

test("unapproved candidates never expose verse or word playback", async () => {
	(global.fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ ...manifest, alignmentStatus: "needs_review" }),
	});
	await openPlayer();
	expect(
		screen.queryByRole("button", { name: "השמעת המילה בְּרֵאשִׁית" }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "השמעת פסוק א" })).toBeNull();
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
});

test("stopping while a clip loads prevents stale playback state", async () => {
	let resolve: (value: boolean) => void = () => {};
	clipPlay.mockImplementationOnce(
		() =>
			new Promise<boolean>((done) => {
				resolve = done;
			}),
	);
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("טעינה על הפרק...");
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await act(async () => {
		resolve(true);
	});
	expect(screen.queryByText("משמיע…")).toBeNull();
	expect(screen.queryByRole("button", { name: "השהיית ההקראה" })).toBeNull();
});

test("clip download errors allow a retry", async () => {
	clipPlay.mockRejectedValueOnce(new Error("download"));
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("משמיע…");
});

test("listening mode uses original words and restores entity links when disabled", async () => {
	await openPlayer();
	expect(screen.queryByRole("link", { name: "בראשית" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("משמיע…");
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	expect(screen.queryByRole("button", { name: "השמעת המילה בָּרָא" })).toBeNull();
	expect(screen.queryByRole("button", { name: "השמעת פסוק א" })).toBeNull();
	expect(screen.getByRole("link", { name: "בראשית" })).toHaveAttribute(
		"href",
		"/pedia/example",
	);
	expect(clipDispose).toHaveBeenCalled();
});

test("the chapter heading plays the same chapter as its adjacent play icon", async () => {
	const view = await openPlayer();
	fireEvent.click(
		screen.getByRole("button", { name: "הקראת הפרק: בריאת העולם" }),
	);
	await screen.findByText("משמיע…");
	expect(play).toHaveBeenCalledTimes(1);
	expect(view.container.querySelector("audio")?.currentTime).toBe(0);
	const toggle = screen.getByRole("button", { name: "מצב הקראה" });
	const controls = toggle.parentElement;
	expect(controls?.querySelectorAll("button")[1]).toBe(toggle);
});

test("one button pauses and resumes the selected clip without restarting it", async () => {
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	await screen.findByText("מושהה");
	expect(clipPause).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "המשך ההקראה" }));
	await screen.findByText("משמיע…");
	expect(clipResume).toHaveBeenCalledTimes(1);
	expect(clipPlay).toHaveBeenCalledTimes(1);
});

test("chapter pause preserves the native audio position for resume", async () => {
	const view = await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await screen.findByText("משמיע…");
	const element = view.container.querySelector("audio") as HTMLAudioElement;
	element.currentTime = 4.2;
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	fireEvent.click(screen.getByRole("button", { name: "המשך ההקראה" }));
	await screen.findByText("משמיע…");
	expect(element.currentTime).toBe(4.2);
	expect(play).toHaveBeenCalledTimes(2);
});

test("a finished clip cannot be paused or resumed", async () => {
	clipPause.mockReturnValueOnce(false);
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	expect(screen.queryByText("מושהה")).toBeNull();
	expect(clipResume).not.toHaveBeenCalled();
});

test("resume returning false resets the clip controls", async () => {
	clipResume.mockResolvedValueOnce(false);
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("משמיע…");
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	fireEvent.click(screen.getByRole("button", { name: "המשך ההקראה" }));
	await screen.findByText("בחרו אות פסוק או מילה להקראה");
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	expect(
		screen.getByRole("button", { name: "השמעת המילה בָּרָא" }),
	).toHaveAttribute("aria-pressed", "false");
});

test("a rejected resume reports an error and permits fresh playback", async () => {
	clipResume.mockRejectedValueOnce(new Error("resume failed"));
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
	fireEvent.click(screen.getByRole("button", { name: "המשך ההקראה" }));
	await screen.findByText("ההקלטה לא נטענה. נסו שוב.");
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	expect(clipPlay).toHaveBeenCalledTimes(2);
});

test("native chapter completion and media errors update the controls", async () => {
	const view = await openPlayer();
	const audio = view.container.querySelector("audio") as HTMLAudioElement;
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await screen.findByText("משמיע…");
	fireEvent.ended(audio);
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	await screen.findByText("משמיע…");
	fireEvent.error(audio);
	expect(screen.getByText("ההקלטה לא נטענה. נסו שוב.")).toBeVisible();
});

test("hiding the page stops and releases its selected clip", async () => {
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	await screen.findByText("משמיע…");
	jest.spyOn(document, "hidden", "get").mockReturnValue(true);
	fireEvent(document, new Event("visibilitychange"));
	expect(clipDispose).toHaveBeenCalledTimes(1);
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	expect(
		screen.getByRole("button", { name: "השמעת המילה בָּרָא" }),
	).toHaveAttribute("aria-pressed", "false");
});

test("visibility events keep a visible page's clip playing", async () => {
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	jest.spyOn(document, "hidden", "get").mockReturnValue(false);
	fireEvent(document, new Event("visibilitychange"));
	expect(clipDispose).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "השהיית ההקראה" })).toBeEnabled();
});

test("a chapter play rejection arriving after navigation cannot display an error", async () => {
	const pending = deferred<void>();
	play.mockReturnValueOnce(pending.promise);
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת כל הפרק" }));
	act(() => stopRecitation());
	await act(async () => pending.reject(new Error("cancelled chapter")));
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
});

test("failed manifest loads can be retried by reopening listening mode", async () => {
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
	render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
		</RecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByText("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב.");
	expect(screen.queryByRole("button", { name: "השמעת כל הפרק" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await screen.findByRole("button", { name: "השמעת כל הפרק" });
	expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("navigation stops playback through the shared recitation stop event", async () => {
	await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	act(() => stopRecitation());
	expect(clipDispose).toHaveBeenCalledTimes(1);
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
});

test("closing listening mode aborts the manifest request and ignores its late response", async () => {
	const pending = deferred<Partial<Response>>();
	(global.fetch as jest.Mock).mockReturnValueOnce(pending.promise);
	const view = render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
		</RecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	const signal = (global.fetch as jest.Mock).mock.calls[0][1]
		.signal as AbortSignal;
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	expect(signal.aborted).toBe(true);
	const json = jest.fn().mockResolvedValue(manifest);
	await act(async () => pending.resolve({ ok: true, json }));
	expect(json).not.toHaveBeenCalled();
	expect(view.container.querySelector("audio")).toBeNull();
});

test("changing chapters while manifest JSON loads cannot display the old recording", async () => {
	const pending = deferred<typeof manifest>();
	(global.fetch as jest.Mock).mockResolvedValueOnce({
		ok: true,
		json: () => pending.promise,
	});
	const view = render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
		</RecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	await act(async () => {});
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });
	view.rerender(
		<RecitationPlayer perekId={2} pesukim={pesukim}>
			<RecitationHeader title="פרק חדש" />
		</RecitationPlayer>,
	);
	await screen.findByText("עדיין אין הקלטה לפרק זה.");
	await act(async () => pending.resolve(manifest));
	expect(view.container.querySelector("audio")).toBeNull();
	expect(screen.getByText("עדיין אין הקלטה לפרק זה.")).toBeVisible();
});

test("aborting a manifest request does not replace a newer chapter's status with an error", async () => {
	const pending = deferred<Response>();
	(global.fetch as jest.Mock).mockReturnValueOnce(pending.promise);
	const view = render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="פרק" />
		</RecitationPlayer>,
	);
	fireEvent.click(screen.getByRole("button", { name: "מצב הקראה" }));
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });
	view.rerender(
		<RecitationPlayer perekId={2} pesukim={pesukim}>
			<RecitationHeader title="פרק" />
		</RecitationPlayer>,
	);
	await screen.findByText("עדיין אין הקלטה לפרק זה.");
	await act(async () => pending.reject(new Error("aborted")));
	expect(
		screen.queryByText("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב."),
	).toBeNull();
});

test("the heading cannot start another chapter while audio is loading", async () => {
	const pending = deferred<void>();
	play.mockReturnValueOnce(pending.promise);
	await openPlayer();
	const heading = screen.getByRole("button", {
		name: "הקראת הפרק: בריאת העולם",
	});
	fireEvent.click(heading);
	fireEvent.click(heading);
	expect(play).toHaveBeenCalledTimes(1);
	await act(async () => pending.resolve());
	expect(screen.getByText("משמיע…")).toBeInTheDocument();
});

test.each([false, true])(
	"a clip that finishes loading after navigation cannot change playback state (%s)",
	async (started) => {
		const pending = deferred<boolean>();
		clipPlay.mockReturnValueOnce(pending.promise);
		await openPlayer();
		fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
		act(() => stopRecitation());
		await act(async () => pending.resolve(started));
		expect(screen.queryByText("משמיע…")).toBeNull();
		expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	},
);

test.each(["resolve", "reject", "started"] as const)(
	"a pending resume cannot overwrite a navigation stop when it later %s s",
	async (outcome) => {
		const pending = deferred<boolean>();
		clipResume.mockReturnValueOnce(pending.promise);
		await openPlayer();
		fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
		await screen.findByText("משמיע…");
		fireEvent.click(screen.getByRole("button", { name: "השהיית ההקראה" }));
		fireEvent.click(screen.getByRole("button", { name: "המשך ההקראה" }));
		act(() => stopRecitation());
		await act(async () =>
			outcome === "reject"
				? pending.reject(new Error("cancelled resume"))
				: pending.resolve(outcome === "started"),
		);
		expect(screen.queryByText("משמיע…")).toBeNull();
		expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
		expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
	},
);

test("native media events do not interrupt an active precise clip", async () => {
	const view = await openPlayer();
	fireEvent.click(screen.getByRole("button", { name: "השמעת פסוק א" }));
	await screen.findByText("משמיע…");
	const audio = view.container.querySelector("audio") as HTMLAudioElement;
	fireEvent.ended(audio);
	fireEvent.error(audio);
	expect(screen.getByRole("button", { name: "השהיית ההקראה" })).toBeEnabled();
	expect(screen.queryByText("ההקלטה לא נטענה. נסו שוב.")).toBeNull();
	const staleEnded = clipEnded;
	act(() => stopRecitation());
	act(() => staleEnded());
	expect(screen.getByRole("button", { name: "השמעת כל הפרק" })).toBeEnabled();
});

test("download progress surrounds the inactive toggle and activates mode once audio is prepared", async () => {
	const pending = deferred<void>();
	prepare.mockReturnValueOnce(pending.promise);
	render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="בריאת העולם" />
			<RecitationWordControl pasuk={1} segment={1}>
				בְּרֵאשִׁית
			</RecitationWordControl>
		</RecitationPlayer>,
	);
	const toggle = screen.getByRole("button", { name: "מצב הקראה" });
	fireEvent.click(toggle);
	await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
	expect(toggle).toHaveAttribute("aria-pressed", "false");
	expect(toggle).toHaveAttribute("aria-busy", "true");
	expect(screen.getByText("טעינה על הפרק...")).toBeVisible();
	const progress = screen.getByRole("progressbar", {
		name: "טעינה על הפרק...",
	});
	expect(progress).not.toHaveAttribute("aria-valuenow");
	act(() => downloadProgress(42));
	expect(progress).toHaveAttribute("aria-valuenow", "42");
	expect(
		screen.queryByRole("button", { name: "השמעת המילה בְּרֵאשִׁית" }),
	).toBeNull();
	act(() => downloadProgress(100));
	expect(toggle).toHaveAttribute("aria-pressed", "false");
	await act(async () => pending.resolve());
	expect(toggle).toHaveAttribute("aria-pressed", "true");
	expect(toggle).toHaveAttribute("aria-busy", "false");
	expect(screen.queryByRole("progressbar")).toBeNull();
	expect(screen.queryByText("טעינה על הפרק...")).toBeNull();
	expect(
		screen.getByRole("button", { name: "השמעת המילה בְּרֵאשִׁית" }),
	).toBeEnabled();
	expect(play).not.toHaveBeenCalled();
	expect(clipPlay).not.toHaveBeenCalled();
});

test.each(["toggle", "navigation", "hidden"])(
	"cancelling preparation by %s prevents late automatic activation",
	async (reason) => {
		const pending = deferred<void>();
		prepare.mockReturnValueOnce(pending.promise);
		render(
			<RecitationPlayer perekId={1} pesukim={pesukim}>
				<RecitationHeader title="פרק" />
			</RecitationPlayer>,
		);
		const toggle = screen.getByRole("button", { name: "מצב הקראה" });
		fireEvent.click(toggle);
		await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
		if (reason === "toggle") fireEvent.click(toggle);
		else if (reason === "navigation") act(() => stopRecitation());
		else {
			jest.spyOn(document, "hidden", "get").mockReturnValue(true);
			fireEvent(document, new Event("visibilitychange"));
		}
		expect(clipDispose).toHaveBeenCalledTimes(1);
		act(() => downloadProgress(75));
		await act(async () => pending.resolve());
		expect(toggle).toHaveAttribute("aria-pressed", "false");
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.queryByRole("button", { name: "השמעת כל הפרק" })).toBeNull();
	},
);

test("preparation errors stay off and allow a fresh attempt", async () => {
	prepare.mockRejectedValueOnce(new Error("download failed"));
	render(
		<RecitationPlayer perekId={1} pesukim={pesukim}>
			<RecitationHeader title="פרק" />
		</RecitationPlayer>,
	);
	const toggle = screen.getByRole("button", { name: "מצב הקראה" });
	fireEvent.click(toggle);
	await screen.findByText("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב.");
	expect(toggle).toHaveAttribute("aria-pressed", "false");
	expect(screen.queryByRole("progressbar")).toBeNull();
	fireEvent.click(toggle);
	fireEvent.click(toggle);
	await screen.findByRole("button", { name: "השמעת כל הפרק" });
	expect(toggle).toHaveAttribute("aria-pressed", "true");
	expect(prepare).toHaveBeenCalledTimes(2);
});

test("chapter-only recordings show no persistent availability notice", async () => {
	(global.fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ ...manifest, alignmentStatus: "pending" }),
	});
	await openPlayer();
	expect(screen.getByRole("button", { name: "מצב הקראה" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	expect(screen.queryByText("זמינה הקראת הפרק המלא")).toBeNull();
	expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

test("reloading precise audio after its context was released reports current download progress", async () => {
	await openPlayer();
	jest.spyOn(document, "hidden", "get").mockReturnValue(true);
	fireEvent(document, new Event("visibilitychange"));
	const pending = deferred<boolean>();
	clipPlay.mockReturnValueOnce(pending.promise);
	fireEvent.click(screen.getByRole("button", { name: "השמעת המילה בָּרָא" }));
	act(() => downloadProgress(60));
	expect(
		screen.getByRole("progressbar", { name: "טעינה על הפרק..." }),
	).toHaveAttribute("aria-valuenow", "60");
	await act(async () => pending.resolve(true));
	expect(screen.queryByRole("progressbar")).toBeNull();
	expect(screen.getByRole("button", { name: "השהיית ההקראה" })).toBeEnabled();
});
