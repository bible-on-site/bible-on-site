"use client";

import Script from "next/script";
import { useEffect, useSyncExternalStore } from "react";
import {
	getAnalyticsConsent,
	getAnalyticsConsentServerSnapshot,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";

const GA_MEASUREMENT_ID = "G-2CHER7MM85";

/**
 * Consent-gated GA4 (#2400, Amendment 13): the gtag loader itself stays out of
 * the page until the user explicitly opts in via the consent banner, so no
 * pre-consent pings at all; simpler and stronger than Consent Mode.
 * Granting mid-session mounts the scripts without a reload.
 */
export function GoogleAnalytics() {
	const consent = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsConsent,
		getAnalyticsConsentServerSnapshot,
	);
	// A deny after a grant cannot unmount the loaded gtag script; the
	// documented ga-disable-<id> flag suppresses its hits for the rest of
	// the session, and clears again if the user re-grants.
	useEffect(() => {
		(window as unknown as Record<string, boolean>)[
			`ga-disable-${GA_MEASUREMENT_ID}`
		] = consent === "denied";
	}, [consent]);
	if (!isProduction() || consent !== "granted") {
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
							gtag('config', '${GA_MEASUREMENT_ID}');
						}
						import('https://openfpcdn.io/botd/v2').then(function(Botd) {
							return Botd.load();
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
