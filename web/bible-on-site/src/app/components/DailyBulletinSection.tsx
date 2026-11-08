import Image from "next/image";
import styles from "./DailyBulletinSection.module.css";
import { EmailSignupForm } from "./EmailSignupForm";

/**
 * The daily-bulletin join section (#2941): exactly three cards — Telegram,
 * WhatsApp, and email — stacked vertically on small screens and side by side
 * on wide screens.
 *
 * The Telegram and WhatsApp actions point at the stable first-party routes
 * `/dailyBulletin/join/telegram` and `/dailyBulletin/join/whatsapp` (#2939):
 * the rotating provider destinations are resolved server-side and never
 * appear in this markup. Provider links are plain anchors because the routes
 * redirect off-site — there is no client-side navigation to preserve.
 */
export function DailyBulletinSection() {
	return (
		<section id="bulletin" className={styles.section}>
			<header className={styles.header}>
				<h2>עלון יומי</h2>
				<h3>קבלו את הלימוד היומי ישירות אליכם</h3>
			</header>
			<div className={styles.cards}>
				<article
					id="bulletin-telegram"
					className={`${styles.card} ${styles.cardTelegram}`}
				>
					<Image
						className={styles.cardIcon}
						src="/icons/telegram.svg"
						alt=""
						width={40}
						height={40}
					/>
					<h3 className={styles.cardTitle}>טלגרם</h3>
					<p className={styles.cardText}>
						ערוץ הטלגרם של העלון - פרק יומי ומבזקים קצרים.
					</p>
					<a className={styles.cardAction} href="/dailyBulletin/join/telegram">
						הצטרפות לערוץ
					</a>
				</article>
				<article
					id="bulletin-whatsapp"
					className={`${styles.card} ${styles.cardWhatsapp}`}
				>
					<Image
						className={styles.cardIcon}
						src="/icons/whatsapp.svg"
						alt=""
						width={40}
						height={40}
					/>
					<h3 className={styles.cardTitle}>ווטסאפ</h3>
					<p className={styles.cardText}>
						קבוצת הווטסאפ של העלון - פרק יומי ישירות לטלפון.
					</p>
					<a className={styles.cardAction} href="/dailyBulletin/join/whatsapp">
						הצטרפות לקבוצה
					</a>
				</article>
				<article
					id="bulletin-email"
					className={`${styles.card} ${styles.cardEmail}`}
				>
					<Image
						className={styles.cardIcon}
						src="/icons/envelope.svg"
						alt=""
						width={40}
						height={40}
					/>
					<h3 className={styles.cardTitle}>דוא&quot;ל</h3>
					<p className={styles.cardText}>
						העלון היומי בתיבת הדוא&quot;ל שלכם, כל בוקר.
					</p>
					<EmailSignupForm source="card" />
				</article>
			</div>
		</section>
	);
}
