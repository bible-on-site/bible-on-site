/** Keep native selection gestures from reaching the flipbook's gesture engine. */
export function selectableBookContentRef(element: HTMLElement | null) {
	if (!element) return;

	const stopTextGesture = (event: Event) => {
		// The section's padding remains available for dragging a page turn.
		if (event.target !== element) event.stopPropagation();
	};
	const events = ["pointerdown", "mousedown", "touchstart", "touchmove"];
	for (const event of events) {
		element.addEventListener(event, stopTextGesture);
	}

	return () => {
		for (const event of events) {
			element.removeEventListener(event, stopTextGesture);
		}
	};
}
