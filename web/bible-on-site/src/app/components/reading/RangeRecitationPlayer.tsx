"use client";

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
import {
	ListenIcon,
	RecitationEnabledContext,
	RecitationTextContext,
} from "@/app/929/[number]/components/RecitationPlayer";
import styles from "@/app/929/[number]/components/recitation-player.module.css";
import SettingsIcon from "@/app/929/[number]/components/SettingsIcon";
import type { Pasuk } from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";
import {
	parseRecitation,
	pieceIndexContaining,
	playableWords,
	type Recitation,
	type RecitationPlaybackPiece,
	type RecitationWord,
	rangePlaybackPieces,
	resumePieces,
	wordAtPosition,
} from "@/lib/recitation";
import { RecitationAudio } from "@/lib/recitation-audio";
import {
	getRecitationSettings,
	openReaderSettings,
	RECITATION_SETTINGS_EVENT,
	type RecitationSettings,
} from "@/lib/recitation-settings";

const STOP_EVENT = "recitation-stop";
const LOADING_MESSAGE = "טעינה על הפרק...";
const NO_RECORDING_MESSAGE = "אין הקלטה לקריאה זו";

/** The perek payload a range reading needs: canonical words for manifest
 * validation plus whether a recording exists at all. */
export interface RangeRecitationPerek {
	perekId: number;
	pesukim: Pasuk[];
	hasRecording: boolean;
}

interface RangeControlsState {
	open: boolean;
	loading: boolean;
	state: "idle" | "loading" | "playing" | "paused";
	message: string;
	downloadProgress: number | null;
	hasRecording: boolean;
	canPlay: boolean;
	previewActive: () => boolean;
	toggle: () => void;
	togglePlayback: () => void;
}

const RangeControlsContext = createContext<RangeControlsState | null>(null);

/**
 * Shared range-recitation engine (issue #3259): plays an ordered
 * `ScriptureRange[]` reading across one or several perakim, reusing the
 * chapter reader's contexts so `RecitationWordControl`/`RecitationPasukControl`
 * wire word highlighting and tapped-word playback unchanged. Word and
 * pasuk keys carry the canonical perek id (`perek:pasuk:segment`) so
 * readings spanning perakim — or repeating one — never collide.
 */
