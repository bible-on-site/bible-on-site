"use client";
import { toLetters } from "gematry";
import type { PageSemantics } from "html-flip-book-react";
import dynamic from "next/dynamic";
import React from "react";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
// HeBook.tsx
import type { PerekObj } from "@/data/perek-dto";
import { getSeferByName } from "@/data/sefer-dto";
import { Ptuah } from "./Ptuha";
import { Stuma } from "./Stuma";
import styles from "./sefer.module.css";
import "./sefer.css";

const FlipBook = dynamic(
	() => import("html-flip-book-react").then((mod) => mod.FlipBook),
	{ ssr: false },
);

const hePageSemanticsDict: Record<number, string> = {
	4: "א",
	5: "ב",
	6: "ג",
};

const hePageSemantics: PageSemantics = {
	indexToSemanticName(pageIndex: number): string {
		return hePageSemanticsDict[pageIndex] ?? "";
	},
	/* istanbul ignore next: client-only FlipBook URL hash navigation callback */
	semanticNameToIndex(semanticPageName: string): number | null {
		const entry = Object.entries(hePageSemanticsDict).find(
			([, value]) => value === semanticPageName,
		);
		return entry ? Number.parseInt(entry[0], 10) : null;
	},
	indexToTitle(pageIndex: number): string {
		const chapter = hePageSemanticsDict[pageIndex];
		return chapter ? `פרק ${chapter}` : "";
	},
};

const Sefer = (props: { perekObj: PerekObj }) => {
	const perekObj = props.perekObj;
	const sefer = getSeferByName(perekObj.sefer);
	const emptyPage = <section className={styles.page} />;
	const perakim =
		"perakim" in sefer
			? sefer.perakim
			: sefer.additionals.flatMap((additional) => additional.perakim);
	const pages = perakim
		.map((perek, perekIdx) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: this is the stable id
			<React.Fragment key={perekIdx + 1}>
				<section className={styles.page}>
					<article className={styles.perekText}>
						{perek.pesukim.map((pasuk, pasukIdx) => {
							const pasukKey = pasukIdx + 1;
							const pasukNumElement = (
								<span className={styles.pasukNum}>
									{toLetters(pasukIdx + 1)}
								</span>
							);
							const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
								const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
								const isQriWithDifferentKtiv =
									segment.type === "qri" && isQriDifferentThanKtiv(segment);
								// TODO: merge qris sequnce like in 929/406
								return (
									<React.Fragment key={segmentKey}>
										<span className={isQriWithDifferentKtiv ? styles.qri : ""}>
											{segment.type === "ktiv" ? (
												segment.value
											) : segment.type === "qri" ? (
												isQriWithDifferentKtiv ? (
													<>
														(
														{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
														<label />
														{segment.value})
													</>
												) : (
													segment.value
												)
											) : segment.type === "ptuha" ? (
												Ptuah()
											) : (
												Stuma()
											)}
										</span>
										{segmentIdx === pasuk.segments.length - 1 ||
										((segment.type === "ktiv" || segment.type === "qri") &&
											segment.value.at(segment.value.length - 1) ===
												"־") ? null : (
											<span> </span>
										)}
									</React.Fragment>
								);
							});
							return (
								<React.Fragment key={pasukKey}>
									{pasukNumElement}
									<span> </span>
									{pasukElement}
									<span> </span>
								</React.Fragment>
							);
						})}
					</article>
				</section>
			</React.Fragment>
		))
		.concat(emptyPage);

	return (
		<FlipBook
			className="he-book"
			pages={pages}
			pageSemantics={hePageSemantics}
			direction="rtl"
		/>
	);
};

export default Sefer;
