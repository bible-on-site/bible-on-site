import localFont from "next/font/local";

// Keep Next.js font declarations separate from instrumented reader code.
// preload: false — Noto Serif is the opt-out/swap fallback, not the default.
export const hebrewSerif = localFont({
	src: "../../fonts/NotoSerifHebrew.woff2",
	variable: "--font-tanakh",
	display: "swap",
	preload: false,
});

// Taamey D is the default perek face (traditional te'amim font).
export const taameyD = localFont({
	src: "../../fonts/TaameyD.woff2",
	variable: "--font-tanakh-taamey",
	display: "swap",
});
