"use client";

import { toLetters } from "gematry";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { Pasuk } from "@/data/db/tanah-view-types";
import {
	parseRecitation,
	playableWords,
	type Recitation,
	type RecitationWord,
	resumeRanges,
	wordAtPosition,
} from "@/lib/recitation";
import { RecitationAudio } from "@/lib/recitation-audio";
import {
	getRecitationSettings,
	openReaderSettings,
	RECITATION_SETTINGS_EVENT,
	type RecitationSettings,
} from "@/lib/recitation-settings";
import styles from "./recitation-player.module.css";
import SettingsIcon from "./SettingsIcon";

const STOP_EVENT = "recitation-stop";
const LOADING_MESSAGE = "טעינה על הפרק...";
const NO_RECORDING_MESSAGE = "אין הקלטה לפרק זה";
export function stopRecitation() {
	window.dispatchEvent(new Event(STOP_EVENT));
}
interface RecitationTextState {
	enabled: boolean;
	/** Range players may mix recorded and silent perakim; `enabledFor`
	 * narrows listening mode to perakim that actually carry aligned words
	 * so silent text keeps entity links and inert rendering. Chapter
	 * players leave it unset — `enabled` governs the whole perek. */
	enabledFor?: (perekId: number) => boolean;
	wordByKey: Map<string, RecitationWord>;
	/** Keys are `"pasuk"` for chapter players and `"perek:pasuk"` for
	 * range players whose plan can touch several perakim. */
	rangesByPasuk: Map<string, { startMs: number; endMs: number }>;
	subscribeActive: (listener: () => void) => () => void;
	isActive: (key: string) => boolean;
	play: (start: number, end: number, perekId?: number) => void;
}

// Range players (RangeRecitationPlayer) provide these same contexts so
// the word/pasuk controls stay shared across chapter and range surfaces.
export const RecitationTextContext =
	createContext<RecitationTextState | null>(null);
export const RecitationEnabledContext = createContext(false);
const RecitationContext = createContext<
	| (RecitationTextState & {
			controls: ReactNode;
			playChapter: (() => void) | null;
	  })
	| null
>(null);

/** Mode changes rebuild a scripture body; playback frames update its words. */
export function useRecitationEnabled() {
	return useContext(RecitationEnabledContext);
}

const noopSubscribe = () => () => {};

export function RecitationHeader({ title }: { title: string }) {
	const context = useContext(RecitationContext);
	return (
		<div className={styles.headerRow}>
			{context?.playChapter && title ? (
				<button
					data-flipbook-no-flip
					type="button"
					className={styles.heading}
					data-chapter-play
					title={title}
					aria-label={`הקראת הפרק: ${title}`}
					onClick={context.playChapter}
				>
					{title}
				</button>
			) : (
				<span className={styles.heading} title={title}>
					{title}
				</span>
			)}
			{context?.controls}
		</div>
	);
}

export function RecitationWordControl({
	pasuk,
	segment,
	perek,
	children,
	plainWhenInactive = false,
}: {
	pasuk: number;
	segment: number;
	/** Canonical perek id scopes the word's key for range players whose
	 * plan spans several perakim; chapter players leave it unset. */
	perek?: number;
	children: ReactNode;
	/** The reader can keep the original text without an inert layout box. */
	plainWhenInactive?: boolean;
}) {
	const context = useContext(RecitationTextContext);
	const key =
		perek !== undefined
			? `${perek}:${pasuk}:${segment}`
			: `${pasuk}:${segment}`;
	const word = context?.enabled ? context.wordByKey.get(key) : undefined;
	// The active word lives outside the context value so a word-boundary change
	// re-renders only the two controls whose highlight flips.
	const pressed = useSyncExternalStore(
		context?.subscribeActive ?? noopSubscribe,
		() => context?.isActive(key) ?? false,
		() => false,
	);
	// Keep the text-node boundaries: joining adjacent words changes Hebrew
	// shaping. Listening still restores the original inline control and events.
	if (plainWhenInactive && !word) return <>{children}</>;
	return (
		<InlineRecitationControl
			className={styles.word}
			label={word ? `השמעת המילה ${word.text}` : undefined}
			pressed={pressed}
			onActivate={
				word && context
					? () => context.play(word.startMs, word.endMs, perek)
					: undefined
			}
		>
			{children}
		</InlineRecitationControl>
	);
}

