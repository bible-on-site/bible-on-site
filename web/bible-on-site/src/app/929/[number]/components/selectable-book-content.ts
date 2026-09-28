type SwipeDirection = "next" | "previous";

/** Let text drags select, while fast mouse swipes and touch swipes turn pages. */
export function createSelectableBookContentRef(
	onSwipe: (direction: SwipeDirection) => void,
) {
	return (element: HTMLElement | null) => {
		if (!element) return;

		let start: { x: number; y: number; time: number } | null = null;
		const stopPointerDown = (event: PointerEvent) => {
			// The page padding still belongs to the flipbook. Touch gestures go to
			// Hammer too, so horizontal swipes keep their normal drag animation.
			if (event.target === element || event.pointerType === "touch") return;
			event.stopPropagation();
			if (event.button !== 0) return;
			start = { x: event.clientX, y: event.clientY, time: performance.now() };
			window.addEventListener("pointerup", finishPointer, true);
			window.addEventListener("pointercancel", cancelPointer, true);
		};
		const stopMouseDown = (event: MouseEvent) => {
			if (event.target !== element) event.stopPropagation();
		};
		const cancelPointer = () => {
			start = null;
			window.removeEventListener("pointerup", finishPointer, true);
			window.removeEventListener("pointercancel", cancelPointer, true);
		};
		const finishPointer = (event: PointerEvent) => {
			if (!start) return;
			const dx = event.clientX - start.x;
			const dy = event.clientY - start.y;
			const duration = performance.now() - start.time;
			cancelPointer();
			if (
				Math.abs(dx) < 120 ||
				Math.abs(dx) < Math.abs(dy) * 1.5 ||
				duration > 450
			) {
				return;
			}

			// A swipe is navigation, not a text selection or a link activation.
			window.getSelection()?.removeAllRanges();
			const suppressClick = (click: MouseEvent) => {
				click.preventDefault();
				click.stopImmediatePropagation();
			};
			window.addEventListener("click", suppressClick, {
				capture: true,
				once: true,
			});
			setTimeout(
				() => window.removeEventListener("click", suppressClick, true),
				0,
			);
			onSwipe(dx > 0 ? "next" : "previous");
		};

		element.addEventListener("pointerdown", stopPointerDown);
		element.addEventListener("mousedown", stopMouseDown);
		return () => {
			cancelPointer();
			element.removeEventListener("pointerdown", stopPointerDown);
			element.removeEventListener("mousedown", stopMouseDown);
		};
	};
}
