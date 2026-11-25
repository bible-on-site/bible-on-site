import type { ReactNode } from "react";
import type { PediaImage, PediaImageLink } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

/** The concise credit shown next to every image — same `caption · credit`
 * treatment as the perek illustration captions (#3769). */
function conciseCredit(image: PediaImage): string | null {
	return image.creditLine || image.creator || image.sourceName;
}

function ProvenanceDetails({ image }: { image: PediaImage }) {
	const source = image.sourceName ? (
		image.sourceUrl ? (
			<a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">
				{image.sourceName}
			</a>
		) : (
			image.sourceName
		)
	) : image.sourceUrl ? (
		<a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">
			פריט המקור
		</a>
	) : null;
	const license = image.isPublicDomain ? (
		"נחלת הכלל"
	) : image.licenseName ? (
		image.licenseUrl ? (
			<a href={image.licenseUrl} target="_blank" rel="noopener noreferrer">
				{image.licenseName}
			</a>
		) : (
			image.licenseName
		)
	) : null;

	const rows: { label: string; value: ReactNode }[] = [];
	if (image.creator) rows.push({ label: "יוצר/צלם", value: image.creator });
	if (source) rows.push({ label: "מקור", value: source });
	if (license) rows.push({ label: "רישיון", value: license });
	if (image.modifications)
		rows.push({ label: "שינויים", value: image.modifications });
	if (rows.length === 0) return null;
	return (
		<dl className={styles.imageInfoList}>
			{rows.map((row) => (
				<div key={row.label} className={styles.imageInfoRow}>
					<dt>{row.label}</dt>
					<dd>{row.value}</dd>
				</div>
			))}
		</dl>
	);
}

function ImageFigure({ link }: { link: PediaImageLink }) {
	const { image } = link;
	const credit = conciseCredit(image);
	return (
		<figure className={styles.imageFigure}>
			{/* biome-ignore lint/performance/noImgElement: assets can live on any external host (Wikimedia, NLI); next/image remotePatterns can't cover arbitrary sources */}
			<img
				src={image.url}
				alt={image.altText}
				width={image.width ?? undefined}
				height={image.height ?? undefined}
				loading="lazy"
				className={styles.galleryImage}
			/>
			<figcaption className={styles.imageCaption}>
				<span className={styles.imageCredit}>
					{image.caption ?? credit}
					{image.caption && credit ? ` · ${credit}` : ""}
				</span>
				<details className={styles.imageInfo}>
					<summary aria-label="פרטי התמונה והקרדיט">ⓘ</summary>
					<div className={styles.imageInfoPanel}>
						<ProvenanceDetails image={image} />
						<span className={styles.imageInfoAlt}>תיאור: {image.altText}</span>
					</div>
				</details>
			</figcaption>
		</figure>
	);
}

/**
 * The entry-page image gallery (#3769): entry-scope links first (in their
 * stored order), then entity-scope links — the two scopes the public page
 * merges, matching `images`/`entityImages` on the API entry detail. A concise
 * credit rides under every image; the full attribution (creator, source,
 * license, modifications) opens on hover, keyboard focus or tap via the ⓘ
 * details — the required attribution travels with the image.
 */
export function EntryImageGallery({
	entryImages,
	entityImages,
}: {
	entryImages: PediaImageLink[];
	entityImages: PediaImageLink[];
}) {
	// Entry links win over the inherited entity copy when an editor explicitly
	// cross-links the same asset; the scopes stay separate for primary selection.
	const seenImageIds = new Set<string>();
	const links = [...entryImages, ...entityImages].filter((link) => {
		if (seenImageIds.has(link.image.imageId)) return false;
		seenImageIds.add(link.image.imageId);
		return true;
	});
	if (links.length === 0) return null;
	return (
		<section
			className={styles.entryImageSection}
			aria-labelledby="entry-images-heading"
		>
			<h2 id="entry-images-heading" className={styles.sectionTitle}>
				תמונות
			</h2>
			<ul className={styles.imageGallery}>
				{links.map((link) => (
					<li key={link.id}>
						<ImageFigure link={link} />
					</li>
				))}
			</ul>
		</section>
	);
}