export function RecitationPasukControl({
	pasuk,
	perek,
	children,
	onNavigate,
}: {
	pasuk: number;
	/** Canonical perek id scopes the lookup for range players; chapter
	 * players leave it unset. */
	perek?: number;
	children: ReactNode;
	/**
	 * When set (a perush is open for this perek), activation jumps to the
	 * pasuk's commentary group instead of playing the pasuk.
	 */
	onNavigate?: () => void;
}) {
	const context = useContext(RecitationTextContext);
	const rangeKey = perek !== undefined ? `${perek}:${pasuk}` : String(pasuk);
	const range = context?.enabled
		? (context.rangesByPasuk.get(rangeKey) ?? null)
		: null;
	const label = onNavigate
		? `מעבר לפירוש על פסוק ${toLetters(pasuk)}`
		: `השמעת פסוק ${toLetters(pasuk)}`;
	return (
		<InlineRecitationControl
			className={styles.pasuk}
			label={onNavigate || range ? label : undefined}
			title={onNavigate || range ? label : undefined}
			onActivate={
				onNavigate ??
				(range && context
					? () => context.play(range.startMs, range.endMs)
					: undefined)
			}
		>
			{children}
		</InlineRecitationControl>
	);
}

/** Native buttons form atomic text boxes and change Hebrew spacing and wrapping. */
export function InlineRecitationControl({
	children,
	className,
	label,
	title,
	pressed,
	onActivate,
}: {
	children: ReactNode;
	className: string;
	label?: string;
	title?: string;
	pressed?: boolean;
	onActivate?: () => void;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: The button role, ARIA, focus and keyboard handlers activate together while preserving inline Hebrew typography.
		<span
			className={className}
			data-flipbook-no-flip={onActivate ? true : undefined}
			role={onActivate ? "button" : undefined}
			tabIndex={onActivate ? 0 : undefined}
			aria-label={label}
			aria-pressed={onActivate ? pressed : undefined}
			aria-current={pressed ? "true" : undefined}
			data-recitation-active={pressed || undefined}
			title={title}
			onClick={onActivate}
			onKeyDown={
				onActivate
					? (event) => {
							if (event.key === " ") event.preventDefault();
							if (event.key === "Enter") {
								event.preventDefault();
								onActivate();
							}
						}
					: undefined
			}
			onKeyUp={
				onActivate
					? (event) => {
							if (event.key === " ") {
								event.preventDefault();
								onActivate();
							}
						}
					: undefined
			}
		>
			{children}
		</span>
	);
}

export function RecitationVerse({
	children,
	pasuk,
}: {
	children: ReactNode;
	/** Pasuk number; marks the verse as a sefer pasuk-navigation target. */
	pasuk?: number;
}) {
	return (
		<span className={styles.verse} data-sefer-pasuk={pasuk}>
			{children}
		</span>
	);
}

/** Keep entity links out of listening mode so interactive elements never nest. */
export function RecitationLink({
	children,
	link,
	perek,
}: {
	children: ReactNode;
	link: ReactNode;
	/** Perek whose listening state decides; when the provider narrows mode
	 * per perek (`enabledFor`), a silent perek keeps its link. */
	perek?: number;
}) {
	const context = useContext(RecitationTextContext);
	const listening = context
		? perek !== undefined && context.enabledFor
			? context.enabledFor(perek)
			: context.enabled
		: false;
	return <>{listening ? children : link}</>;
}

export function ListenIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			aria-hidden="true"
		>
			<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z" />
		</svg>
	);
}

