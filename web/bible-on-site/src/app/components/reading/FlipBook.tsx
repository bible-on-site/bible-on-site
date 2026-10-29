"use client";

import type { FlipBook as FlipBookComponent } from "html-flip-book-react";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Browser-only FlipBook. next/dynamic keeps the engine out of the SSR graph;
 * the prop type derives from the published component itself — including its
 * forwarded FlipBookHandle ref — so supported options and PageFlipParams
 * handler payloads can never drift from the installed library (#2780).
 */
export const FlipBook = dynamic<ComponentProps<typeof FlipBookComponent>>(
	() => import("html-flip-book-react").then((mod) => mod.FlipBook),
	{ ssr: false },
);
