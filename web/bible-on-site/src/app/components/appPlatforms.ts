export type AppPlatform = {
	id: string;
	name: string;
	description: string;
	icon: string;
	href: string | null; // null means coming soon (no link)
};

export const appPlatforms: AppPlatform[] = [
	{
		id: "app-store",
		name: "App Store",
		description: 'יישומון תנ"ך על הפרק לאייפון',
		icon: "/icons/app-store.svg",
		href: "https://apps.apple.com/il/app/%D7%AA-%D7%A0-%D7%9A-%D7%A2-%D7%9C-%D7%94-%D7%A4-%D7%A8-%D7%A7-929/id1045128150?l=he",
	},
	{
		id: "google-play",
		name: "Google Play",
		description: 'יישומון תנ"ך על הפרק לאנדרואיד',
		icon: "/icons/google-play.svg",
		href: "https://play.google.com/store/apps/details?id=com.tanah.daily929&pcampaignid=web_share",
	},
	{
		id: "microsoft-store",
		name: "Microsoft Store",
		description: 'יישומון תנ"ך על הפרק לווינדוס',
		icon: "/icons/windows.svg",
		href: "https://apps.microsoft.com/detail/9nblggh6b55k",
	},
];