export default function RecitationPlayer({
	perekId,
	pesukim,
	hasRecording,
	children,
}: {
	perekId: number;
	pesukim: Pasuk[];
	hasRecording: boolean;
	children?: ReactNode;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<Recitation | null>(null);
	const [message, setMessage] = useState("");
	const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
	const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">(
		"idle",
	);
	// Word-highlight state lives in a mutable store subscribed per word control;
	// updating it re-renders only the affected controls, not the whole column.
	const activeWord = useRef<string | null>(null);
	const activeListeners = useRef(new Set<() => void>());
	const precise = useRef<RecitationAudio | null>(null);
	const settings = useRef<RecitationSettings>(getRecitationSettings());
	const preparing = useRef(false);
	// The last tapped word or pasuk marks where continuous playback resumes, in
	// recording milliseconds; it stays independent of preview stop/reset state.
	const resumeAt = useRef<number | null>(null);
	// Whether the active plan is a bounded word/pasuk preview; the chapter Play
	// button then starts continuous playback at the bookmark instead of pausing.
	const previewActive = useRef(false);
	useEffect(() => {
		const apply = (next: RecitationSettings) => {
			settings.current = next;
			precise.current?.setOptions(next.speed, next.volume);
		};
		apply(getRecitationSettings());
		const changed = (event: Event) =>
			apply((event as CustomEvent<RecitationSettings>).detail);
		const stored = () => apply(getRecitationSettings());
		window.addEventListener(RECITATION_SETTINGS_EVENT, changed);
		window.addEventListener("storage", stored);
		return () => {
			window.removeEventListener(RECITATION_SETTINGS_EVENT, changed);
			window.removeEventListener("storage", stored);
		};
	}, []);
	const setActive = useCallback((key: string | null) => {
		if (activeWord.current === key) return;
		activeWord.current = key;
		for (const listener of activeListeners.current) listener();
	}, []);
	const subscribeActive = useCallback((listener: () => void) => {
		activeListeners.current.add(listener);
		return () => activeListeners.current.delete(listener);
	}, []);
	const isActive = useCallback((key: string) => activeWord.current === key, []);
	const request = useRef(0);
	const createAudio = useCallback((recitation: Recitation) => {
		const player: RecitationAudio = new RecitationAudio(
			recitation.playback?.audioUrl ?? recitation.audioUrl,
			recitation.playback?.audioSha256 ?? recitation.audioSha256,
			(percent) => {
				if (precise.current === player) setDownloadProgress(percent);
			},
			recitation.playback?.format ?? "mp3",
		);
		return player;
	}, []);

	const stop = useCallback((release = false) => {
		request.current++;
		previewActive.current = false;
		precise.current?.stop();
		if (release) {
			precise.current?.dispose();
			precise.current = null;
		}
		setState("idle");
		setActive(null);
	}, [setActive]);

	useEffect(() => {
		const onStop = (event: Event) => {
			const release = (event as CustomEvent<string>).detail !== id;
			if (release && preparing.current) setOpen(false);
			stop(release);
		};
		const onVisibility = () => {
			if (document.hidden) {
				if (preparing.current) setOpen(false);
				stop(true);
			}
		};
		window.addEventListener(STOP_EVENT, onStop);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stop(true);
			window.removeEventListener(STOP_EVENT, onStop);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [id, stop]);

	useEffect(() => {
		stop(true);
		setData(null);
		// A new perek or recording never inherits a stale resume position.
		resumeAt.current = null;
		if (!hasRecording) {
			setOpen(false);
			setMessage("");
			setDownloadProgress(null);
			return;
		}
		if (!open) return;
		window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
		const controller = new AbortController();
		preparing.current = true;
		setMessage(LOADING_MESSAGE);
		setDownloadProgress(null);
		fetch(`/api/recitation/${perekId}`, {
			signal: controller.signal,
			cache: "no-store",
		})
			.then(async (response) => {
				if (controller.signal.aborted) return;
				if (response.status === 404) {
					setMessage("עדיין אין הקלטה לפרק זה.");
					return;
				}
				if (!response.ok) throw new Error("Unable to load recording");
				const recitation = parseRecitation(
					await response.json(),
					perekId,
					pesukim,
				);
				if (controller.signal.aborted) return;
				const player = createAudio(recitation);
				precise.current = player;
				await player.prepare();
				if (controller.signal.aborted || precise.current !== player) return;
				preparing.current = false;
				setData(recitation);
				setMessage("");
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setMessage("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב.");
			})
			.finally(() => {
				if (!controller.signal.aborted) preparing.current = false;
			});
		return () => {
			preparing.current = false;
			controller.abort();
			stop(true);
		};
	}, [open, hasRecording, perekId, pesukim, stop, id, createAudio]);

	const finish = useCallback(() => {
		previewActive.current = false;
		setState("idle");
		setActive(null);
	}, [setActive]);
	const fail = useCallback(() => {
		stop();
		setMessage("ההקלטה לא נטענה. נסו שוב.");
	}, [stop]);

	const play = useCallback(async (startMs?: number, endMs?: number) => {
		/* istanbul ignore next: play is only reachable from enabled controls, which require a loaded manifest */
		if (!data) return;
		window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
		const generation = ++request.current;
		setMessage("");
		setState("loading");
		setDownloadProgress(null);
		setActive(null);
		// A tapped word or pasuk previews just that interval and marks where the
		// next continuous playback resumes, even if Play is pressed mid-preview.
		const preview = startMs !== undefined && endMs !== undefined;
		previewActive.current = preview;
		if (preview) resumeAt.current = startMs;
		try {
			precise.current ??= createAudio(data);
			precise.current.setOptions(
				settings.current.speed,
				settings.current.volume,
			);
			const ended = () => {
				if (request.current !== generation) return;
				// Reaching the end of the perek consumes the resume position.
				if (!preview) resumeAt.current = null;
				finish();
			};
			const resume = resumeAt.current;
			const started = await (preview
				? precise.current.play(startMs, endMs, ended)
				: data.alignmentStatus === "ready" &&
						settings.current.versePauseMs !== null
					? precise.current.playRanges(
							resumeRanges(playableWords(data), resume),
							settings.current.versePauseMs,
							ended,
						)
					: resume === null
						? precise.current.playChapter(ended)
						: precise.current.play(resume, undefined, ended));
			if (!started) return;
			if (request.current === generation) setState("playing");
		} catch {
			if (request.current === generation) fail();
		}
	}, [data, id, createAudio, finish, fail, setActive]);

	const togglePlayback = useCallback(async () => {
		if (state === "loading") return;
		if (state === "playing" || state === "paused") {
			// A bounded word/pasuk preview is not the chapter's playback: Play
			// during one starts continuous playback at the bookmark.
			if (previewActive.current) {
				request.current++;
				precise.current?.stop();
				await play();
				return;
			}
			if (state === "paused") {
				const generation = request.current;
				setState("loading");
				try {
					if (!(await precise.current?.resume())) {
						if (request.current === generation) finish();
						return;
					}
					if (request.current === generation) setState("playing");
				} catch {
					if (request.current === generation) fail();
				}
				return;
			}
			if (!precise.current?.pause()) {
				finish();
				return;
			}
			setState("paused");
			return;
		}
		await play();
	}, [state, play, finish, fail]);

	const alignedWords = useMemo(() => playableWords(data), [data]);
	const textEnabled = open && alignedWords.length > 0;
	// O(1) lookup structures shared by every word/pasuk control via context.
	const wordByKey = useMemo(
		() =>
			new Map(
				alignedWords.map((word) => [
					`${word.pasuk}:${word.segment}`,
					word,
				]),
			),
		[alignedWords],
	);
	const rangesByPasuk = useMemo(() => {
		const ranges = new Map<string, { startMs: number; endMs: number }>();
		for (const word of alignedWords) {
			const key = String(word.pasuk);
			const range = ranges.get(key);
			if (range) range.endMs = word.endMs;
			else ranges.set(key, { startMs: word.startMs, endMs: word.endMs });
		}
		return ranges;
	}, [alignedWords]);
	// Loading/progress/header updates must not invalidate every scripture word.
	// Keep the original word elements and highlight state while sharing only
	// changes that text controls actually consume.
	const textState = useMemo<RecitationTextState>(
		() => ({
			enabled: textEnabled,
			wordByKey,
			rangesByPasuk,
			subscribeActive,
			isActive,
			play: (start, end) => void play(start, end),
		}),
		[textEnabled, wordByKey, rangesByPasuk, subscribeActive, isActive, play],
	);
	useEffect(() => {
		if (state !== "playing" || alignedWords.length === 0) return;
		let frame = 0;
		const update = () => {
			const word = wordAtPosition(
				alignedWords,
				precise.current?.positionMs ?? null,
			);
			setActive(word ? `${word.pasuk}:${word.segment}` : null);
			frame = requestAnimationFrame(update);
		};
		update();
		return () => cancelAnimationFrame(frame);
	}, [state, alignedWords, setActive]);
	// Memoized so unrelated renders keep the context value (and consumers) stable.
	const controls = useMemo(() => {
		const loading =
			open && (message === LOADING_MESSAGE || state === "loading");
		const status =
			message ||
			(state === "loading"
				? LOADING_MESSAGE
				: state === "playing"
					? "משמיע…"
					: state === "paused"
						? "מושהה"
						: data && alignedWords.length > 0
							? "בחרו אות פסוק או מילה להקראה"
							: "");
		return (
			perekId > 0 && (
		<span className={styles.controls}>
			{open && data && (
				<button
					data-flipbook-no-flip
					type="button"
					className={styles.action}
					data-chapter-play
					onClick={() => void togglePlayback()}
					disabled={state === "loading"}
					aria-label={
						state === "playing" && !previewActive.current
							? "השהיית ההקראה"
							: state === "paused" && !previewActive.current
								? "המשך ההקראה"
								: "השמעת כל הפרק"
					}
					title={
						state === "playing" && !previewActive.current
							? "השהיית ההקראה"
							: state === "paused" && !previewActive.current
								? "המשך ההקראה"
								: "השמעת כל הפרק"
					}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
						{state === "playing" && !previewActive.current ? (
							<path d="M3 2h4v12H3Zm6 0h4v12H9Z" fill="currentColor" />
						) : (
							<path d="M4 2v12l10-6Z" fill="currentColor" />
						)}
					</svg>
				</button>
			)}
			{open && data && (
				<button
					data-flipbook-no-flip
					type="button"
					className={styles.action}
					aria-label="הגדרות קריינות"
					aria-haspopup="dialog"
					onClick={(event) =>
						openReaderSettings("recitation", event.currentTarget, true)
					}
				>
					<SettingsIcon />
				</button>
			)}
			<button
				data-flipbook-no-flip
				type="button"
				className={styles.toggle}
				aria-pressed={open && data !== null}
				aria-busy={loading}
				aria-label="מצב הקראה"
				disabled={!hasRecording}
				title={hasRecording ? undefined : NO_RECORDING_MESSAGE}
				onClick={() => setOpen((value) => !value)}
			>
				<ListenIcon />
					{loading && (
					<svg
						className={styles.progress}
						viewBox="0 0 36 36"
						role="progressbar"
						aria-label={LOADING_MESSAGE}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={downloadProgress ?? undefined}
						data-indeterminate={downloadProgress === null}
					>
						<circle className={styles.progressTrack} cx="18" cy="18" r="16" />
						<circle
							className={styles.progressValue}
							cx="18"
							cy="18"
							r="16"
							pathLength="100"
							strokeDasharray={downloadProgress === null ? "25 75" : "100"}
							strokeDashoffset={
								downloadProgress === null ? 0 : 100 - downloadProgress
							}
							transform="rotate(-90 18 18)"
						/>
					</svg>
				)}
			</button>
			{open && (
				<span
					className={message || loading ? styles.notice : styles.srOnly}
					role="status"
					aria-live="polite"
				>
					{status}
				</span>
			)}
		</span>
			)
		);
	}, [
		perekId,
		open,
		data,
		state,
		message,
		downloadProgress,
		hasRecording,
		alignedWords,
		togglePlayback,
	]);
	const value = useMemo(
		() => ({
			...textState,
			controls,
			playChapter: open && data ? () => void togglePlayback() : null,
		}),
		[textState, controls, open, data, togglePlayback],
	);
	return (
		<RecitationContext.Provider value={value}>
			<RecitationTextContext.Provider value={textState}>
				<RecitationEnabledContext.Provider value={textEnabled}>
					{children}
				</RecitationEnabledContext.Provider>
			</RecitationTextContext.Provider>
		</RecitationContext.Provider>
	);
}
