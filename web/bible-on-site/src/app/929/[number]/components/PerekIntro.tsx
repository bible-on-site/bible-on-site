import Image from "next/image";
import type { PerekObj } from "@/data/perek-dto";
import { getPerekIllustration } from "@/lib/seo/perek-illustrations";
import styles from "../page.module.css";

export function PerekIntro({ perekObj }: { perekObj: PerekObj }) {
	const illustration = getPerekIllustration(perekObj.perekId);
	return (
		<header className={styles.perekIntro}>
			<h1>{perekObj.source}</h1>
			{illustration && (
				<>
					<p className={styles.perekSummary}>{illustration.summary}</p>
					<figure className={styles.perekFigure}>
						<picture>
							<source
								type="image/avif"
								srcSet={illustration.avifSrcSet}
								sizes="(max-width: 768px) 100vw, 960px"
							/>
							<Image
								src={illustration.src}
								alt={illustration.alt}
								width={1600}
								height={900}
								sizes="(max-width: 768px) 100vw, 960px"
								loading="eager"
								fetchPriority="high"
								className={styles.perekIllustration}
							/>
						</picture>
						<figcaption>{illustration.caption}</figcaption>
					</figure>
				</>
			)}
		</header>
	);
}
