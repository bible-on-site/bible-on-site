import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Styled replacement for the native confirm dialog on actions a toast cannot
 * honestly delay - deletes that navigate away and edits that overwrite live
 * content. Escape cancels; the previous focus is restored on close.
 */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = "אישור",
	cancelLabel = "ביטול",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const confirmRef = useRef<HTMLButtonElement>(null);
	// Callers pass fresh closures each render — the open/focus effect must not
	// restart on their identity changes or focus would jump back to confirm.
	const onCancelRef = useRef(onCancel);
	useEffect(() => {
		onCancelRef.current = onCancel;
	});

	useEffect(() => {
		if (!open) return;
		const previousFocus = document.activeElement as HTMLElement | null;
		confirmRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCancelRef.current();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			previousFocus?.focus();
		};
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-dialog-title"
			aria-describedby="confirm-dialog-message"
		>
			<div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
				<h2
					id="confirm-dialog-title"
					className="text-lg font-bold text-gray-900 mb-2"
				>
					{title}
				</h2>
				<p id="confirm-dialog-message" className="text-sm text-gray-700 mb-6">
					{message}
				</p>
				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-300"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						ref={confirmRef}
						onClick={onConfirm}
						className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
