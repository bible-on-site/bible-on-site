import type { Metadata } from "next";
import Link from "next/link";
import { EmailSignupForm } from "@/app/components/EmailSignupForm";
import { pageHeader } from "@/app/components/PageShell";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
	title: `הרשמה לעלון היומי בדוא"ל | ${SITE_NAME}`,
	description:
		'הרשמה לעלון היומי של תנ"ך על הפרק בדוא"ל - הפרק היומי ישירות לתיבה, כל בוקר.',
	canonical: "/dailyBulletin/join/email",
});

/**
 * Standalone, shareable email-signup page (#2940). Uses the same reusable
 * signup component as the homepage card; the audience is fixed server-side
 * and never selectable by the visitor.
 */
export default function JoinEmailPage() {
	return (
		<main {...pageHeader("solid")} className={styles.page}>
			<section className={styles.card}>
				<h1>הרשמה לעלון היומי בדוא&quot;ל</h1>
				<p>
					הזינו את כתובת הדוא&quot;ל ואשרו את ההרשמה - העלון היומי יישלח אליכם
					כל בוקר.
				</p>
				<EmailSignupForm source="page" />
				<p className={styles.note}>
					להצטרפות בטלגרם או בווטסאפ ראו{" "}
					<Link href="/dailyBulletin">אפשרויות ההצטרפות לעלון היומי</Link>.
				</p>
			</section>
		</main>
	);
}