export function RangeRecitationPlayer({
	ranges,
	perakim,
	children,
}: {
	ranges: ScriptureRange[];
	/** Every perek the ranges touch, with canonical pesukim and a
	 * recording-presence flag; perakim missing here are skipped. */
	perakim: RangeRecitationPerek[];
	children?: ReactNode;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [manifests, setManifests] = useState<Map<number, Recitation> | null>(
		null,
	);
	const [message, setMessage] = useState("");
	const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
	const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">(
		"idle",
	);
	const activeWord = useRef<string | null>(null);
	const activeListeners = useRef(new Set<() => void>());
	const audios = useRef(new Map<number, RecitationAudio>());
	const manifestsRef = useRef<Map<number, Recitation> | null>(null);
	const settings = useRef<RecitationSettings>(getRecitationSettings());
	const preparing = useRef(false);
	const request = useRef(0);
	// Sequential-play bookkeeping: the piece index being scheduled, the
	// audio currently speaking, and a "held" index when pause lands in
	// the gap between two pieces' recordings.
	const activeQueue = useRef<RecitationPlaybackPiece[]>([]);
	const queueIndex = useRef(0);
	// `queueIndex` is relative to `activeQueue`, which may be a bookmarked
	// subset of `pieces`; the base maps it back to absolute plan indices.
	const queueBaseIndex = useRef(0);
	const heldIndex = useRef<number | null>(null);
	const pausedAudio = useRef<RecitationAudio | null>(null);
	const activeAudioId = useRef<number | null>(null);
	const activeWords = useRef<RecitationWord[]>([]);
	// Tapped-word bookmark — where the next continuous playback resumes.
	const resumeAt = useRef<{ pieceIndex: number; ms: number } | null>(null);
	const previewActive = useRef(false);

	const perakimById = useMemo(
		() => new Map(perakim.map((perek) => [perek.perekId, perek])),
		[perakim],
	);
	const hasRecording = perakim.some((perek) => perek.hasRecording);
	const pasukCount = useCallback(
		(perekId: number) => perakimById.get(perekId)?.pesukim.length ?? 0,
		[perakimById],
	);

	useEffect(() => {
		const apply = (next: RecitationSettings) => {
			settings.current = next;
			for (const audio of audios.current.values()) {
				audio.setOptions(next.speed, next.volume);
			}
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

	const stop = useCallback(
		(release = false) => {
			request.current++;
			previewActive.current = false;
			heldIndex.current = null;
			pausedAudio.current = null;
			activeAudioId.current = null;
			for (const audio of audios.current.values()) {
				audio.stop();
				if (release) audio.dispose();
			}
			if (release) audios.current.clear();
			setState("idle");
			setActive(null);
		},
		[setActive],
	);

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

	const finish = useCallback(() => {
		previewActive.current = false;
		setState("idle");
		setActive(null);
	}, [setActive]);
	const fail = useCallback(() => {
		stop();
		setMessage("ההקלטה לא נטענה. נסו שוב.");
	}, [stop]);

	const audioFor = useCallback((recitation: Recitation) => {
		const existing = audios.current.get(recitation.perekId);
		if (existing) return existing;
		const created: RecitationAudio = new RecitationAudio(
			recitation.playback?.audioUrl ?? recitation.audioUrl,
			recitation.playback?.audioSha256 ?? recitation.audioSha256,
			(percent) => {
				if (audios.current.get(recitation.perekId) === created)
					setDownloadProgress(percent);
			},
			recitation.playback?.format ?? "mp3",
		);
		created.setOptions(settings.current.speed, settings.current.volume);
		audios.current.set(recitation.perekId, created);
		return created;
	}, []);

	// Schedule the queue piece-by-piece on the audio clock: each perek's
	// ended callback chains the next piece, keeping declared range order.
	const playPiece = useCallback(
		(
			generation: number,
			queue: RecitationPlaybackPiece[],
			index: number,
			pauseMs: number,
		) => {
			if (request.current !== generation || heldIndex.current !== null) return;
			if (index >= queue.length) {
				// Reaching the end of the reading consumes the resume bookmark.
				resumeAt.current = null;
				finish();
				return;
			}
			const piece = queue[index];
			const recitation = manifestsRef.current?.get(piece.perekId);
			/* istanbul ignore if: pieces only exist for manifest-backed perakim */
			if (!recitation) {
				playPiece(generation, queue, index + 1, pauseMs);
				return;
			}
			const audio = audioFor(recitation);
			queueIndex.current = index;
			activeAudioId.current = piece.perekId;
			activeWords.current = playableWords(recitation);
			audio
				.playRanges(piece.intervals, pauseMs, () => {
					activeAudioId.current = null;
					playPiece(generation, queue, index + 1, pauseMs);
				})
				.then((started) => {
					/* istanbul ignore if: a false start means the audio was
					 * stopped or superseded — the matching stop path owns state */
					if (!started && request.current === generation) return;
				})
				.catch(() => {
					if (request.current === generation) fail();
				});
		},
		[audioFor, fail, finish],
	);

	const wordsByPerek = useMemo(() => {
		const map = new Map<number, RecitationWord[]>();
		for (const [perekId, recitation] of manifests ?? []) {
			map.set(perekId, playableWords(recitation));
		}
		return map;
	}, [manifests]);
	const pieces = useMemo(
		() => rangePlaybackPieces(ranges, pasukCount, wordsByPerek),
		[ranges, pasukCount, wordsByPerek],
	);

	useEffect(() => {
		stop(true);
		setManifests(null);
		manifestsRef.current = null;
		// A new plan never inherits a stale resume position.
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
		const targets = perakim.filter((perek) => perek.hasRecording);
		Promise.all(
			targets.map(async (target) => {
				const response = await fetch(`/api/recitation/${target.perekId}`, {
					signal: controller.signal,
					cache: "no-store",
				});
				// A perek whose recording is absent is skipped — the reading
				// still plays its recorded pieces in declared order.
				if (response.status === 404) return null;
				if (!response.ok) throw new Error("Unable to load recording");
				const recitation = parseRecitation(
					await response.json(),
					target.perekId,
					target.pesukim,
				);
				return [target.perekId, recitation] as const;
			}),
		)
			.then((entries) => {
				if (controller.signal.aborted) return;
				preparing.current = false;
				const loaded = new Map(
					entries.filter(
						(entry): entry is NonNullable<typeof entry> => entry !== null,
					),
				);
				if (loaded.size === 0) {
					setMessage("עדיין אין הקלטה לקריאה זו.");
					return;
				}
				manifestsRef.current = loaded;
				setManifests(loaded);
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
	}, [open, hasRecording, perakim, stop, id]);

	const playAll = useCallback(async () => {
		if (!manifestsRef.current || pieces.length === 0) return;
		window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
		const generation = ++request.current;
		setMessage("");
		setState("loading");
		setDownloadProgress(null);
		setActive(null);
		previewActive.current = false;
		heldIndex.current = null;
		pausedAudio.current = null;
		const bookmark = resumeAt.current;
		const queue = bookmark
			? resumePieces(pieces, bookmark.pieceIndex, bookmark.ms)
			: pieces;
		activeQueue.current = queue;
		queueBaseIndex.current = bookmark?.pieceIndex ?? 0;
		// Words only exist for fully aligned manifests, so a plan with
		// pieces is always alignment-ready; the verse-pause applies as-is.
		const pauseMs = settings.current.versePauseMs ?? 0;
		playPiece(generation, queue, 0, pauseMs);
		if (request.current === generation) setState("playing");
	}, [pieces, id, playPiece, setActive]);

	// Word tap → bounded preview on that perek's recording plus a resume
	// bookmark for the next continuous playback.
	const play = useCallback(
		async (startMs: number, endMs: number, perekId?: number) => {
			if (perekId === undefined) return;
			const recitation = manifestsRef.current?.get(perekId);
			if (!recitation) return;
			window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: id }));
			const generation = ++request.current;
			setMessage("");
			setState("loading");
			setDownloadProgress(null);
			setActive(null);
			previewActive.current = true;
			heldIndex.current = null;
			pausedAudio.current = null;
			// A repeated passage renders identical words in several pieces;
			// prefer the copy at/after the reading's current position so the
			// bookmark lands on the occurrence the listener actually reached.
			const pieceIndex = pieceIndexContaining(
				pieces,
				perekId,
				startMs,
				queueBaseIndex.current + queueIndex.current,
			);
			resumeAt.current = pieceIndex < 0 ? null : { pieceIndex, ms: startMs };
			try {
				const audio = audioFor(recitation);
				activeAudioId.current = perekId;
				activeWords.current = playableWords(recitation);
				const started = await audio.play(startMs, endMs, () => {
					if (request.current !== generation) return;
					activeAudioId.current = null;
					finish();
				});
				if (!started) return;
				if (request.current === generation) setState("playing");
			} catch {
				if (request.current === generation) fail();
			}
		},
		[audioFor, fail, finish, id, pieces, setActive],
	);

	const togglePlayback = useCallback(async () => {
		if (state === "loading") return;
		if (state === "playing" || state === "paused") {
			// A bounded word preview is not the reading's playback: Play
			// during one starts continuous playback at the bookmark.
			if (previewActive.current) {
				request.current++;
				for (const audio of audios.current.values()) audio.stop();
				await playAll();
				return;
			}
			if (state === "paused") {
				const generation = request.current;
				setState("loading");
				try {
					const paused = pausedAudio.current;
					if (paused) {
						pausedAudio.current = null;
						if (!(await paused.resume())) {
							if (request.current === generation) finish();
							return;
						}
					} else {
						const index = heldIndex.current;
						heldIndex.current = null;
						if (index === null || index >= activeQueue.current.length) {
							if (request.current === generation) finish();
							return;
						}
						const pauseMs = settings.current.versePauseMs ?? 0;
						playPiece(generation, activeQueue.current, index, pauseMs);
					}
					if (request.current === generation) setState("playing");
				} catch {
					if (request.current === generation) fail();
				}
				return;
			}
			// Pause: the live audio may already be between pieces — the held
			// index marks where resume continues when it is.
			const audio =
				activeAudioId.current !== null
					? audios.current.get(activeAudioId.current)
					: undefined;
			heldIndex.current = queueIndex.current + 1;
			if (audio?.pause()) {
				pausedAudio.current = audio;
				heldIndex.current = null;
			}
			setState("paused");
			return;
		}
		await playAll();
	}, [state, playAll, playPiece, finish, fail]);

	const alignedWords = useMemo(
		() => [...wordsByPerek.values()].flat(),
		[wordsByPerek],
	);
	const textEnabled = open && alignedWords.length > 0;
	const wordByKey = useMemo(() => {
		const map = new Map<string, RecitationWord>();
		for (const [perekId, words] of wordsByPerek) {
			for (const word of words) {
				map.set(`${perekId}:${word.pasuk}:${word.segment}`, word);
			}
		}
		return map;
	}, [wordsByPerek]);
	const rangesByPasuk = useMemo(() => {
		const map = new Map<string, { startMs: number; endMs: number }>();
		for (const [perekId, words] of wordsByPerek) {
			for (const word of words) {
				const key = `${perekId}:${word.pasuk}`;
				const range = map.get(key);
				if (range) range.endMs = word.endMs;
				else map.set(key, { startMs: word.startMs, endMs: word.endMs });
			}
		}
		return map;
	}, [wordsByPerek]);
	const textState = useMemo(
		() => ({
			enabled: textEnabled,
			// A mixed section keeps listening mode per perek: a perek whose
			// manifest never loaded (no recording) has no words, so its text
			// stays inert and its entity links stay intact.
			enabledFor: (perekId: number) =>
				textEnabled && (wordsByPerek.get(perekId)?.length ?? 0) > 0,
			wordByKey,
			rangesByPasuk,
			subscribeActive,
			isActive,
			play: (start: number, end: number, perekId?: number) =>
				void play(start, end, perekId),
		}),
		[
			textEnabled,
			wordsByPerek,
			wordByKey,
			rangesByPasuk,
			subscribeActive,
			isActive,
			play,
		],
	);

	useEffect(() => {
		if (state !== "playing" || alignedWords.length === 0) return;
		let frame = 0;
		const update = () => {
			const audio =
				activeAudioId.current !== null
					? audios.current.get(activeAudioId.current)
					: undefined;
			const word = wordAtPosition(
				activeWords.current,
				audio?.positionMs ?? null,
			);
			setActive(
				word && activeAudioId.current !== null
					? `${activeAudioId.current}:${word.pasuk}:${word.segment}`
					: null,
			);
			frame = requestAnimationFrame(update);
		};
		update();
		return () => cancelAnimationFrame(frame);
	}, [state, alignedWords, setActive]);

	const controlsValue = useMemo<RangeControlsState>(
		() => ({
			open,
			loading: open && (message === LOADING_MESSAGE || state === "loading"),
			state,
			message:
				message ||
				(state === "loading"
					? LOADING_MESSAGE
					: state === "playing"
						? "משמיע…"
						: state === "paused"
							? "מושהה"
							: manifests && alignedWords.length > 0
								? "בחרו אות מילה להקראה"
								: ""),
			downloadProgress,
			hasRecording,
			canPlay: pieces.length > 0,
			previewActive: () => previewActive.current,
			toggle: () => setOpen((value) => !value),
			togglePlayback: () => void togglePlayback(),
		}),
		[
			open,
			state,
			message,
			manifests,
			alignedWords,
			downloadProgress,
			hasRecording,
			pieces,
			togglePlayback,
		],
	);

	return (
		<RangeControlsContext.Provider value={controlsValue}>
			<RecitationTextContext.Provider value={textState}>
				<RecitationEnabledContext.Provider value={textEnabled}>
					{children}
				</RecitationEnabledContext.Provider>
			</RecitationTextContext.Provider>
		</RangeControlsContext.Provider>
	);
}

/**
 * The shared listening controls for a range reading — same button
 * vocabulary as the chapter player (listen toggle, play/pause, settings,
 * status line), labelled for a reading rather than a perek.
 */
export function RangeRecitationControls({
	playLabel = "השמעת הקריאה",
}: {
	/** Accessible name for the play button (e.g. "השמעת קריאת התורה"). */
	playLabel?: string;
}) {
	const context = useContext(RangeControlsContext);
	if (!context) return null;
	const playing = context.state === "playing" && !context.previewActive();
	return (
		<span className={styles.controls}>
			{context.open && context.canPlay && (
				<button
					data-flipbook-no-flip
					type="button"
					className={styles.action}
					data-range-play
					onClick={context.togglePlayback}
					disabled={context.state === "loading"}
					aria-label={
						context.state === "playing" && playing
							? "השהיית ההקראה"
							: context.state === "paused" && !context.previewActive()
								? "המשך ההקראה"
								: playLabel
					}
					title={
						context.state === "playing" && playing
							? "השהיית ההקראה"
							: context.state === "paused" && !context.previewActive()
								? "המשך ההקראה"
								: playLabel
					}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
						{context.state === "playing" && playing ? (
							<path d="M3 2h4v12H3Zm6 0h4v12H9Z" fill="currentColor" />
						) : (
							<path d="M4 2v12l10-6Z" fill="currentColor" />
						)}
					</svg>
				</button>
			)}
			{context.open && context.canPlay && (
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
				aria-pressed={context.open}
				aria-busy={context.loading}
				aria-label="מצב הקראה"
				disabled={!context.hasRecording}
				title={context.hasRecording ? undefined : NO_RECORDING_MESSAGE}
				onClick={context.toggle}
			>
				<ListenIcon />
				{context.loading && (
					<svg
						className={styles.progress}
						viewBox="0 0 36 36"
						role="progressbar"
						aria-label={LOADING_MESSAGE}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={context.downloadProgress ?? undefined}
						data-indeterminate={context.downloadProgress === null}
					>
						<circle className={styles.progressTrack} cx="18" cy="18" r="16" />
						<circle
							className={styles.progressValue}
							cx="18"
							cy="18"
							r="16"
							pathLength="100"
							strokeDasharray={
								context.downloadProgress === null ? "25 75" : "100"
							}
							strokeDashoffset={
								context.downloadProgress === null
									? 0
									: 100 - context.downloadProgress
							}
							transform="rotate(-90 18 18)"
						/>
					</svg>
				)}
			</button>
			{context.open && (
				<span
					className={
						context.message || context.loading ? styles.notice : styles.srOnly
					}
					role="status"
					aria-live="polite"
				>
					{context.message}
				</span>
			)}
		</span>
	);
}
