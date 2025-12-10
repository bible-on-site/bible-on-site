import type { PerekObj } from "@/data/perek-dto";
import { getSeferByName } from "@/data/sefer-dto";
import { sefarim } from "@/data/db/sefarim";
import type { SefarimItem } from "@/data/db/tanah-view-types";
import Link from "next/link";
import styles from "./breadcrumb.module.css";
import { toLetters } from "gematry";
// import Image from "next/image";

export const Breadcrumb = (props: { perekObj: PerekObj }) => {
	const perekObj = props.perekObj;
	const sefer = getSeferByName(perekObj.sefer, perekObj.additional);
	const perakim = sefer.perakim.map((perek, idx) => ({
		perekId: sefer.perekFrom + idx,
		perekHeb: toLetters(idx + 1),
	}));

	// Determine number of rows for perakim (max 10, but use actual count if less)
	const perakimRows = Math.min(perakim.length, 10);

	// Get all halakim (Torah, Nevi'im, Ketuvim)
	const halakim = [
		{ name: "תורה", perekId: 1 },
		{ name: "נביאים", perekId: 188 },
		{ name: "כתובים", perekId: 568 },
	];

	// Get all sefarim in current helek
	const sefarimInHelek = sefarim
		.filter((s) => s.helek === perekObj.helek)
		.map((s) => ({
			name: s.name,
			perekId: s.perekFrom,
		}));

	// Determine if current sefer has additionals (Shemuel, Melachim, Ezra/Nechemya)
	const currentSeferItem = sefarim.find((s) => s.name === perekObj.sefer);
	const hasAdditionals = currentSeferItem && "additionals" in currentSeferItem;
	const additionals = hasAdditionals
		? (currentSeferItem as SefarimItem & { additionals: any[] }).additionals.map(
				(a) => ({
					letter: a.letter,
					perekId: a.perekFrom,
				}),
		  )
		: [];

	// Determine CSS class for sefarim grid based on helek
	const seferGridClass =
		perekObj.helek === "תורה"
			? styles["sefer-grid-torah"]
			: perekObj.helek === "נביאים"
				? styles["sefer-grid-neviim"]
				: styles["sefer-grid"];
	return (
		<nav
			data-testid={`perek-breadcrumb-${perekObj.perekId}`}
			className={styles.grid}
		>
			<div className={styles.container}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ&quot;ך על הפרק</Link>{" "}
					</li>
					<li>
						<Link href="/929">על הפרק</Link>{" "}
					</li>
					<li
						className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
					>
						<span>
							{perekObj.helek}
							<span
								className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
								aria-hidden="true"
							/>
						</span>{" "}
						<div className={`${styles.drop} ${styles["bg-white"]}`}>
							<ul className={`${styles.list} ${styles.pl0}`}>
								{halakim.map((helek) => (
									<li key={helek.name}>
										<Link href={`/929/${helek.perekId}`}>{helek.name}</Link>
									</li>
								))}
							</ul>
						</div>
					</li>
					<li
						className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
					>
						<span>
							{perekObj.sefer}
							<span
								className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
								aria-hidden="true"
							/>
						</span>
						{" "}
						<div className={`${styles.drop} ${styles["bg-white"]} ${seferGridClass}`}>
							<ul className={`${styles.list} ${styles.pl0}`}>
								{sefarimInHelek.map((s) => (
									<li key={s.name}>
										<Link href={`/929/${s.perekId}`}>{s.name}</Link>
									</li>
								))}
							</ul>
						</div>
					</li>
					{hasAdditionals && perekObj.additional && (
						<>
							<li
								className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
							>
								<span>
									{perekObj.additional}
									<span
										className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
										aria-hidden="true"
									/>
								</span>
								{" "}
								<div className={`${styles.drop} ${styles["bg-white"]}`}>
									<ul className={`${styles.list} ${styles.pl0}`}>
										{additionals.map((a) => (
											<li key={a.letter}>
												<Link href={`/929/${a.perekId}`}>{a.letter}</Link>
											</li>
										))}
									</ul>
								</div>
							</li>
						</>
					)}
					<li
						className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
					>
						<span>
							{perekObj.perekHeb}
							<span
								className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
								aria-hidden="true"
							/>
						</span>
						<div
							className={`${styles.drop} ${styles["bg-white"]} ${styles["perek-grid"]}`}
							style={{ "--perek-rows": perakimRows } as React.CSSProperties}
						>
							<ul className={`${styles.list} ${styles.pl0}`}>
								{perakim.map((perek) => (
									<li key={perek.perekId}>
										<Link href={`/929/${perek.perekId}`}>{perek.perekHeb}</Link>
									</li>
								))}
							</ul>
						</div>
					</li>
				</ol>
			</div>
		</nav>
	);
};

export default Breadcrumb;
