import { cookies } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { isChallengeToken } from "@/lib/bulletin-signup";
import { CONFIRM_TOKEN_COOKIE } from "@/lib/bulletin-signup/shared";
import styles from "../page.module.css";
import { ConfirmEmailForm } from "./ConfirmEmailForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: `אימות הרשמה לעלון היומי | ${SITE_NAME}`,
	// Mailed links must never be indexed.
	robots: { index: false, follow: false },
};

const OUTCOME_MESSAGES = {
	confirmed: "ההרשמה אושרה בהצלחה! העלון היומי יגיע אליכם בדוא\"ל.",
	expired: "תוקף קישור האימות פג. בקשו מייל אימות חדש דרך עמוד ההרשמה.",
	invalid: "קישור האימות אינו תקף. נסו להירשם מחדש דרך עמוד ההרשמה.",
	error: "לא ניתן לאשר כרגע. נסו שוב מאוחר יותר.",
} as const;

type Outcome = keyof typeof OUTCOME_MESSAGES;

type Props = {
	searchParams: Promise<{ t?: string; outcome?: string }>;
};

/**
 * Confirmation landing for the emailed link (#2940).
 *
 * The mailed `?t=` challenge never reaches rendered page data: it is handed
 * off to `/api/bulletin/confirm`, which stages it in an HttpOnly cookie and
 * lands here on a token-free URL. GET only renders — it never consumes the
 * challenge, so security scanners that prefetch links cannot confirm an
 * address. The explicit POST lives in `ConfirmEmailForm` (or the no-JS form
 * post to `/api/bulletin/confirm`).
 */
export default async function ConfirmEmailPage({ searchParams }: Props) {
	const { t, outcome } = await searchParams;
	// Normalize a token-bearing URL through the API hop before rendering.
	if (isChallengeToken(t)) {
		redirect(`/api/bulletin/confirm?t=${encodeURIComponent(t)}`);
	}
	const stored = (await cookies()).get(CONFIRM_TOKEN_COOKIE)?.value;
	const hasToken = isChallengeToken(stored);
	const message =
		outcome !== undefined && outcome in OUTCOME_MESSAGES
			? OUTCOME_MESSAGES[outcome as Outcome]
			: null;

	return (
		<main className={styles.page}>
			<section className={styles.card}>
				<h1>אימות הרשמה לעלון היומי</h1>
				{message !== null ? (
					<p className={styles.statusText} role="status">
						{message}
					</p>
				) : hasToken ? (
					<ConfirmEmailForm />
				) : (
					<p className={styles.statusText} role="status">
						{OUTCOME_MESSAGES.invalid}
					</p>
				)}
				<p className={styles.note}>
					<Link href="/join/email">חזרה לעמוד ההרשמה</Link>
				</p>
			</section>
		</main>
	);
}
