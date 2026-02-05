import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: 'רבנים מברכים | תנ"ך על הפרק',
	description: 'ברכות רבנים לתנ"ך על הפרק',
};

const S3_BASE_URL =
	"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/articles/1";

const blessingVideos = [
	{
		id: 1,
		rabbi: "הרב דוד חי הכהן",
		title: "ברכת הדרך לתנ״ך על הפרק",
		videoUrl: `${S3_BASE_URL}/1_בראשית א_ברכת הרב דוד חי הכהן.mp4`,
	},
	{
		id: 2,
		rabbi: "הרב שמואל אליהו",
		title: "ברכת הדרך לתנ״ך על הפרק",
		videoUrl: `${S3_BASE_URL}/1_בראשית א_ברכת הרב שמואל אליהו.mp4`,
	},
	{
		id: 3,
		rabbi: "הרב אריאל",
		title: "ברכת הדרך לתנ״ך על הפרק",
		videoUrl: `${S3_BASE_URL}/1_ברכת הרב בראשית א_אריאל.mp4`,
	},
];

export default function RabbisBlessingPage() {
	return (
		<div className={styles.rabbisBlessingPage}>
			<h1 className={styles.pageTitle}>רבנים מברכים</h1>
			<p className={styles.pageSubtitle}>ברכות רבנים לתנ״ך על הפרק</p>

			<div className={styles.videoGrid}>
				{blessingVideos.map((video) => (
					<article key={video.id} className={styles.videoCard}>
						<div className={styles.videoWrapper}>
							{/* biome-ignore lint/a11y/useMediaCaption: These are rabbi blessing videos in Hebrew, captions not available */}
							<video
								controls
								preload="metadata"
								className={styles.video}
								poster=""
							>
								<source src={video.videoUrl} type="video/mp4" />
								הדפדפן שלך לא תומך בתגית וידאו.
							</video>
						</div>
						<div className={styles.videoInfo}>
							<h2 className={styles.rabbiName}>{video.rabbi}</h2>
							<p className={styles.videoTitle}>{video.title}</p>
						</div>
					</article>
				))}
			</div>

			<div className={styles.backLinkWrapper}>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
