import type { PerekObj } from "@/data/perek-dto";
import Link from "next/link";
import styles from "./breadcrumb.module.css";
// import Image from "next/image";

export const Breadcrumb = (props: { perekObj: PerekObj }) => {
	const perekObj = props.perekObj;
	return (
		<nav className={styles.grid}>
			<div className={styles.container}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ&quot;ך על הפרק</Link>{" "}
					</li>
					<li>
						<Link href="/929">על הפרק</Link>{" "}
					</li>
					<li
						className={`${styles.active}${styles.relative}${styles["drop-container"]}`}
					>
						<span>
							{perekObj.helek}{" "}
							<span
								className={`${styles.glyphicon}${styles["glyphicon-triangle-bottom"]}${styles.small}`}
								aria-hidden="true"
							/>
						</span>
						<div className={`${styles.drop}${styles["bg-white"]}`}>
							<ul className={`${styles.list}${styles.pl0}`}>
								<li>
									<Link href="/929">תורה</Link>{" "}
								</li>
								<li>
									<Link href="/929">נביאים</Link>{" "}
								</li>
								<li>
									<Link href="/929">כתובים</Link>{" "}
								</li>
							</ul>
						</div>
					</li>
					<li
						className={`${styles.active}${styles.relative}${styles["drop-container"]}`}
					>
						<span>
							{perekObj.sefer}
							<span
								className={`${styles.glyphicon}${styles["glyphicon-triangle-bottom"]}${styles.small}`}
								aria-hidden="true"
							/>
						</span>
						<div className={`${styles.drop}${styles["bg-white"]}`}>
							<ul className={`${styles.list}${styles.pl0}`}>
								<li>
									<Link href="/929">תורה</Link>{" "}
								</li>
								<li>
									<Link href="/929">נביאים</Link>{" "}
								</li>
								<li>
									<Link href="/929">כתובים</Link>{" "}
								</li>
							</ul>
						</div>
					</li>{" "}
					<li
						className={`${styles.active}${styles.relative}${styles["drop-container"]}`}
					>
						<span>
							{perekObj.perekHeb}
							<span
								className={`${styles.glyphicon}${styles["glyphicon-triangle-bottom"]}${styles.small}`}
								aria-hidden="true"
							/>
						</span>
						<div className={`${styles.drop}${styles["bg-white"]}`}>
							<ul className={`${styles.list}${styles.pl0}`}>
								<li>
									<Link href="/929">תורה</Link>{" "}
								</li>
								<li>
									<Link href="/929">נביאים</Link>{" "}
								</li>
								<li>
									<Link href="/929">כתובים</Link>{" "}
								</li>
							</ul>
						</div>
					</li>
				</ol>
			</div>
		</nav>
	);
};

export default Breadcrumb;
