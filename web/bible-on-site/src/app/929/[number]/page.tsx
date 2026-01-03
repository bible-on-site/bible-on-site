// import Image from "next/image";

import { toLetters } from "gematry";
import React, { Suspense } from "react";
import { isQriDifferentThanKtiv } from "../../../data/db/tanah-view-types";
import { getPerekByPerekId } from "../../../data/perek-dto";
import Breadcrumb from "./components/Breadcrumb";
import { Ptuah } from "./components/Ptuha";
import SeferComposite from "./components/SeferComposite";
import { Stuma } from "./components/Stuma";
import styles from "./page.module.css";
// perakim are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export function generateStaticParams() {
	// Return an array of objects with the key "number" as a string
	return Array.from({ length: 929 }, (_, i) => ({ number: String(i + 1) }));
}

// TODO: figure out if need to use generateMetadata
export default async function Perek({
	params,
}: {
	params: Promise<{ number: string }>;
}) {
	const { number } = await params;
	const perekId = Number.parseInt(number, 10); // convert string to number
	const perekObj = getPerekByPerekId(perekId);
	return (
		<>
			<Suspense>
				<SeferComposite perekObj={perekObj} />
			</Suspense>
			<div className={styles.perekContainer}>
				<Breadcrumb perekObj={perekObj} />

				<article className={styles.perekText}>
					{perekObj.pesukim.map((pasuk, pasukIdx) => {
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
													{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
													(<label />
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
		</>
	);
}
