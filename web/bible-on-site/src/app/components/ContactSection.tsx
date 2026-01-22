import Image from "next/image";
import styles from "./ContactSection.module.css";

export function ContactSection() {
	return (
		<section id="contact" className={styles.contactSection}>
			<div className={styles.topDivider} />
			<article className={styles.contactContent}>
				<section className={styles.contactInfo}>
					<header className={styles.contactHeader}>
						<h1>יצירת קשר</h1>
						<h2>נשמח לשמוע מכם</h2>
					</header>
					<ul className={styles.contactList}>
						<li>
							<Image
								className="icon-white"
								src="/icons/whatsapp.svg"
								alt="ווטסאפ"
								width={24}
								height={24}
							/>
							<span>ווטסאפ</span>
							<span className={styles.separator} />
							<a
								href="https://wa.me/37257078640"
								target="_blank"
								rel="noopener noreferrer"
							>
								הודעה פרטית
							</a>
						</li>
						<li>
							<Image
								className="icon-white"
								src="/icons/phone.svg"
								alt="טלפון"
								width={24}
								height={24}
							/>
							<span>טלפון</span>
							<span className={styles.separator} />
							<a href="tel:+37257078640">+372-57078640</a>
						</li>
						<li>
							<Image
								className="icon-white"
								src="/icons/envelope.svg"
								alt='דוא"ל'
								width={24}
								height={24}
							/>
							<span>דוא&quot;ל</span>
							<span className={styles.separator} />
							<a href="mailto:tanah.site@gmail.com">tanah.site@gmail.com</a>
						</li>
						<li>
							<Image
								className="icon-white"
								src="/icons/telegram.svg"
								alt="טלגרם"
								width={24}
								height={24}
							/>
							<span>טלגרם</span>
							<span className={styles.separator} />
							<a
								href="https://t.me/BibleOnSite"
								target="_blank"
								rel="noopener noreferrer"
							>
								הודעה פרטית
							</a>
						</li>
					</ul>
				</section>
			</article>
			<div className={styles.bottomDivider} />
		</section>
	);
}
