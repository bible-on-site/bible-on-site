import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

export const UNDO_TOAST_DURATION_MS = 5000;

interface UndoAction {
	/** Shown inside the toast next to the ביטול button. */
	message: string;
	/** The destructive work — runs only when the toast expires. */
	commit: () => void;
	/** Replaces a still-pending action with the same key instead of stacking. */
	key?: string;
}

type ScheduleUndoAction = (action: UndoAction) => void;

const UndoToastContext = createContext<ScheduleUndoAction | null>(null);

/**
 * Queues a destructive action behind an undo toast: it runs only when the
 * toast expires; ביטול cancels it. Mounted once in __root so pending actions
 * survive the unmount of the component that scheduled them.
 */
export function useUndoAction(): ScheduleUndoAction {
	const schedule = useContext(UndoToastContext);
	if (!schedule) {
		throw new Error("useUndoAction must be used inside <UndoToastProvider>");
	}
	return schedule;
}

interface PendingToast {
	id: number;
	message: string;
}

export function UndoToastProvider({
	children,
	durationMs = UNDO_TOAST_DURATION_MS,
}: {
	children: ReactNode;
	/** Test seam for the undo window; production keeps the default. */
	durationMs?: number;
}) {
	const [toasts, setToasts] = useState<PendingToast[]>([]);
	const nextIdRef = useRef(0);
	const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
	const keysRef = useRef(new Map<string, number>());
	const undoRefs = useRef(new Map<number, HTMLButtonElement>());
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const pendingRestoreRef = useRef<HTMLElement | null>(null);

	const release = useCallback((id: number) => {
		clearTimeout(timersRef.current.get(id));
		timersRef.current.delete(id);
		const undoButton = undoRefs.current.get(id);
		undoRefs.current.delete(id);
		for (const [key, value] of keysRef.current)
			if (value === id) keysRef.current.delete(key);
		// Hand focus back only when the toast itself held it — an admin who
		// moved on to another field must not be pulled back.
		if (undoButton === document.activeElement)
			pendingRestoreRef.current = previousFocusRef.current;
		setToasts((prev) => prev.filter((toast) => toast.id !== id));
	}, []);

	// Keyboard users must reach the undo window: each new toast takes focus,
	// and focus returns to the pre-toast element once all actions resolve.
	useEffect(() => {
		const last = toasts.at(-1);
		if (last) {
			previousFocusRef.current ??=
				document.activeElement as HTMLElement | null;
			undoRefs.current.get(last.id)?.focus();
			return;
		}
		const restore = pendingRestoreRef.current;
		pendingRestoreRef.current = null;
		previousFocusRef.current = null;
		restore?.focus();
	}, [toasts]);

	const schedule = useCallback<ScheduleUndoAction>(
		({ message, commit, key }) => {
			if (key !== undefined) {
				const existing = keysRef.current.get(key);
				if (existing !== undefined) release(existing);
			}
			const id = ++nextIdRef.current;
			if (key !== undefined) keysRef.current.set(key, id);
			timersRef.current.set(
				id,
				setTimeout(() => {
					release(id);
					commit();
				}, durationMs),
			);
			setToasts((prev) => [...prev, { id, message }]);
		},
		[durationMs, release],
	);

	// An unmounted provider must never fire a pending destructive commit.
	useEffect(
		() => () => {
			for (const timer of timersRef.current.values()) clearTimeout(timer);
			timersRef.current.clear();
		},
		[],
	);

	return (
		<UndoToastContext.Provider value={schedule}>
			{children}
			<div
				aria-live="polite"
				className="fixed bottom-4 start-4 z-[3000] flex max-w-sm flex-col gap-2"
			>
				{toasts.map((toast) => (
					<div
						key={toast.id}
						role="status"
						className="flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
					>
						<span className="flex-1">{toast.message}</span>
						<button
							type="button"
							ref={(el) => {
								if (el) undoRefs.current.set(toast.id, el);
								else undoRefs.current.delete(toast.id);
							}}
							onClick={() => release(toast.id)}
							className="shrink-0 font-medium text-blue-300 hover:text-blue-200"
						>
							ביטול
						</button>
					</div>
				))}
			</div>
		</UndoToastContext.Provider>
	);
}
