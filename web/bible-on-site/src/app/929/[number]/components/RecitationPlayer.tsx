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
	const request = useRef(0);
	const kind = useRef<"chapter" | "clip" | null>(null);

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
		const onStop = (event: Event) =>
			stop((event as CustomEvent<string>).detail !== id);
		const onVisibility = () => {
			if (document.hidden) stop(true);
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
		const controller = new AbortController();
		setMessage("טוען הקלטה…");
		fetch(`/api/recitation/${perekId}`, { signal: controller.signal })
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
				setData(recitation);
				setMessage("");
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setMessage("לא ניתן לטעון את ההקלטה. נסו לפתוח שוב.");
			});
		return () => {
			controller.abort();
			stop(true);
		};
	}, [open, perekId, pesukim, stop]);

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
		const token = ++request.current;
		setMessage("");
		setState("loading");
		setActiveWord(segment ?? null);
		try {
			if (startMs !== undefined && endMs !== undefined) {
				kind.current = "clip";
				precise.current ??= new RecitationAudio(
					data.audioUrl,
					data.audioSha256,
				);
				const started = await precise.current.play(startMs, endMs, () => {
					if (request.current === token) finish();
				});
				if (!started) return;
			} else {
				kind.current = "chapter";
				audio.current.currentTime = 0;
				await audio.current.play();
			}
			if (request.current === token) setState("playing");
		} catch {
			if (request.current === token) fail();
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
			const token = request.current;
			setState("loading");
			try {
				if (kind.current === "clip") {
					if (!(await precise.current?.resume())) {
						if (request.current === token) finish();
						return;
					}
				} else await audio.current?.play();
				if (request.current === token) setState("playing");
			} catch {
				if (request.current === token) fail();
			}
			return;
		}
		await play();
	}

	const alignedWords = useMemo(() => playableWords(data), [data]);
	const status =
		message ||
		(state === "loading"
			? "טוען שמע…"
			: state === "playing"
				? "משמיע…"
				: state === "paused"
					? "מושהה"
					: data && alignedWords.length === 0
						? "זמינה הקראת הפרק המלא"
						: data
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
				aria-pressed={open}
				aria-label="מצב הקראה"
				title={
					open ? "כיבוי מצב הקראה" : "מצב הקראה: לחצו על אות פסוק או על מילה"
				}
				onClick={() => setOpen((value) => !value)}
			>
				<ListenIcon />
			</button>
			{open && (
				<span
					className={
						message || (data && alignedWords.length === 0)
							? styles.notice
							: styles.srOnly
					}
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
