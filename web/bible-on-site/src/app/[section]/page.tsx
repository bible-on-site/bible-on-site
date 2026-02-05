import Image from "next/image";
import Link from "next/link";
import { AppSection } from "../components/AppSection";
import { ContactSection } from "../components/ContactSection";
import { ScrollToSection } from "../components/ScrollToSection";
import { TanahSefarimSection } from "../components/TanahSefarimSection";
import { TosSection } from "../components/TosSection";
import styles from "./page.module.css";

// sections are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export function generateStaticParams() {
	// Return an array of objects with the key "section"
	return [
		{ section: "dailyBulletin" },
		{ section: "whatsappGroup" },
		{ section: "tos" },
		{ section: "app" },
		{ section: "contact" },
		{ section: "donation" },
		{ section: "tanah-sefarim" },
	];
}

export default async function Home({
	params,
}: {
	params: Promise<{ section: string }>;
}) {
	const { section } = await params;
	// Only scroll to section if it's a valid section with an element on the page
	const scrollTarget =
		section === "contact" ||
		section === "tos" ||
		section === "app" ||
		section === "tanah-sefarim"
			? section
			: undefined;
	return (
		<div className={styles.page}>
			{scrollTarget && <ScrollToSection sectionId={scrollTarget} />}
			<section className={styles.alHaperekSection}>
				<header className={styles.sectionHeader}>
					<h1 className={styles.sectionTitle}>תנ&quot;ך על הפרק</h1>
					<h2 className={styles.sectionSubtitle}>לימוד תנ&quot;ך יומי</h2>
				</header>
				<section
					className={`${styles.alHaperekHeadlines} ${styles.headlinesGrid}`}
				>
					<article className={styles.headlineArticle}>
						<h1 className={styles.headlineTitle}>
							<Link href="/929/">
								<Image
									className="icon-white"
									src="/icons/calendar-today.svg"
									alt="עלון יומי"
									width={48}
									height={48}
								/>
								<span>לימוד יומי על הפרק</span>
							</Link>
						</h1>
						<p>
							בתנ&quot;ך על הפרק לומדים במקביל ללימוד של 929 - פרק ליום. הלימוד
							נעים, מעמיק ומחכים.
						</p>
					</article>
					<article className={styles.headlineArticle}>
						<h1 className={styles.headlineTitle}>
							<Image
								className="icon-white"
								src="/icons/smartphone.svg"
								alt="עלון יומי"
								width={34}
								height={34}
							/>
							<span>ישומון תנ&quot;ך על הפרק</span>
						</h1>
						<p>
							לתנ&quot;ך על הפרק ישנה אפליקציה לכל סוגי הסמארטפונים העיקריים.
							באפליקציה תוכלו ללמוד תנ&quot;ך בנוחות.
						</p>
					</article>
				</section>
				<div className={styles.alHaperekDivider} />
			</section>
			<TanahSefarimSection />
			<AppSection />
			<TosSection />
			<ContactSection />
		</div>
	);
}
