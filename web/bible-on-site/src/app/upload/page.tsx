import type { Metadata } from "next";
import { cookies } from "next/headers";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/uploads/auth";
import { UploadArea } from "./UploadArea";
import styles from "./upload.module.css";

export const metadata: Metadata = {
	title: "העלאת קבצים פרטית",
	robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

export default async function UploadPage() {
	const jar = await cookies();
	// Render only the shell here. Every data request verifies the session and ownership.
	const session = jar.has(SESSION_COOKIE) || jar.has(REFRESH_COOKIE);
	return (
		<main className={styles.area} data-page-header="solid">
			<p className={styles.eyebrow}>מרחב אישי מאובטח</p>
			<h1>התיקייה שלי</h1>
			<p className={styles.intro}>מקום פרטי להעלאת קבצים ולשמירת התוכן שלכם.</p>
			{session ? (
				<UploadArea />
			) : (
				<section className={styles.card}>
					<h2>כניסה לאזור ההעלאה</h2>
					<p>יש להיכנס עם שם המשתמש והסיסמה שקיבלתם מצוות האתר.</p>
					<a
						className={styles.primary}
						href="/upload/auth/login"
						rel="nofollow"
					>
						כניסה לחשבון
					</a>
					<p className={styles.note}>
						הגישה מיועדת לבעלי חשבון שהוגדר מראש. לקבלת חשבון או לאיפוס סיסמה יש
						לפנות לצוות האתר.
					</p>
				</section>
			)}
		</main>
	);
}
