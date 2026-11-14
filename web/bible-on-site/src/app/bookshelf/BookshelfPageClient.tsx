"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Bookshelf } from "@/app/components/Bookshelf";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import type { BookshelfDedicationLines } from "@/lib/dedications/loaders";
import styles from "./page.module.css";

/**
 * The interactive half of /bookshelf (#2731): the server page supplies
 * dedication lines through the tag-cached loader; this client shell keeps
 * the click routing and the wide-screen book-view handoff.
 */
export function BookshelfPageClient({
	dedications,
}: {
	dedications: BookshelfDedicationLines;
}) {
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
			<h1 className={styles.srOnly}>ספרי התנ&quot;ך</h1>
			<Bookshelf onSeferClick={handleSeferClick} dedications={dedications} />
		</div>
	);
}
