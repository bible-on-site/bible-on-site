import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import { getSeferCoverTitle, SEFER_COVER_BRANDING } from "@/data/sefer-cover";

interface SeferCoverContentProps {
	seferName: string;
	subtitle: string;
	edition?: string;
}

/** Front-cover face shared by every Sefer reader (929 and alternative divisions). */
export function SeferCoverContent({
	seferName,
	subtitle,
	edition,
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
			</div>
		</div>
	);
}
