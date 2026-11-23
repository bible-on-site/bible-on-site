import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	"a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex='-1'])";

/**
 * Modal-dialog focus contract (the same one the website's
 * useModalDialogFocus implements): while the portal dialog is mounted every
 * other body child goes inert so Tab cannot reach the page behind it,
 * Tab/Shift+Tab cycle within the dialog, focus lands on the dialog's close
 * control (or `initialFocus` when the caller marks a different first stop),
 * and on unmount focus returns to the element that opened it.
 *
 * `opener` is the element whose click opened the dialog. Safari and Firefox
 * do not focus buttons on click, so document.activeElement alone cannot
 * name the opener there — callers record it from onClick and it is the
 * preferred restore target.
 */
export function useModalDialogFocus(
	open: boolean,
	dialogRef: React.RefObject<HTMLElement | null>,
	opener: Element | null,
	initialFocus?: React.RefObject<HTMLElement | null>,
): void {
	const openerRef = useRef<Element | null>(null);
	useEffect(() => {
		if (!open) return;
		openerRef.current = opener ?? document.activeElement;
		const dialog = dialogRef.current;
		/* v8 ignore if -- the portal mounts in the same commit */
		if (!dialog) return;
		const inerted: Element[] = [];
		for (const sibling of document.body.children) {
			if (
				sibling === dialog ||
				sibling.hasAttribute("inert") ||
				// Transient UI that must stay reachable during a modal — e.g. the
				// undo toast, whose destructive commit timer keeps running.
				sibling.hasAttribute("data-modal-keep-active")
			)
				continue;
			sibling.setAttribute("inert", "");
			inerted.push(sibling);
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const focusables = [
				...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			].filter(
				(el) => el.checkVisibility?.() ?? true,
			);
			/* v8 ignore if -- every modal renders a tabbable control */
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			// Focus on the dialog container itself or anywhere else off the
			// stop list counts as an edge: wrap instead of letting the
			// browser tab out of the dialog.
			const offList = !(
				document.activeElement instanceof HTMLElement &&
				focusables.includes(document.activeElement)
			);
			if (event.shiftKey && (offList || document.activeElement === first)) {
				event.preventDefault();
				last.focus();
			} else if (
				!event.shiftKey &&
				(offList || document.activeElement === last)
			) {
				event.preventDefault();
				first.focus();
			}
		};
		dialog.addEventListener("keydown", onKeyDown);
		(
			initialFocus?.current ??
			dialog.querySelector<HTMLElement>("[data-modal-action='close']") ??
			/* v8 ignore next -- every modal renders a data-modal-action close control */
			dialog
		).focus();
		return () => {
			dialog.removeEventListener("keydown", onKeyDown);
			for (const el of inerted) el.removeAttribute("inert");
			const restoreTo = openerRef.current;
			openerRef.current = null;
			/* v8 ignore if -- activeElement is always an element */
			if (restoreTo instanceof HTMLElement) {
				restoreTo.focus({ preventScroll: true });
			}
		};
	}, [open, dialogRef, opener, initialFocus]);
}
