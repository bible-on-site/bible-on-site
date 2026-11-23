import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	"a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])";

/**
 * Modal-dialog focus contract (the SeferPanel fullscreen pattern): while
 * the portal dialog is mounted every other body child goes inert so Tab
 * cannot reach the page behind it, Tab/Shift+Tab cycle within the dialog,
 * focus lands on the dialog's close control, and on unmount focus returns
 * to the element that opened it.
 */
export function useModalDialogFocus(
	open: boolean,
	dialogRef: React.RefObject<HTMLElement | null>,
): void {
	const openerRef = useRef<Element | null>(null);
	useEffect(() => {
		if (!open) return;
		openerRef.current = document.activeElement;
		const dialog = dialogRef.current;
		/* istanbul ignore if -- the portal mounts in the same commit */
		if (!dialog) return;
		const inerted: Element[] = [];
		for (const sibling of document.body.children) {
			if (sibling === dialog || sibling.hasAttribute("inert")) continue;
			sibling.setAttribute("inert", "");
			inerted.push(sibling);
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const focusables = [
				...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			].filter(
				/* istanbul ignore next -- checkVisibility is absent in jsdom */
				(el) => el.checkVisibility?.() ?? true,
			);
			/* istanbul ignore if -- every modal renders its close control */
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			// Focus on the dialog container itself (clicking the image lands
			// there) or anywhere else off the stop list counts as an edge:
			// wrap instead of letting the browser tab out of the dialog.
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
		/* istanbul ignore next -- every modal renders its close control */
		(
			dialog.querySelector<HTMLElement>("[data-modal-action='close']") ??
			dialog
		).focus();
		return () => {
			dialog.removeEventListener("keydown", onKeyDown);
			for (const el of inerted) el.removeAttribute("inert");
			const opener = openerRef.current;
			openerRef.current = null;
			/* istanbul ignore if -- activeElement is always an element */
			if (opener instanceof HTMLElement) {
				opener.focus({ preventScroll: true });
			}
		};
	}, [open, dialogRef]);
}
