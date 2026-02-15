"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Bookshelf } from "@/app/components/Bookshelf";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import styles from "./page.module.css";

const BookshelfPage = () => {
	const router = useRouter();
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);

	// The Bookshelf component passes today's perekId for the bookmarked sefer,
	// or perekFrom for all other sefarim.
	const handleSeferClick = useCallback(
		(_seferName: string, targetPerek: number) => {
			const path = `/929/${targetPerek}`;
			const query = isWideEnough ? "?book" : "";
			router.push(`${path}${query}`);
		},
		[router, isWideEnough],
	);

	return (
		<div className={styles.page}>
			<Bookshelf onSeferClick={handleSeferClick} />
		</div>
	);
};

export default BookshelfPage;
