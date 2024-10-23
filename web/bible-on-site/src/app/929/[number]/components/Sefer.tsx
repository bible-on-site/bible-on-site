"use client";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferByName } from "@/data/sefer-dto";
import { toLetters } from "gematry";
import type { PageSemantics } from "html-flip-book-react";
import dynamic from "next/dynamic";
// HeBook.tsx
import Link from "next/link";
import React from "react";
import { Ptuah } from "./Ptuha";
import { Stuma } from "./Stuma";
import styles from "./sefer.module.css";
import "./sefer.css";
const FlipBook = dynamic(
	() =>
		import("html-flip-book-react").then((mod) => ({
			default: mod.FlipBook,
		})),
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
	semanticNameToIndex(semanticPageName: string): number | null {
		const entry = Object.entries(hePageSemanticsDict).find(
			([, value]) => value === semanticPageName,
		);
		return entry ? Number.parseInt(entry[0]) : null;
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
	const pages = sefer.perakim
		.map((perek, perekIdx) => (
			<React.Fragment key={perekIdx + 1}>
				<section className={styles.page}>
					<article className={styles.perekText}>
						{perek.pesukim.map((pasuk, pasukIdx) => {
							const pasukKey = pasukIdx + 1;
							const pasukNumElement = (
								<Link className={styles.pasukNum}>
									{toLetters(pasukIdx + 1)}
								</Link>
							);
							const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
								const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
								// TODO: merge qris sequnce like in 929/406
								return (
									<React.Fragment key={segmentKey}>
										<Link className={segment.type === "qri" ? styles.qri : ""}>
											{segment.type === "ktiv" ? (
												segment.value
											) : segment.type === "qri" ? (
												<>
													(<label />
													{segment.value})
												</>
											) : segment.type === "ptuha" ? (
												Ptuah()
											) : (
												Stuma()
											)}
										</Link>
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
