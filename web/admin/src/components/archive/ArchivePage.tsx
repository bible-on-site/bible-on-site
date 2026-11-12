import { ArchiveArea } from "./ArchiveArea";
import styles from "./archive.module.css";
export function ArchivePage() {
	return (
		<div className={styles.area}>
			<p className={styles.eyebrow}>מרחב תוכן מאובטח</p>
			<h1>ארכיון</h1>
			<p className={styles.intro}>מקום פרטי להעלאת קבצים ולשמירת התוכן שלכם.</p>
			<ArchiveArea />
		</div>
	);
}
