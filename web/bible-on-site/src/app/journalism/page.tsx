import type { Metadata } from "next";
import Link from "next/link";
import { JournalismGallery } from "./JournalismGallery";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: 'על הפרק בתקשורת | תנ"ך על הפרק',
	description: 'סיקור תקשורתי של תנ"ך על הפרק',
};

function getS3BaseUrl(): string {
	const S3_ENDPOINT = process.env.S3_ENDPOINT;
	const S3_BUCKET = process.env.S3_BUCKET || "bible-on-site-assets";
	const S3_REGION =
		process.env.S3_REGION || process.env.AWS_REGION || "il-central-1";

	if (S3_ENDPOINT) {
		return `${S3_ENDPOINT}/${S3_BUCKET}`;
	}
	return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
}

const journalismItems = [
	{
		id: 1,
		title: "כתבה בעלון ״גילוי דעת״",
		description: "פרסום על תנ״ך על הפרק בעלון ״גילוי דעת״ – שמיני תשע״ט",
		filename: "תקשורת - גילוי דעת שמיני תשעט.webp",
	},
	{
		id: 2,
		title: "תגובת מערכת ״גילוי דעת״",
		description: "תגובת מערכת העלון לפרסום על תנ״ך על הפרק – שמיני תשע״ט",
		filename: "תקשורת - תגובת גילוי דעת לפרסום - שמיני תשעט.webp",
	},
];

export default function JournalismPage() {
	const baseUrl = getS3BaseUrl();

	const items = journalismItems.map((item) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		imageUrl: `${baseUrl}/journalism/${encodeURIComponent(item.filename)}`,
	}));

	return (
		<div className={styles.journalismPage}>
			<h1 className={styles.pageTitle}>על הפרק בתקשורת</h1>
			<p className={styles.pageSubtitle}>
				סיקור תקשורתי של תנ״ך על הפרק
			</p>

			<JournalismGallery items={items} />

			<div className={styles.backLinkWrapper}>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
