import Image from "next/image";
import type { PerekIllustration } from "@/lib/seo/perek-illustrations";
import styles from "../page.module.css";

export function PerekIntro({ images }: { images: PerekIllustration[] }) {
	if (images.length === 0) return null;

	return images.map((illustration, index) => (
		<figure key={illustration.id} className={styles.perekIntro}>
			<picture>
				{illustration.avifSrcSet && (
					<source
						type="image/avif"
						srcSet={illustration.avifSrcSet}
						sizes="(max-width: 768px) 100vw, 960px"
					/>
				)}
				<Image
					src={illustration.src}
					alt={illustration.alt}
					width={illustration.width}
					height={illustration.height}
					sizes="(max-width: 768px) 100vw, 960px"
					loading={index === 0 ? "eager" : "lazy"}
					fetchPriority={index === 0 ? "high" : "auto"}
					unoptimized
					className={styles.perekIllustration}
				/>
			</picture>
			<figcaption>
				{illustration.caption}
				{illustration.credit ? ` · ${illustration.credit}` : ""}
			</figcaption>
		</figure>
	));
}
