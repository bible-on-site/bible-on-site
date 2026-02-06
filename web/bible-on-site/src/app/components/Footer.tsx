import { toLetters } from "gematry";
import Image from "next/image";
import Link from "next/link";
import { HebrewDate } from "@/util/hebdates-util";
import styles from "./Footer.module.css";

const START_YEAR = 5775; // ה'תשע"ה

function formatHebrewYear(year: number): string {
	return year >= 5000
		? `ה'${toLetters(year - 5000, { addQuotes: true })}`
		: toLetters(year, { addQuotes: true });
}

export function Footer() {
	const currentYear = HebrewDate.fromGregorian(new Date()).year;
	const startYearStr = formatHebrewYear(START_YEAR);
	const currentYearStr = formatHebrewYear(currentYear);

	return (
		<footer className={styles.footer}>
			<nav className={styles.footerNav}>
				<Link href="/journalism" className={styles.footerLink}>
					על הפרק בתקשורת
				</Link>
				<span className={styles.separator}>|</span>
				<Link href="/rabbis-blessing" className={styles.footerLink}>
					רבנים מברכים
				</Link>
			</nav>
			<div className={styles.footerBottom}>
				<span className={styles.copyright}>
					© {startYearStr} - {currentYearStr} תנ״ך על הפרק
				</span>
				<span className={styles.separator}>|</span>
				<a
					href="https://github.com/bible-on-site/bible-on-site"
					target="_blank"
					rel="noopener noreferrer"
					className={styles.githubLink}
					aria-label="GitHub"
				>
					<Image
						src="/icons/github.svg"
						alt="GitHub"
						width={18}
						height={18}
						className={styles.githubIcon}
					/>
				</a>
			</div>
		</footer>
	);
}
