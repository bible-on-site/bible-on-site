import type { Metadata } from "next";
import Link from "next/link";
import { ImageLightbox } from "./ImageLightbox";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: 'רבנים מברכים | תנ"ך על הפרק',
	description: 'ברכות רבנים לתנ"ך על הפרק',
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

const blessingVideos = [
	{
		id: 1,
		rabbi: "הרב דוד חי הכהן",
		title: "ברכת הדרך לתנ״ך על הפרק",
		filename: "1_בראשית א_ברכת הרב דוד חי הכהן.mp4",
	},
	{
		id: 2,
		rabbi: "הרב שמואל אליהו",
		title: "ברכת הדרך לתנ״ך על הפרק",
		filename: "1_בראשית א_ברכת הרב שמואל אליהו.mp4",
	},
	{
		id: 3,
		rabbi: "הרב אריאל",
		title: "ברכת הדרך לתנ״ך על הפרק",
		filename: "1_ברכת הרב בראשית א_אריאל.mp4",
	},
];

export default function RabbisBlessingPage() {
	const baseUrl = getS3BaseUrl();
	const videosBaseUrl = `${baseUrl}/articles/1`;
	const posterUrl = `${baseUrl}/blessing/blessing-poster.webp`;

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
								<source
									src={`${videosBaseUrl}/${encodeURIComponent(video.filename)}`}
									type="video/mp4"
								/>
								הדפדפן שלך לא תומך בתגית וידאו.
							</video>
						</div>
						<div className={styles.videoInfo}>
							<h2 className={styles.rabbiName}>{video.rabbi}</h2>
							<p className={styles.videoTitle}>{video.title}</p>
						</div>
					</article>
				))}

				<article className={styles.videoCard}>
					<ImageLightbox
						src={posterUrl}
						alt="דורש ציון – ברכה לתנ״ך על הפרק"
						width={924}
						height={577}
					/>
					<div className={styles.videoInfo}>
						<h2 className={styles.rabbiName}>דורש ציון</h2>
						<p className={styles.videoTitle}>ברכה לתנ״ך על הפרק</p>
					</div>
				</article>
			</div>

			<div className={styles.backLinkWrapper}>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
