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
} from "react";
import type { Pasuk } from "@/data/db/tanah-view-types";
import {
	parseRecitation,
	playableWords,
	type Recitation,
	type RecitationWord,
	verseRange,
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
const RecitationContext = createContext<{
	controls: ReactNode;
	playChapter: (() => void) | null;
	enabled: boolean;
	words: RecitationWord[];
	activeWord: string | null;
	play: (start: number, end: number) => void;
} | null>(null);

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
	children,
}: {
	pasuk: number;
	segment: number;
	children: ReactNode;
}) {
	const context = useContext(RecitationContext);
	const word = context?.enabled
		? context.words.find((w) => w.pasuk === pasuk && w.segment === segment)
		: undefined;
	const key = `${pasuk}:${segment}`;
	return (
		<InlineRecitationControl
			className={styles.word}
			label={word ? `השמעת המילה ${word.text}` : undefined}
			pressed={context?.activeWord === key}
			onActivate={
				word && context
					? () => context.play(word.startMs, word.endMs)
					: undefined
			}
		>
			{children}
		</InlineRecitationControl>
	);
}

export function RecitationPasukControl({
	pasuk,
	children,
}: {
	pasuk: number;
	children: ReactNode;
}) {
	const context = useContext(RecitationContext);
	const range = context?.enabled ? verseRange(context.words, pasuk) : null;
	const label = `השמעת פסוק ${toLetters(pasuk)}`;
	return (
		<InlineRecitationControl
			className={styles.pasuk}
			label={range ? label : undefined}
			title={range ? label : undefined}
			onActivate={
				range && context
					? () => context.play(range.startMs, range.endMs)
					: undefined
			}
		>
			{children}
		</InlineRecitationControl>
	);
}

/** Native buttons form atomic text boxes and change Hebrew spacing and wrapping. */
function InlineRecitationControl({
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

export function RecitationVerse({ children }: { children: ReactNode }) {
	return <span className={styles.verse}>{children}</span>;
}

/** Keep entity links out of listening mode so interactive elements never nest. */
export function RecitationLink({
	children,
	link,
}: {
	children: ReactNode;
	link: ReactNode;
}) {
	const context = useContext(RecitationContext);
	return <>{context?.enabled ? children : link}</>;
}

function ListenIcon() {
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
	const [activeWord, setActiveWord] = useState<string | null>(null);
	const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">(
		"idle",
	);
	const precise = useRef<RecitationAudio | null>(null);
	const settings = useRef<RecitationSettings>(getRecitationSettings());
	const preparing = useRef(false);
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
	const request = useRef(0);
	const createAudio = useCallback((recitation: Recitation) => {
		const player: RecitationAudio = new RecitationAudio(
			recitation.audioUrl,
			recitation.audioSha256,
			(percent) => {
				if (precise.current === player) setDownloadProgress(percent);
			},
		);
		return player;
	}, []);

	const stop = useCallback((release = false) => {
		request.current++;
		precise.current?.stop();
		if (release) {
			precise.current?.dispose();
			precise.current = null;
		}
		setState("idle");
		setActiveWord(null);
	}, []);

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

	function finish() {
		setState("idle");
		setActiveWord(null);
	}
	function fail() {
		stop();
		setMessage("ההקלטה לא נטענה. נסו שוב.");
	}

	async function play(startMs?: number, endMs?: number) {
		if (!data) return;
		window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
		const generation = ++request.current;
		setMessage("");
		setState("loading");
		setDownloadProgress(null);
		setActiveWord(null);
		try {
			precise.current ??= createAudio(data);
			precise.current.setOptions(
				settings.current.speed,
				settings.current.volume,
			);
			const ended = () => {
				if (request.current === generation) finish();
			};
			const started = await (startMs !== undefined && endMs !== undefined
				? precise.current.play(startMs, endMs, ended)
				: data.alignmentStatus === "ready" &&
						settings.current.versePauseMs !== null
					? precise.current.playRanges(
							[...new Set(data.words.map((w) => w.pasuk))].map(
								(pasuk) =>
									verseRange(playableWords(data), pasuk) as {
										startMs: number;
										endMs: number;
									},
							),
							settings.current.versePauseMs,
							ended,
						)
					: precise.current.playChapter(ended));
			if (!started) return;
			if (request.current === generation) setState("playing");
		} catch {
			if (request.current === generation) fail();
		}
	}

	async function togglePlayback() {
		if (state === "loading") return;
		if (state === "playing") {
			if (!precise.current?.pause()) {
				finish();
				return;
			}
			setState("paused");
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
		await play();
	}

	const alignedWords = useMemo(() => playableWords(data), [data]);
	useEffect(() => {
		if (state !== "playing" || alignedWords.length === 0) return;
		let frame = 0;
		const update = () => {
			const word = wordAtPosition(
				alignedWords,
				precise.current?.positionMs ?? null,
			);
			setActiveWord(word ? `${word.pasuk}:${word.segment}` : null);
			frame = requestAnimationFrame(update);
		};
		update();
		return () => cancelAnimationFrame(frame);
	}, [state, alignedWords]);
	const loading = open && (message === LOADING_MESSAGE || state === "loading");
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
	const controls = perekId > 0 && (
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
						state === "playing"
							? "השהיית ההקראה"
							: state === "paused"
								? "המשך ההקראה"
								: "השמעת כל הפרק"
					}
					title={
						state === "playing"
							? "השהיית ההקראה"
							: state === "paused"
								? "המשך ההקראה"
								: "השמעת כל הפרק"
					}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
						{state === "playing" ? (
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
						openReaderSettings("recitation", event.currentTarget)
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
	);
	return (
		<RecitationContext.Provider
			value={{
				controls,
				playChapter: open && data ? () => void togglePlayback() : null,
				enabled: open && alignedWords.length > 0,
				words: alignedWords,
				activeWord,
				play: (start, end) => void play(start, end),
			}}
		>
			{children}
		</RecitationContext.Provider>
	);
}
