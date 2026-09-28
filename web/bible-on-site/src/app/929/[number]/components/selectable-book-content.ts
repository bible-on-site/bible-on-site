type MouseGesture = {
	pointerId: number;
	x: number;
	y: number;
	startedAt: number;
	mode: "pending" | "select" | "flip";
};

/** Keep text selection native until a quick horizontal drag claims the book. */
export function createSelectableBookContentRef() {
	return (element: HTMLElement | null) => {
		if (!element) return;

		let gesture: MouseGesture | null = null;
		const clearSelection = () => window.getSelection()?.removeAllRanges();
		const stopTracking = () => {
			gesture = null;
			window.removeEventListener("pointermove", onPointerMove, true);
			window.removeEventListener("pointerup", onPointerUp, true);
			window.removeEventListener("pointercancel", stopTracking, true);
		};
		const onPointerMove = (event: PointerEvent) => {
			if (!gesture || event.pointerId !== gesture.pointerId) return;
			if (gesture.mode === "select") {
				event.stopPropagation();
				return;
			}
			if (gesture.mode === "pending") {
				const dx = event.clientX - gesture.x;
				const dy = event.clientY - gesture.y;
				if (
					performance.now() - gesture.startedAt > 450 ||
					Math.abs(dy) > Math.abs(dx)
				) {
					gesture.mode = "select";
					event.stopPropagation();
					return;
				}
				if (Math.abs(dx) < 120 || Math.abs(dx) < Math.abs(dy) * 1.5) {
					event.stopPropagation();
					return;
				}
				gesture.mode = "flip";
			}

			// Hammer receives this move and every later one, so the leaf follows
			// the pointer. Suppress the browser's competing text selection.
			event.preventDefault();
			clearSelection();
		};
		const onPointerUp = (event: PointerEvent) => {
			if (!gesture || event.pointerId !== gesture.pointerId) return;
			const wasFlip = gesture.mode === "flip";
			stopTracking();
			if (!wasFlip) return;
			clearSelection();
			const suppressClick = (click: MouseEvent) => {
				click.preventDefault();
				click.stopImmediatePropagation();
			};
			window.addEventListener("click", suppressClick, {
				capture: true,
				once: true,
			});
			setTimeout(() => {
				clearSelection();
				window.removeEventListener("click", suppressClick, true);
			}, 0);
		};
		const onPointerDown = (event: PointerEvent) => {
			// Touch and page padding remain entirely owned by the flipbook.
			if (
				event.target === element ||
				event.pointerType !== "mouse" ||
				event.button !== 0
			)
				return;
			stopTracking();
			gesture = {
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				startedAt: performance.now(),
				mode: "pending",
			};
			window.addEventListener("pointermove", onPointerMove, true);
			window.addEventListener("pointerup", onPointerUp, true);
			window.addEventListener("pointercancel", stopTracking, true);
		};

		element.addEventListener("pointerdown", onPointerDown);
		return () => {
			stopTracking();
			element.removeEventListener("pointerdown", onPointerDown);
		};
	};
}
