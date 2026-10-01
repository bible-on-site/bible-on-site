import {
	type ImageRow,
	imagesFromRows,
	selectPerekImages,
} from "../../../../src/lib/seo/perek-illustrations";

const base: ImageRow = {
	id: 4,
	perek_id: 1,
	alt_text: "איור לדוגמה",
	caption: "כיתוב לדוגמה",
	description: "תיאור לדוגמה",
	credit: null,
	role: null,
	format: null,
	width: null,
	height: null,
	s3_key: null,
};

it("groups multiple images per chapter and retains ordered variants", () => {
	const rows: ImageRow[] = [
		{
			...base,
			role: "display",
			format: "avif",
			width: 640,
			height: 360,
			s3_key: "perakim/1/a-640.avif",
		},
		{
			...base,
			role: "display",
			format: "webp",
			width: 1600,
			height: 900,
			s3_key: "perakim/1/a.webp",
		},
		{
			...base,
			role: "display",
			format: "avif",
			width: 1600,
			height: 900,
			s3_key: "perakim/1/a-1600.avif",
		},
		{
			...base,
			role: "social",
			format: "jpeg",
			width: 1200,
			height: 630,
			s3_key: "perakim/1/a-social.jpg",
		},
		{
			...base,
			id: 5,
			role: "display",
			format: "webp",
			width: 800,
			height: 450,
			s3_key: "perakim/1/b.webp",
		},
	];
	const images = imagesFromRows(rows);
	expect(images[1]).toHaveLength(2);
	expect(images[1][0].avifSrcSet).toMatch(
		/a-640.avif 640w, .*a-1600.avif 1600w/,
	);
	expect(images[1][0].socialSrc).toContain("a-social.jpg");
	expect(images[1][0].socialWidth).toBe(1200);
	expect(images[1][1].socialSrc).toBe(images[1][1].src);
	expect(selectPerekImages(images, [1, 2])).toEqual({ 1: images[1] });
});

it("does not publish an image without a WebP display fallback", () => {
	expect(
		imagesFromRows([
			{
				...base,
				role: "display",
				format: "avif",
				width: 640,
				height: 360,
				s3_key: "x.avif",
			},
		]),
	).toEqual({});
});
