"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Bookshelf } from "@/app/components/Bookshelf";
import { sefarim } from "@/data/db/sefarim";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import { getTodaysPerekId } from "@/data/perek-dto";
import styles from "./page.module.css";

const BookshelfPage = () => {
	const router = useRouter();
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);

	const { todaysPerekId, todaysSeferName } = useMemo(() => {
		const perekId = getTodaysPerekId();
		const sefer = sefarim.find(
			(s) => s.perekFrom <= perekId && s.perekTo >= perekId,
		);
		return { todaysPerekId: perekId, todaysSeferName: sefer?.name ?? "" };
	}, []);

	const handleSeferClick = useCallback(
		(seferName: string, perekFrom: number) => {
			const targetPerek =
				seferName === todaysSeferName ? todaysPerekId : perekFrom;
			const path = `/929/${targetPerek}`;
			const query = isWideEnough ? "?book" : "";
			router.push(`${path}${query}`);
		},
		[router, todaysSeferName, todaysPerekId, isWideEnough],
	);

	return (
		<div className={styles.page}>
			<Bookshelf onSeferClick={handleSeferClick} />
		</div>
	);
};

export default BookshelfPage;
