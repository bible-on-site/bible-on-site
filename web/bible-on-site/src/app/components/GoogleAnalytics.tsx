import Script from "next/script";
import { isProduction } from "@/util/environment";

const GA_MEASUREMENT_ID = "G-220MEPY7WL";

export function GoogleAnalytics() {
	// Only enable Google Analytics in production
	if (!isProduction()) {
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
