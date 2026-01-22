"use client";

import { useEffect } from "react";

interface ScrollToSectionProps {
	sectionId: string;
}

export function ScrollToSection({ sectionId }: ScrollToSectionProps) {
	useEffect(() => {
		// Close the menu if it's open
		const checkbox = document.getElementById("menu-toggle") as HTMLInputElement;
		if (checkbox) {
			checkbox.checked = false;
		}

		// Scroll to the section
		const element = document.getElementById(sectionId);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, [sectionId]);

	return null;
}
