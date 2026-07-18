"use client";

import { useEffect } from "react";

export function ScrollToPerushPasukNote({
	pasuk,
}: {
	pasuk: number | null;
}) {
	useEffect(() => {
		if (pasuk == null || pasuk < 1) return;
		const id = `perush-pasuk-${pasuk}`;
		const el = document.getElementById(id);
		if (el) {
			setTimeout(() => {
				el.scrollIntoView({ behavior: "instant", block: "center" });
			}, 120);
		}
	}, [pasuk]);

	return null;
}