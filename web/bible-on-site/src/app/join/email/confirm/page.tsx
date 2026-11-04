import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { isChallengeToken } from "@/lib/bulletin-signup";
import styles from "../page.module.css";
import { ConfirmEmailForm } from "./ConfirmEmailForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: `אימות הרשמה לעלון היומי | ${SITE_NAME}`,
	// Mailed links must never be indexed.
	robots: { index: false, follow: false },
};

/**
 * Removes the one-use challenge from the address bar and from history the
 * moment the document parses — before any deferred analytics script can
 * read `location.href`. The token still reaches the confirm form through
 * server-rendered props.
 */
const STRIP_TOKEN_SCRIPT = `(function(){try{var u=new URL(window.location.href);if(u.searchParams.has("t")){u.searchParams.delete("t");window.history.replaceState(null,"",u)}}catch(e){}})()`;

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
 * GET only renders: it never consumes the challenge, so security scanners
 * that prefetch links cannot confirm an address. The explicit POST lives in
 * `ConfirmEmailForm` (or the no-JS form post to `/api/bulletin/confirm`).
 */
export default async function ConfirmEmailPage({ searchParams }: Props) {
	const { t, outcome } = await searchParams;
	const hasToken = isChallengeToken(t);
	const message =
		outcome !== undefined && outcome in OUTCOME_MESSAGES
			? OUTCOME_MESSAGES[outcome as Outcome]
			: null;

	return (
		<main className={styles.page}>
			{/* Codacy anchors the dangerouslySetInnerHTML finding at this
			 * conditional expression, so the nosemgrep suppression must sit
			 * here rather than only beside the attribute (same as SeferPanel). */}
			{/* nosemgrep -- static self-contained script constant; no interpolated or user-controlled content */}
			{hasToken && (
				<script
					// nosemgrep -- static self-contained script constant; no interpolated or user-controlled content
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static, self-contained history cleanup
					dangerouslySetInnerHTML={{ __html: STRIP_TOKEN_SCRIPT }}
				/>
			)}
			<section className={styles.card}>
				<h1>אימות הרשמה לעלון היומי</h1>
				{message !== null ? (
					<p className={styles.statusText} role="status">
						{message}
					</p>
				) : hasToken ? (
					<ConfirmEmailForm token={t as string} />
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
