import localFont from "next/font/local";

export const alHeperek = localFont({
	src: [
		{
			path: "../../public/fonts/AlHeperekUI-Regular.woff2",
			weight: "400",
			style: "normal",
		},
		{
			path: "../../public/fonts/AlHeperekUI-SemiBold.woff2",
			weight: "600",
			style: "normal",
		},
		{
			path: "../../public/fonts/AlHeperekUI-Bold.woff2",
			weight: "700",
			style: "normal",
		},
	],
	variable: "--font-al-heperek",
	display: "swap",
});
