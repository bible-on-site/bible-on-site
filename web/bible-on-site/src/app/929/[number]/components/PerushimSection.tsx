"use client";

import Link from "next/link";
import { useState } from "react";
import type { PerushDetail, PerushSummary } from "@/lib/perushim";
import { getPerushNotesForPage } from "../actions";
import { PerushFullView } from "./PerushFullView";
import styles from "./perushim-section.module.css";

interface PerushimSectionProps {
	perekId: number;
	perushim?: PerushSummary[] | null;
	/** When set, clicking a perush calls this instead of expanding inline (e.g. open in-place in flipbook). */
	onPerushClick?: (perush: PerushSummary) => void;
	/** When true, show loading state (e.g. fetching perush for in-place view). */
	loading?: boolean;
}

/**
 * Renders perushim (commentaries) for a perek as a horizontal carousel.
 * When onPerushClick is not provided, clicking a perush expands to show all its notes inline
 * while pushing a history entry so back-button and sharing work.
 * When onPerushClick is provided, clicking delegates to the callback (e.g. for flipbook in-place view).
 */
export function PerushimSection({
	perekId,
	perushim = [],
	onPerushClick,
	loading: externalLoading = false,
}: PerushimSectionProps) {
	const safePerushim = perushim ?? [];
	const [selected, setSelected] = useState<PerushDetail | null>(null);
	const [internalLoading, setInternalLoading] = useState(false);

	const loading = onPerushClick ? externalLoading : internalLoading;

	async function handlePerushClick(perush: PerushSummary) {
		if (onPerushClick) {
			onPerushClick(perush);
			return;
		}
		setInternalLoading(true);
		try {
			const notes = await getPerushNotesForPage(perush.id, perekId);
			const url = `/929/${perekId}/${encodeURIComponent(perush.name)}`;
			history.pushState({ perushId: perush.id }, "", url);
			setSelected({
				id: perush.id,
				name: perush.name,
				parshanName: perush.parshanName,
				notes,
			});
		} catch {
			setSelected(null);
		} finally {
			setInternalLoading(false);
		}
	}

	function handleBack() {
		setSelected(null);
		history.pushState(null, "", `/929/${perekId}`);
	}

	if (!onPerushClick && selected) {
		return (
			<PerushFullView perush={selected} onBack={handleBack} perekId={perekId} />
		);
	}

	return (
		<section
			className={styles.perushimSection}
			data-flipbook-no-flip
			aria-busy={loading}
		>
			<header className={styles.sectionHeader}>
				<span className={styles.sectionIcon}>📖</span>
				<h2 className={styles.sectionTitle}>פרשנים על הפרק</h2>
			</header>

			<div className={styles.carousel}>
				{safePerushim.length === 0 ? (
					<p className={styles.emptyMessage}>אין פרשנות לפרק זה</p>
				) : loading ? (
					<p className={styles.emptyMessage}>מתחבר לפירוש...</p>
				) : (
					safePerushim.map((perush) =>
						onPerushClick ? (
							<button
								key={perush.id}
								type="button"
								className={styles.carouselItem}
								onClick={() => handlePerushClick(perush)}
							>
								<div className={styles.perushIcon}>📜</div>
								<span className={styles.perushName}>{perush.name}</span>
								<span className={styles.parshanName}>{perush.parshanName}</span>
								<span className={styles.noteCount}>
									{perush.noteCount} פסוקים
								</span>
							</button>
						) : (
							<Link
								key={perush.id}
								href={`/929/${perekId}/${encodeURIComponent(perush.name)}`}
								className={styles.carouselItem}
								onClick={(e) => {
									e.preventDefault();
									handlePerushClick(perush);
								}}
							>
								<div className={styles.perushIcon}>📜</div>
								<span className={styles.perushName}>{perush.name}</span>
								<span className={styles.parshanName}>{perush.parshanName}</span>
								<span className={styles.noteCount}>
									{perush.noteCount} פסוקים
								</span>
							</Link>
						),
					)
				)}
			</div>
		</section>
	);
}
