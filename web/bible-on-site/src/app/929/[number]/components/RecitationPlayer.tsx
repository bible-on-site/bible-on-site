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
} from "@/lib/recitation";
import { RecitationAudio } from "@/lib/recitation-audio";
import styles from "./recitation-player.module.css";

const STOP_EVENT = "recitation-stop";
const LOADING_MESSAGE = "טעינה על הפרק...";
export function stopRecitation() {
	window.dispatchEvent(new Event(STOP_EVENT));
}
const RecitationContext = createContext<{
	controls: ReactNode;
	playChapter: (() => void) | null;
	enabled: boolean;
	words: RecitationWord[];
	activeWord: string | null;
	play: (start: number, end: number, word?: string) => void;
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
	if (!word || !context) return <>{children}</>;
	const key = `${pasuk}:${segment}`;
	return (
		<button
			data-flipbook-no-flip
			type="button"
			className={styles.word}
			aria-label={`השמעת המילה ${word.text}`}
			aria-pressed={context.activeWord === key}
			onClick={() => context.play(word.startMs, word.endMs, key)}
		>
			{children}
		</button>
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
	if (!range || !context) return <>{children}</>;
	return (
		<button
			data-flipbook-no-flip
			type="button"
			className={styles.pasuk}
			aria-label={`השמעת פסוק ${toLetters(pasuk)}`}
			title={`השמעת פסוק ${toLetters(pasuk)}`}
			onClick={() => context.play(range.startMs, range.endMs)}
		>
			{children}
		</button>
	);
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
	children,
}: {
	perekId: number;
	pesukim: Pasuk[];
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
	const audio = useRef<HTMLAudioElement | null>(null);
	const attachAudio = useCallback((element: HTMLAudioElement | null) => {
		audio.current?.pause();
		audio.current = element;
	}, []);
	const precise = useRef<RecitationAudio | null>(null);
	const preparing = useRef(false);
	const request = useRef(0);
	const kind = useRef<"chapter" | "clip" | null>(null);
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
		kind.current = null;
		audio.current?.pause();
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
	}, [open, perekId, pesukim, stop, id, createAudio]);

	function finish() {
		setState("idle");
		setActiveWord(null);
	}
	function fail() {
		stop();
		setMessage("ההקלטה לא נטענה. נסו שוב.");
	}

	async function play(startMs?: number, endMs?: number, segment?: string) {
		if (!data || !audio.current) return;
		window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
		const generation = ++request.current;
		setMessage("");
		setState("loading");
		setDownloadProgress(null);
		setActiveWord(segment ?? null);
		try {
			if (startMs !== undefined && endMs !== undefined) {
				kind.current = "clip";
				precise.current ??= createAudio(data);
				const started = await precise.current.play(startMs, endMs, () => {
					if (request.current === generation) finish();
				});
				if (!started) return;
			} else {
				kind.current = "chapter";
				audio.current.currentTime = 0;
				await audio.current.play();
			}
			if (request.current === generation) setState("playing");
		} catch {
			if (request.current === generation) fail();
		}
	}

	async function togglePlayback() {
		if (state === "loading") return;
		if (state === "playing") {
			if (kind.current === "clip") {
				if (!precise.current?.pause()) {
					finish();
					return;
				}
			} else audio.current?.pause();
			setState("paused");
			return;
		}
		if (state === "paused") {
			const generation = request.current;
			setState("loading");
			try {
				if (kind.current === "clip") {
					if (!(await precise.current?.resume())) {
						if (request.current === generation) finish();
						return;
					}
				} else await audio.current?.play();
				if (request.current === generation) setState("playing");
			} catch {
				if (request.current === generation) fail();
			}
			return;
		}
		await play();
	}

	const alignedWords = useMemo(() => playableWords(data), [data]);
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
			<button
				data-flipbook-no-flip
				type="button"
				className={styles.toggle}
				aria-pressed={open && data !== null}
				aria-busy={loading}
				aria-label="מצב הקראה"
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
				play: (start, end, word) => void play(start, end, word),
			}}
		>
			{open && data && (
				// biome-ignore lint/a11y/useMediaCaption: The visible scripture is the transcript.
				<audio
					ref={attachAudio}
					src={data.audioUrl}
					preload="none"
					onEnded={() => {
						if (kind.current === "chapter") finish();
					}}
					onError={() => {
						if (kind.current === "chapter") fail();
					}}
				/>
			)}
			{children}
		</RecitationContext.Provider>
	);
}
