import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: 'על הפרק בתקשורת | תנ"ך על הפרק',
	description: 'סיקור תקשורתי של תנ"ך על הפרק',
};

export default function JournalismPage() {
	return (
		<div className={styles.journalismPage}>
			<h1 className={styles.pageTitle}>על הפרק בתקשורת</h1>

			<div className={styles.emptyState}>
				<p>עמוד זה בבנייה.</p>
				<p>
					בקרוב יופיעו כאן קישורים לכתבות ולסיקורים תקשורתיים על תנ״ך על הפרק.
				</p>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
