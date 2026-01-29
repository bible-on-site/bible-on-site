export type AppPlatform = {
	id: string;
	name: string;
	description: string;
	icon: string;
	href: string | null; // null means coming soon (no link)
	ribbon: "building" | "comingSoon";
};

export const appPlatforms: AppPlatform[] = [
	{
		id: "app-store",
		name: "App Store",
		description: 'יישומון תנ"ך על הפרק לאייפון',
		icon: "/icons/app-store.svg",
		href: null, // Coming soon
		ribbon: "comingSoon",
	},
	{
		id: "google-play",
		name: "Google Play",
		description: 'יישומון תנ"ך על הפרק לאנדרואיד',
		icon: "/icons/google-play.svg",
		href: "https://play.google.com/store/apps/details?id=com.tanah.daily929&pcampaignid=web_share",
		ribbon: "building",
	},
	{
		id: "microsoft-store",
		name: "Microsoft Store",
		description: 'יישומון תנ"ך על הפרק לווינדוס',
		icon: "/icons/windows.svg",
		href: "https://apps.microsoft.com/detail/9nblggh6b55k",
		ribbon: "building",
	},
];
