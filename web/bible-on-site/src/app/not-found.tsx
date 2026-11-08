import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/app/components/PageShell";
import { NOT_FOUND_METADATA } from "@/lib/seo/missing-page";
import styles from "./not-found.module.css";

// A missing page is not a shareable resource — strip the root layout's
// homepage OG block so a 404 never advertises the site's URL as its own.
// The contract lives in a shared lib so route-level "entity missing"
// metadata fallbacks emit the identical title/metadata (issue #2935).
export const metadata: Metadata = NOT_FOUND_METADATA;

export default function NotFound() {
	return (
		<PageShell header="solid">
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
		</PageShell>
	);
}
