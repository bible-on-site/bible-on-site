"use client";

import { useEffect } from "react";

interface ScrollToSectionProps {
	sectionId: string;
}

export function ScrollToSection({ sectionId }: ScrollToSectionProps) {
	useEffect(() => {
		const element = document.getElementById(sectionId);
		if (element) {
			const reduceMotion = window.matchMedia?.(
				"(prefers-reduced-motion: reduce)",
			).matches;
			element.scrollIntoView({
				behavior: reduceMotion ? "auto" : "smooth",
				block: "start",
			});
		}
	}, [sectionId]);

	return null;
}
