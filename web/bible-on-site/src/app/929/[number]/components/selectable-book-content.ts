export type MouseBookMode = "turn" | "select";

/** In selection mode, keep mouse down away from Hammer's book-level handler. */
export function createSelectableBookContentRef(mode: MouseBookMode) {
	return (element: HTMLElement | null) => {
		if (!element || mode !== "select") return;

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === "mouse" && event.button === 0) {
				event.stopPropagation();
			}
		};
		const onMouseDown = (event: MouseEvent) => {
			if (event.button === 0) event.stopPropagation();
		};
		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("mousedown", onMouseDown);
		return () => {
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("mousedown", onMouseDown);
		};
	};
}
