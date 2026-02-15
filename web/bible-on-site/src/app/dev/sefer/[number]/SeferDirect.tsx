"use client";

import dynamic from "next/dynamic";
import type { PerekObj } from "@/data/perek-dto";
import type { Article } from "@/lib/articles";
import type { PerushSummary } from "@/lib/perushim";

const Sefer = dynamic(() => import("@/app/929/[number]/components/Sefer"), {
	ssr: false,
});

/**
 * Renders the Sefer component directly, filling the viewport below the nav bar.
 * No SEO overlay, no toggle — pure FlipBook for debugging.
 */
export default function SeferDirect(props: {
	perekObj: PerekObj;
	articles: Article[];
	articlesByPerekIndex?: Article[][];
	perushimByPerekIndex?: PerushSummary[][];
	perekIds?: number[];
}) {
	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				width: "100vw",
				height: "100vh",
				background: "#fff",
				zIndex: 9999,
			}}
		>
			<Sefer
				perekObj={props.perekObj}
				articles={props.articles}
				articlesByPerekIndex={props.articlesByPerekIndex}
				perushimByPerekIndex={props.perushimByPerekIndex}
				perekIds={props.perekIds}
			/>
		</div>
	);
}
