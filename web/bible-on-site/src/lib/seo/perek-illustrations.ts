export interface PerekIllustration {
	id: number;
	src: string;
	width: number;
	height: number;
	avifSrcSet: string;
	socialSrc: string;
	socialWidth: number;
	socialHeight: number;
	alt: string;
	caption: string;
	description: string | null;
	credit: string | null;
}

export interface ImageRow {
	id: number;
	perek_id: number;
	alt_text: string;
	caption: string;
	description: string | null;
	credit: string | null;
	role: "display" | "social" | null;
	format: "avif" | "webp" | "jpeg" | null;
	width: number | null;
	height: number | null;
	s3_key: string | null;
}

interface Variant {
	role: "display" | "social";
	format: "avif" | "webp" | "jpeg";
	width: number;
	height: number;
	s3_key: string;
}

/** URLs use the same bucket and endpoint conventions as author images. */
export function perekImageUrl(key: string): string {
	const endpoint = process.env.S3_ENDPOINT;
	const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
	const region =
		process.env.S3_REGION || process.env.AWS_REGION || "il-central-1";
	const encodedKey = key.split("/").map(encodeURIComponent).join("/");
	return endpoint
		? `${endpoint.replace(/\/$/, "")}/${bucket}/${encodedKey}`
		: `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function imagesFromRows(
	rows: ImageRow[],
): Record<number, PerekIllustration[]> {
	const grouped = new Map<
		number,
		{ perekId: number; row: ImageRow; variants: Variant[] }
	>();
	for (const row of rows) {
		let entry = grouped.get(row.id);
		if (!entry) {
			entry = { perekId: row.perek_id, row, variants: [] };
			grouped.set(row.id, entry);
		}
		if (row.role && row.format && row.width && row.height && row.s3_key) {
			entry.variants.push({
				role: row.role,
				format: row.format,
				width: row.width,
				height: row.height,
				s3_key: row.s3_key,
			});
		}
	}
	const result: Record<number, PerekIllustration[]> = {};
	for (const { perekId, row, variants } of grouped.values()) {
		const display = variants
			.filter((v) => v.role === "display" && v.format === "webp")
			.sort((a, b) => b.width - a.width)[0];
		if (!display) continue;
		const social = variants.find(
			(v) => v.role === "social" && v.format === "jpeg",
		);
		const avifSrcSet = variants
			.filter((v) => v.role === "display" && v.format === "avif")
			.sort((a, b) => a.width - b.width)
			.map((v) => `${perekImageUrl(v.s3_key)} ${v.width}w`)
			.join(", ");
		if (!result[perekId]) result[perekId] = [];
		result[perekId].push({
			id: row.id,
			src: perekImageUrl(display.s3_key),
			width: display.width,
			height: display.height,
			avifSrcSet,
			socialSrc: social
				? perekImageUrl(social.s3_key)
				: perekImageUrl(display.s3_key),
			socialWidth: social?.width ?? display.width,
			socialHeight: social?.height ?? display.height,
			alt: row.alt_text,
			caption: row.caption,
			description: row.description,
			credit: row.credit,
		});
	}
	return result;
}

/** Keep client payloads scoped to the displayed sefer, not all 929 chapters. */
export function selectPerekImages(
	allImages: Record<number, PerekIllustration[]>,
	perekIds: number[],
): Record<number, PerekIllustration[]> {
	return Object.fromEntries(
		perekIds
			.filter((id) => allImages[id]?.length)
			.map((id) => [id, allImages[id]]),
	);
}
