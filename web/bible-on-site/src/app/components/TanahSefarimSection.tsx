"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import styles from "./TanahSefarimSection.module.css";

// Dynamically import Bookshelf with no SSR to avoid hydration issues
// This ensures the rest of the page remains SSG-friendly
const Bookshelf = dynamic(
	() =>
		import("./Bookshelf/Bookshelf").then((mod) => ({
			default: mod.Bookshelf,
		})),
	{
		ssr: false,
		loading: () => (
			<div className={styles.loading}>
				<div className={styles.spinner} />
			</div>
		),
	},
);

export function TanahSefarimSection() {
	const router = useRouter();
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);

	const handleSeferClick = (_seferName: string, perekFrom: number) => {
		const path = `/929/${perekFrom}`;
		const query = isWideEnough ? "?book" : "";
		router.push(`${path}${query}`);
	};

	return (
		<section id="tanah-sefarim" className={styles.section}>
			<header className={styles.header}>
				<h1>ספרי התנ&quot;ך</h1>
				<h2>בחרו ספר כדי להתחיל ללמוד</h2>
			</header>
			<div className={styles.bookshelfContainer}>
				<Bookshelf onSeferClick={handleSeferClick} />
			</div>
			<div className={styles.bottomDivider} />
		</section>
	);
}
