import type { Metadata } from "next";
import Link from "next/link";
import "./not-found.css";
import styles from "./not-found.module.css";

// A missing page is not a shareable resource — strip the root layout's
// homepage OG block so a 404 never advertises the site's URL as its own.
export const metadata: Metadata = {
	title: "העמוד לא נמצא",
	openGraph: null,
};

export default function NotFound() {
	return (
		<div className="not-found-layout">
			<div className={styles.notFoundPage}>
				<p className={styles.errorCode}>404</p>
				<h1 className={styles.pasuk}>הֲתָעִיף עֵינֶיךָ בּוֹ וְאֵינֶנּוּ</h1>
				<p className={styles.source}>(משלי כג ה)</p>

				<div className={styles.backLinkWrapper}>
					<Link href="/" className={styles.backLink}>
						חזרה לעמוד הראשי
					</Link>
				</div>
			</div>
		</div>
	);
}
