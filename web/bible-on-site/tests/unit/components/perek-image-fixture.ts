import type { PerekIllustration } from "../../../src/lib/seo/perek-illustrations";

export const sampleImage: PerekIllustration = {
	id: 17,
	src: "https://example-bucket.s3.il-central-1.amazonaws.com/perakim/sample.webp",
	width: 1600,
	height: 900,
	avifSrcSet:
		"https://example-bucket.s3.il-central-1.amazonaws.com/perakim/sample-640.avif 640w, https://example-bucket.s3.il-central-1.amazonaws.com/perakim/sample-1600.avif 1600w",
	socialSrc:
		"https://example-bucket.s3.il-central-1.amazonaws.com/perakim/sample-social.jpg",
	socialWidth: 1600,
	socialHeight: 900,
	alt: "איור לדוגמה לפרק",
	caption: "איור לדוגמה לפרק.",
	description: "תיאור לדוגמה.",
	credit: null,
};
