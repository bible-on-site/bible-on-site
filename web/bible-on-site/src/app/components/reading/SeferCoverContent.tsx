import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import { getSeferCoverTitle, SEFER_COVER_BRANDING } from "@/data/sefer-cover";

interface SeferCoverContentProps {
	seferName: string;
	subtitle: string;
	edition?: string;
	/**
	 * Pre-formatted dedication lines (`formatDedication`) for this cover —
	 * the sefer-level dedication on /929 sefarim (#2731), the whole-feature
	 * dedication on the מסורה book.
	 */
	dedications?: string[];
}

/** Front-cover face shared by every Sefer reader (929 and alternative divisions). */
export function SeferCoverContent({
	seferName,
	subtitle,
	edition,
	dedications,
}: SeferCoverContentProps) {
	return (
		<div className={seferStyles.coverInner}>
			<div className={seferStyles.coverContent}>
				<div className={seferStyles.coverOrnament}>✦</div>
				<p className={seferStyles.coverSubtitle}>{SEFER_COVER_BRANDING}</p>
				<h2 className={seferStyles.coverTitle}>
					{getSeferCoverTitle(seferName)}
				</h2>
				<div className={seferStyles.coverDivider} />
				<p className={seferStyles.coverSubtitle}>{subtitle}</p>
				{edition && <p className={seferStyles.coverEdition}>{edition}</p>}
				{dedications?.map((line, index) => (
					// Two dedications can format to the same line; the index keeps
					// them distinct — the list itself is positionally stable.
					// biome-ignore lint/suspicious/noArrayIndexKey: content is the identity
					<p key={index} className={seferStyles.coverDedication}>
						{line}
					</p>
				))}
			</div>
		</div>
	);
}
