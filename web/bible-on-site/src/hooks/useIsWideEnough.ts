"use client";
import { useEffect, useState } from "react";

// Minimum viewport width for tablet+ features (sefer view, etc.)
export const TABLET_MIN_WIDTH = 768;

/**
 * Hook to check if viewport is at least a specified width.
 * Returns undefined during SSR/initial render, then the actual value after hydration.
 *
 * @param minWidth - Minimum viewport width in pixels
 * @returns true if viewport >= minWidth, false if smaller, undefined during SSR
 */
export function useIsWideEnough(minWidth: number): boolean | undefined {
	const [isWideEnough, setIsWideEnough] = useState<boolean | undefined>(
		undefined,
	);

	useEffect(() => {
		const checkViewport = () => {
			setIsWideEnough(window.innerWidth >= minWidth);
		};

		// Check immediately after mount
		checkViewport();

		// Listen for resize events
		window.addEventListener("resize", checkViewport);
		return () => window.removeEventListener("resize", checkViewport);
	}, [minWidth]);

	return isWideEnough;
}
