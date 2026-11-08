import type { Metadata } from "next";
import Link from "next/link";
import { assetsUrl } from "@/lib/assets-url";
import { pageMetadata } from "@/lib/seo/opengraph";
import { JournalismGallery } from "./JournalismGallery";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
	title: 'על הפרק בתקשורת | תנ"ך על הפרק',
	description: 'סיקור תקשורתי של תנ"ך על הפרק',
	canonical: "/journalism",
});

const journalismItems = [
	{
		id: 1,
		title: 'כתבה בעלון "גילוי דעת"',
		description: 'פרסום על תנ"ך על הפרק בעלון "גילוי דעת" - שמיני תשע"ט',
		filename: "תקשורת - גילוי דעת שמיני תשעט.webp",
	},
	{
		id: 2,
		title: 'תגובת מערכת "גילוי דעת"',
		description: 'תגובת מערכת העלון לפרסום על תנ"ך על הפרק - שמיני תשע"ט',
		filename: "תקשורת - תגובת גילוי דעת לפרסום - שמיני תשעט.webp",
	},
];

export default function JournalismPage() {
	const items = journalismItems.map((item) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		imageUrl: assetsUrl(`journalism/${encodeURIComponent(item.filename)}`),
	}));

	return (
		<div className={styles.journalismPage}>
			<h1 className={styles.pageTitle}>על הפרק בתקשורת</h1>
			<p className={styles.pageSubtitle}>סיקור תקשורתי של תנ"ך על הפרק</p>

			<JournalismGallery items={items} />

			<div className={styles.backLinkWrapper}>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
