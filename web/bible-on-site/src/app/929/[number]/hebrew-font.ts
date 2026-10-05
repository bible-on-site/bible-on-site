import localFont from "next/font/local";

// Keep Next.js font declarations separate from instrumented reader code.
export const hebrewSerif = localFont({
	src: "../../fonts/NotoSerifHebrew.woff2",
	variable: "--font-tanakh",
	display: "swap",
});
