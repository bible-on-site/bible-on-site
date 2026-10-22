"use client";

import Script from "next/script";
import { useEffect, useSyncExternalStore } from "react";
import {
	getAnalyticsStatus,
	getAnalyticsStatusServerSnapshot,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";

const GA_MEASUREMENT_ID = "G-2CHER7MM85";

/** Service measurement starts after the entry notice and continued use. */
export function GoogleAnalytics() {
	const consent = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsStatus,
		getAnalyticsStatusServerSnapshot,
	);
	// A deny after a grant cannot unmount the loaded gtag script; the
	// documented ga-disable-<id> flag suppresses its hits for the rest of
	// the session, and clears again if the user re-grants.
	useEffect(() => {
		(window as unknown as Record<string, boolean>)[
			`ga-disable-${GA_MEASUREMENT_ID}`
		] = consent !== "enabled";
	}, [consent]);
	if (!isProduction() || consent !== "enabled") {
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
					(function() {
						var ua = navigator.userAgent || '';
						if (/bot|crawl|spider|slurp|Bytespider|GPTBot|ClaudeBot|CCBot|Amazonbot|Diffbot|PetalBot|AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|YandexBot|Sogou|Applebot|Googlebot|bingbot|PerplexityBot|FacebookBot|anthropic|TikTokSpider|Baiduspider|MegaIndex/i.test(ua)) {
							return;
						}
						function initGA() {
							window.dataLayer = window.dataLayer || [];
							function gtag(){dataLayer.push(arguments);}
							gtag('js', new Date());
							gtag('consent', 'default', {ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'});
							gtag('config', '${GA_MEASUREMENT_ID}', {allow_google_signals: false, allow_ad_personalization_signals: false});
						}
						import('https://openfpcdn.io/botd/v2').then(function(Botd) {
							return Botd.load({ monitoring: false });
						}).then(function(botd) {
							return botd.detect();
						}).then(function(result) {
							if (!result.bot) { initGA(); }
						}).catch(function() {
							initGA();
						});
					})();
				`}
			</Script>
		</>
	);
}
