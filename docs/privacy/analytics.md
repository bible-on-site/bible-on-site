# Analytics and approval decision - 22 October 2026 (#2400)

Scope: nonprofit, advertising-free Hebrew learning service operated for Israel; the owner confirms AWS hosting in Israel. No accounts or login. Technical identifiers still exist, and external providers may process information outside Israel.

## Current result

Keep ordinary service statistics running in production. Remove the custom analytics-consent library, banner, launch dialog, reader notice, first-interaction gate, stored consent choices and analytics switches. Maintain the existing privacy-policy section and contact path. No current active capability was identified as a clear reason to show a separate approval question.

| Capability | Actual processing | Handling |
| --- | --- | --- |
| Website GA4 | Google receives page/referrer URLs (including possible query/search text), device/usage events, IP-derived location and cookie identifiers. No user ID is configured. | Ordinary statistics remain available without an approval gate; not described as fully anonymous. |
| Native Firebase Analytics | App-instance identifiers, device/screen/usage events. The search event API can carry text; no current callers were found. | Enabled after safe SDK initialization on ordinary launches; all test-traffic and platform startup guards remain authoritative. |
| Advertising/personalization | No advertisements or active advertising integration. | On the website, Google signals, ad personalization, ad user data and ad storage remain disabled. In the native app, ad personalization, Android advertising ID and iOS IDFA collection are disabled. Do not enable these as a side effect of ordinary analytics. |
| Website Ahrefs | URLs/referrer/device, general location and daily salted pseudonym; no cookies or cross-day identifier. | Existing aggregate measurement continues, disclosed in the policy. |
| Website BotD | Local bot detection; the code's CDN request exposes connection details to Fingerprint. | Keep bot filtering, explicitly disable optional monitoring. |
| Maps | Mapbox, OpenStreetMap and native map assets/CDNs receive map requests using biblical-place coordinates. | Disclose providers. No device-location request or geolocation control exists. |
| Protected device access | No camera, microphone, contacts, calendar, push, device-location or tracking-authorization feature found. Android declares internet/network/vibration only and removes AD_ID. | No duplicate or speculative permission question. Future protected access must use the applicable browser/system permission at the requested action. |
| Share/clipboard and local settings | Explicit user-triggered sharing/copying and local learning preferences/progress. | Keep existing system/browser handling; no additional consent layer. |

There are no current ad tags, social-tracking widgets or hardcoded iframe integrations in the inspected application code. Do not manufacture an approval question for capabilities the service does not offer. If a future feature introduces unrelated profiling, advertising or sensitive access, assess that specific operation and block only that operation where affirmative permission is required; ordinary statistics must not be coupled to it.

## Basis and limits

The [Privacy Protection Law as amended](https://main.knesset.gov.il/APPS/legislation/main/laws/2000234) defines consent as informed, express or implied (§3). Amendment 13 broadens identifiable personal information and enforcement; it does not introduce a universal cookie-accept button. Notice (§11), purpose limits (§8) and access/correction rights (§§13-14) remain relevant.

The final PPA statement dated 25 February 2026 distinguishes express from implied consent. Its §1 does not decide every circumstance requiring consent; §42 discusses informed continued browsing with a reasonable connection to the service, §44 rejects silence alone, and §45 recommends express consent. It does not establish a blanket rule requiring every service statistic to wait for an affirmative button. [Official landing page](https://www.gov.il/he/pages/consent-2026); [final regulator document mirrored by EBN](https://www.ebnlaw.co.il/wp-content/uploads/2026/03/%D7%92%D7%99%D7%9C%D7%95%D7%99-%D7%93%D7%A2%D7%AA-%D7%94%D7%A8%D7%A9%D7%95%D7%AA-%D7%9C%D7%A4%D7%A8%D7%98%D7%99%D7%95%D7%AA-2026.pdf). Official hosting returned 403; the dated final primary document was read at the mirror.

The owner selected the existing policy disclosure for ordinary Israel-directed service statistics, without a separate notice or question. This is the implementation's narrow applicability decision, not a claim that publishing terms automatically proves informed consent in every context, that nonprofit status creates a blanket exemption, or that technical identifiers are anonymous. No standalone affirmative-approval requirement was identified for the currently active configuration. International targeting and materially different uses need a fresh assessment instead of applying an imagined worldwide rule to this release.

[Google Analytics terms §7](https://marketingplatform.google.com/about/analytics/terms/us/) require privacy disclosure and storage consent where law requires it; Firebase GA4 uses the same terms (§17). [Google's EU policy](https://www.google.com/about/company/user-consent-policy/) has geographic and product conditions. It is not a worldwide or Israel-specific mandate for an analytics banner. There is no advertising/personalization operation to ask the user to authorize here.

Provider references: [Google privacy controls](https://developers.google.com/tag-platform/security/guides/privacy), [Firebase Android controls](https://firebase.google.com/docs/analytics/android/configure-data-collection), [Firebase iOS controls](https://firebase.google.com/docs/analytics/ios/configure-data-collection), [Ahrefs data inventory](https://help.ahrefs.com/en/articles/10247870-about-ahrefs-web-analytics), [BotD API](https://github.com/fingerprintjs/BotD/blob/main/docs/api.md). Google console retention, sharing/export settings and physical processing locations were not independently accessed; the policy does not invent a verified retention period or promise Israel-only provider processing.

## Privacy discovery and search

The existing policy stays available from navigation/footer and the global [RFC 6903 privacy-policy relation](https://www.rfc-editor.org/rfc/rfc6903.html#section-4). The legal section has data-nosnippet from initial rendering. [Google documents this](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) as snippet exclusion, not fragment noindex, a ranking guarantee, universal crawler support or compliance certification. Scripture/article pages receive no page-wide noindex/nosnippet. No separate legal page, entry notice, consent question or denied-analytics cookieless pings are added.
