import localFont from "next/font/local";

// Keep Next.js font declarations separate from instrumented reader code.
// preload: false — both faces are opt-out/swap fallbacks, not the default
// (Al Heperek is the default perek face since #3685).
export const hebrewSerif = localFont({
	src: "../../fonts/NotoSerifHebrew.woff2",
	variable: "--font-tanakh",
	display: "swap",
	preload: false,
});

// Taamey D is an opt-in perek face (traditional te'amim font).
export const taameyD = localFont({
	src: "../../fonts/TaameyD.woff2",
	variable: "--font-tanakh-taamey",
	display: "swap",
	preload: false,
});
