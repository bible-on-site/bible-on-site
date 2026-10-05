import type { PerekObj } from "@/data/perek-dto";
import styles from "../page.module.css";

export function PerekHeading({ perekObj }: { perekObj: PerekObj }) {
	const header = perekObj.header.trim();
	return (
		<h1 className={styles.perekHeading}>
			{header ? `${perekObj.source} - ${header}` : perekObj.source}
		</h1>
	);
}
