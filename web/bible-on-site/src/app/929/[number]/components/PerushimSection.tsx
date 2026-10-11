import Image from "next/image";
import Link from "next/link";
import type { PerushSummary } from "@/lib/perushim";
import { Carousel } from "./Carousel";
import styles from "./perushim-section.module.css";

interface PerushimSectionProps {
	perekId: number;
	perushim?: PerushSummary[] | null;
	/** When set, clicking a perush calls this instead of navigating (e.g. open in-place in flipbook). */
	onPerushClick?: (perush: PerushSummary) => void;
	/** When true, show loading state (e.g. fetching perush for in-place view). */
	loading?: boolean;
}

/**
 * Renders perushim (commentaries) for a perek as a horizontal carousel.
 * Each item links to the perush's dedicated page, which presents the full
 * commentary at the top — the same navigation pattern as article cards —
 * so a perush's content is rendered exactly once on the page.
 * When onPerushClick is provided, clicking delegates to the callback (e.g. for flipbook in-place view).
 */
export function PerushimSection({
	perekId,
	perushim = [],
	onPerushClick,
	loading = false,
}: PerushimSectionProps) {
	const safePerushim = perushim ?? [];

	return (
		<section
			className={styles.perushimSection}
			data-flipbook-no-flip
			aria-busy={loading}
		>
			<header className={styles.sectionHeader}>
				<Image
					src="/icons/open-book.svg"
					alt=""
					aria-hidden="true"
					width={18}
					height={18}
					className={styles.sectionIcon}
				/>
				<h2 className={styles.sectionTitle}>פרשנים על הפרק</h2>
			</header>

			<Carousel
				className={styles.carousel}
				prevLabel="פרשן קודם"
				nextLabel="פרשן הבא"
			>
				{safePerushim.length === 0 ? (
					<p className={styles.emptyMessage}>אין פרשנות לפרק זה</p>
				) : loading ? (
					<p className={styles.emptyMessage}>מתחבר לפירוש...</p>
				) : (
					safePerushim.map((perush) => (
						<Link
							key={perush.id}
							href={`/929/${perekId}/${encodeURIComponent(perush.name)}`}
							className={styles.carouselItem}
							onClick={
								onPerushClick
									? (e) => {
											// Modifier/new-tab clicks keep the
											// anchor's default navigation.
											if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
												return;
											}
											e.preventDefault();
											onPerushClick(perush);
										}
									: undefined
							}
						>
							<Image
								src="/icons/note.svg"
								alt=""
								aria-hidden="true"
								width={28}
								height={28}
								className={styles.perushIcon}
							/>
							<span className={styles.perushName}>{perush.name}</span>
							<span className={styles.parshanName}>{perush.parshanName}</span>
							<span className={styles.noteCount}>
								{perush.noteCount} פסוקים
							</span>
						</Link>
					))
				)}
			</Carousel>
		</section>
	);
}
