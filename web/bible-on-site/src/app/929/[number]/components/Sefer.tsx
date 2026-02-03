"use client";
import { toLetters, toNumber } from "gematry";
import type { FlipBookHandle, PageSemantics } from "html-flip-book-react";
import {
	FirstPageButton,
	LastPageButton,
	NextButton,
	PrevButton,
	SemanticPageIndicator,
	Toolbar,
} from "html-flip-book-react/toolbar";
import dynamic from "next/dynamic";
import React, { useMemo, useRef } from "react";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferByName } from "@/data/sefer-dto";
import type { Article } from "@/lib/articles";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { ArticlesSection } from "./ArticlesSection";
import { Ptuah } from "./Ptuha";
import { Stuma } from "./Stuma";
import styles from "./sefer.module.css";
import "./sefer.css";

/** Props we pass to FlipBook; matches html-flip-book-react FlipBookProps for typing dynamic() */
type FlipBookProps = {
	className: string;
	pages: React.ReactNode[];
	pageSemantics?: PageSemantics;
	direction?: "rtl" | "ltr";
};

/** Dynamic FlipBook with ref forwarded (library uses forwardRef) */
const FlipBook = dynamic<
	FlipBookProps & { ref?: React.RefObject<FlipBookHandle | null> }
>(() => import("html-flip-book-react").then((mod) => mod.FlipBook), {
	ssr: false,
});

const Sefer = (props: { perekObj: PerekObj; articles: Article[] }) => {
	const { perekObj, articles } = props;
	const sefer = getSeferByName(perekObj.sefer);
	const flipBookRef = useRef<FlipBookHandle>(null);
	const perakim =
		"perakim" in sefer
			? sefer.perakim
			: sefer.additionals.flatMap((additional) => additional.perakim);

	// Pages: cover, then for each perek (content page, blank for future perushim/articles), then back cover.
	const hePageSemantics: PageSemantics = useMemo(
		() => ({
			indexToSemanticName(pageIndex: number): string {
				if (pageIndex <= 0 || pageIndex % 2 === 0) return "";
				const perekNum = (pageIndex + 1) / 2;
				if (perekNum > perakim.length) return "";
				return toLetters(perekNum, { addQuotes: true });
			},
			semanticNameToIndex(semanticPageName: string): number | null {
				const num = toNumber(semanticPageName);
				if (num === 0) return null;
				if (num > perakim.length) return null;
				return 2 * num - 1;
			},
			indexToTitle(pageIndex: number): string {
				if (pageIndex <= 0 || pageIndex % 2 === 0) return "";
				const perekNum = (pageIndex + 1) / 2;
				if (perekNum > perakim.length) return "";
				return `פרק ${toLetters(perekNum, { addQuotes: true })}`;
			},
		}),
		[perakim.length],
	);

	const frontCover = (
		<section className={styles.page} aria-label="עטיפה קדמית">
			<div className={styles.coverContent}>
				<h1 className={styles.coverTitle}>ספר {perekObj.sefer}</h1>
				<p className={styles.coverSubtitle}>מקרא על פי המסורה</p>
				<p className={styles.coverAuthor}>929 • bible-on-site</p>
			</div>
		</section>
	);
	const backCover = (
		<section className={styles.page} aria-label="עטיפה אחורית">
			<div className={styles.coverContent}>
				<h2 className={styles.coverTitle}>סוף</h2>
				<p className={styles.coverAuthor}>929 • bible-on-site</p>
			</div>
		</section>
	);

	const hebrewDateStr = useMemo(
		() => constructTsetAwareHDate(new Date()).toHebrewLocaleString(),
		[],
	);

	const blankPage = (
		<section
			className={styles.pageBlank}
			aria-label="עמוד ריק (פירושים ומאמרים)"
		>
			<div className={styles.blankPageDate}>{hebrewDateStr}</div>
			<div className={styles.blankPageArticles}>
				<ArticlesSection articles={articles} />
			</div>
		</section>
	);

	const contentPages = perakim.flatMap((perek, perekIdx) => [
		<React.Fragment key={`perek-${perekIdx + 1}`}>
			<section className={styles.pageContentPage}>
				<div className={styles.pageHeaderRight}>
					<div className={styles.pageHeaderRow}>
						<span className={styles.pageHeaderSefer}>{perekObj.sefer}</span>
						<span className={styles.pageHeaderPerek}>
							{toLetters(perekIdx + 1, { addQuotes: true })}
						</span>
					</div>
					<div className={styles.perekHeader} title={perek.header}>
						{perek.header}
					</div>
				</div>
				<div className={styles.perekTextScrollWrapper}>
					<article className={styles.perekText}>
					{perek.pesukim.map((pasuk, pasukIdx) => {
						const pasukKey = pasukIdx + 1;
						const pasukNumElement = (
							<span className={styles.pasukNum}>{toLetters(pasukIdx + 1)}</span>
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
				</div>
			</section>
		</React.Fragment>,
		<React.Fragment key={`blank-${perekIdx + 1}`}>{blankPage}</React.Fragment>,
	]);

	const pages = [frontCover, ...contentPages, backCover];

	return (
		<div className={styles.bookWrapper} dir="rtl">
			<div className={styles.bookArea}>
				<FlipBook
					ref={flipBookRef}
					className="he-book"
					pages={pages}
					pageSemantics={hePageSemantics}
					direction="rtl"
				/>
			</div>
			<Toolbar
				flipBookRef={flipBookRef}
				direction="rtl"
				pageSemantics={hePageSemantics}
			>
				<FirstPageButton />
				<PrevButton />
				<SemanticPageIndicator ariaLabel="עבור לפרק (מספר עברי)" />
				<NextButton />
				<LastPageButton />
			</Toolbar>
		</div>
	);
};

export default Sefer;
