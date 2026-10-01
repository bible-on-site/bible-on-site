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
} from "@/app/929/[number]/components/RecitationPlayer";
import { RecitationAudio } from "@/lib/recitation-audio";

jest.mock("@/lib/recitation-audio");
const clipPlay = jest.fn();
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

beforeEach(() => {
	clipPause.mockReturnValue(true);
	clipResume.mockResolvedValue(true);
	clipPlay.mockImplementation(async (_start, _end, ended) => {
		clipEnded = ended;
		return true;
	});
	(RecitationAudio as jest.Mock).mockImplementation(() => ({
		play: clipPlay,
		stop: clipStop,
		dispose: clipDispose,
		pause: clipPause,
		resume: clipResume,
	}));
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
	await screen.findByText("טוען שמע…");
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
