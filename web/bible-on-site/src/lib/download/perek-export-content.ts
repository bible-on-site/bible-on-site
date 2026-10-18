/**
 * Website-side perek content for PDF exports: pesukim keep their קרי/כתיב
 * structure and the reader's הסתר שם השם choice, and perek illustrations
 * travel as bytes, so the bulletin renders what the reader shows.
 */
import sharp from "sharp";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	type DivineNameMaskingSettings,
	maskDivineNameValue,
} from "@/lib/divine-name-masking";
import { perekImageUrl } from "@/lib/seo/perek-illustrations";
import { getPerekImagesByChapter } from "@/lib/seo/perek-images-data";
import { ExportError } from "./export-error";

export interface BulletinSegment {
	kind: "word" | "ktiv" | "qri";
	value: string;
}

export interface BulletinImage {
	dataBase64: string;
	ext: "jpg";
	caption: string;
}

export interface BulletinPerekContent {
	perekId: number;
	pesukim: BulletinSegment[][];
	images: BulletinImage[];
}

/** Print width keeps a full Sefer's request under the Lambda payload limit. */
const IMAGE_WIDTH = 1000;

/** Downloads an object from the configured image bucket, never another host. */
async function fetchBucketImage(src: string): Promise<ArrayBuffer> {
	const allowedOrigins = new Set([new URL(perekImageUrl("")).origin]);
	const url = new URL(src);
	if (allowedOrigins.has(url.origin)) {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.arrayBuffer();
	}
	throw new Error(`unexpected image origin ${url.origin}`);
}

async function fetchImage(
	src: string,
	caption: string,
	where: string,
): Promise<BulletinImage> {
	try {
		const jpeg = await sharp(Buffer.from(await fetchBucketImage(src)))
			.resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
			.jpeg({ quality: 80 })
			.toBuffer();
		return { dataBase64: jpeg.toString("base64"), ext: "jpg", caption };
	} catch (e) {
		console.error(`Perek image ${src} failed:`, e);
		throw new ExportError(
			`לא ניתן היה לטעון את האיור של ${where}. נסו להוריד שוב בעוד רגע.`,
		);
	}
}

export async function buildPerakimContent(
	perekIds: number[],
	masking: DivineNameMaskingSettings,
): Promise<BulletinPerekContent[]> {
	const imagesByPerek = await getPerekImagesByChapter();
	return Promise.all(
		perekIds.map(async (perekId) => {
			const perek = getPerekByPerekId(perekId);
			const pesukim = perek.pesukim.map((pasuk) =>
				pasuk.segments.flatMap((segment): BulletinSegment[] => {
					if (segment.type !== "ktiv" && segment.type !== "qri") return [];
					const kind =
						segment.type === "ktiv"
							? "ktiv"
							: isQriDifferentThanKtiv(segment)
								? "qri"
								: "word";
					return [{ kind, value: maskDivineNameValue(segment.value, masking) }];
				}),
			);
			const where = `${perek.sefer} ${perek.perekHeb}`;
			const images = await Promise.all(
				(imagesByPerek[perekId] ?? []).map((image) =>
					fetchImage(image.src, image.caption, where),
				),
			);
			return { perekId, pesukim, images };
		}),
	);
}
