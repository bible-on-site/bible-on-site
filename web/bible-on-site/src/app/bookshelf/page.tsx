"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Bookshelf } from "@/app/components/Bookshelf";
import { sefarim } from "@/data/db/sefarim";
import { getTodaysPerekId } from "@/data/perek-dto";
import styles from "./page.module.css";

const BookshelfPage = () => {
	const router = useRouter();

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
			router.push(`/929/${targetPerek}`);
		},
		[router, todaysSeferName, todaysPerekId],
	);

	return (
		<div className={styles.page}>
			<Bookshelf onSeferClick={handleSeferClick} />
		</div>
	);
};

export default BookshelfPage;
