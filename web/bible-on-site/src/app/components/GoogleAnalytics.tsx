import { headers } from "next/headers";
import Script from "next/script";
import { isProduction } from "@/util/environment";

const GA_MEASUREMENT_ID = "G-2CHER7MM85";

export async function GoogleAnalytics() {
	if (!isProduction()) {
		return null;
	}

	const headersList = await headers();
	const botClass = headersList.get("x-bot-class");
	if (botClass) {
		return null;
	}

	return (
		<>
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
				strategy="afterInteractive"
			/>
			<Script id="google-analytics" strategy="afterInteractive">
				{`
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());
					gtag('config', '${GA_MEASUREMENT_ID}');
				`}
			</Script>
		</>
	);
}
