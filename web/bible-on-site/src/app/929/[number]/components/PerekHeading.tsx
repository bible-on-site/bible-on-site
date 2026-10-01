import type { PerekObj } from "@/data/perek-dto";
import styles from "../page.module.css";

export function PerekHeading({ perekObj }: { perekObj: PerekObj }) {
	return (
		<h1 className={styles.perekHeading}>
			{perekObj.header.trim() || perekObj.source}
		</h1>
	);
}
