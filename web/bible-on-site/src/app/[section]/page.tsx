import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { AppSection } from "../components/AppSection";
import { ContactSection } from "../components/ContactSection";
import { Footer } from "../components/Footer";
import { ScrollToSection } from "../components/ScrollToSection";
import { TanahSefarimSection } from "../components/TanahSefarimSection";
import { TosSection } from "../components/TosSection";
import styles from "./page.module.css";

// Sections are a closed list. Sections without a homepage block of their own
// (donation, daily bulletin, WhatsApp group) scroll to the contact section,
// which is where donations and subscriptions are currently arranged.
const SECTIONS = {
	dailyBulletin: {
		title: "עלון יומי",
		description:
			'עלון יומי של תנ"ך על הפרק - לימוד הפרק היומי במייל, בטלגרם ובווטסאפ. ליצירת קשר והצטרפות.',
		scrollTarget: "contact",
	},
	whatsappGroup: {
		title: "קבוצת ווטסאפ",
		description:
			'קבוצת הווטסאפ של תנ"ך על הפרק - העלון היומי ישירות לטלפון. ליצירת קשר והצטרפות.',
		scrollTarget: "contact",
	},
	tos: {
		title: "תנאי שימוש",
		description: 'תנאי השימוש ומדיניות הפרטיות של תנ"ך על הפרק.',
		scrollTarget: "tos",
	},
	app: {
		title: "יישומון",
		description:
			'יישומון תנ"ך על הפרק לאנדרואיד, iOS ו-Windows - לימוד תנ"ך בנוחות מכל מקום.',
		scrollTarget: "app",
	},
	contact: {
		title: "צור קשר",
		description: 'יצירת קשר עם תנ"ך על הפרק בווטסאפ, בטלפון, בדוא"ל ובטלגרם.',
		scrollTarget: "contact",
	},
	donation: {
		title: "תרומות",
		description:
			'תרומה לתנ"ך על הפרק - האתר והיישומון ללא פרסומות, וההכנסות קודש ללימוד. ניתן להקדיש לימוד לעילוי נשמה, לרפואה ועוד.',
		scrollTarget: "contact",
	},
	"tanah-sefarim": {
		title: 'ספרי התנ"ך',
		description: 'כל ספרי התנ"ך - תורה, נביאים וכתובים - לקריאה ולימוד.',
		scrollTarget: "tanah-sefarim",
	},
} as const satisfies Record<
	string,
	{ title: string; description: string; scrollTarget: string }
>;

type Section = keyof typeof SECTIONS;

export const dynamicParams = false;

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export function generateStaticParams() {
	return Object.keys(SECTIONS).map((section) => ({ section }));
}

type Props = { params: Promise<{ section?: string }> };

const getSection = (section: string | undefined) =>
	section && Object.hasOwn(SECTIONS, section)
		? SECTIONS[section as Section]
		: undefined;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { section } = await params;
	const meta = getSection(section);
	if (!meta) notFound();
	return {
		title: `${meta.title} | ${SITE_NAME}`,
		description: meta.description,
		alternates: { canonical: `/${section}` },
	};
}

export default async function Home({ params }: Props) {
	const { section } = await params;
	const meta = getSection(section);
	if (section !== undefined && !meta) notFound();
	const scrollTarget = meta?.scrollTarget;
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
			<Footer />
		</div>
	);
}
