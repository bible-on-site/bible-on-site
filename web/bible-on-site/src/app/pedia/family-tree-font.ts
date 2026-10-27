import localFont from "next/font/local";

// Keep Next.js font declarations separate from instrumented reader code.
// Geist Sans is consumed only by PersonFamilyTree.module.css — scoping the
// declaration to the pedia route keeps its preload and @font-face off home,
// reader and every other route (issue #2734).
export const geistSans = localFont({
	src: "../fonts/GeistVF.woff",
	variable: "--font-geist-sans",
});
