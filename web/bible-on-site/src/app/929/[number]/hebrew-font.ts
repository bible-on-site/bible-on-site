import localFont from "next/font/local";

// Keep Next.js font declarations separate from instrumented reader code.
export const hebrewSerif = localFont({
	src: "../../fonts/NotoSerifHebrew.woff2",
	variable: "--font-tanakh",
	display: "swap",
});

// Experimental Taamey D face for pesukim with taamim; selectable in reader settings.
// preload: false — only a fraction of readers opt in, so don't force the download.
export const taameyD = localFont({
	src: "../../fonts/TaameyD.woff2",
	variable: "--font-tanakh-taamey",
	display: "swap",
	preload: false,
});
