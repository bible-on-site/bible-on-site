# SES bulletin panel visual evidence

These are full-page captures of the real local admin application at `/bulletins`, using an isolated Chromium session with a 1440 x 1100 viewport.

- [Before](ses-before.png): the original bulletin preparation, delivery summary and HTML/PDF preview, captured before the email controls were added.
- [After](ses-after.png): the SES panel with the persisted test audience, synthetic test recipients, consent counts and disabled subscriber audience. The existing chapter and preview sections remain visible.

The after capture uses the disposable, local-only database `tanah_ses_ui_test_20261028`: one saved bulletin for 2026-10-28, test mode at revision 0, two confirmed `example.com` test recipients, and 52 pending `example.com` legacy subscribers. No real subscriber addresses appear in either image. The bulletin and PDF are local fixtures.

The preview ran on `127.0.0.1:3119` with `SKIP_AUTH=true` and `BULLETIN_EMAIL_WORKER_ENABLED=false`. SES readiness used the configured AWS profile to read the account and verified domain status. No send control was clicked, no audience was changed, no queue work was published, and no email was sent. The preview server was stopped after capture.

Capture command from the repository root, using the installed Playwright CLI:

```powershell
node web/admin/node_modules/playwright/cli.js screenshot --browser chromium --viewport-size '1440,1100' --full-page --wait-for-selector 'body:has(iframe):has(#email-audience)' --wait-for-timeout 1000 http://127.0.0.1:3119/bulletins .outputs/ses-after.png
```

The disposable fixture script and private preview environment remain under ignored `.outputs/`; database credentials and private runtime configuration are not part of this evidence. Visual inspection confirmed readable Hebrew/RTL layout, addresses aligned with their label, clear test-only sending, disabled subscriber activation with no confirmed subscribers, and the preserved preview.

## Email design evidence

- [Email before](email-before.png): the original rendered Hosea 2 email, including its separate verse paragraphs and contact footer outside the content card. This faithful baseline has no article, matching the original test input.
- [Email after](email-after.png): the redesigned email composed from the actual Rust CLI output and the actual SES transport's contact footer, at a 900 x 1100 viewport.
- [Email on a phone](email-after-mobile.png): the same composed email at a 390 x 844 viewport.

The after fixture includes existing public article 1599, `וארשתיך לי לעולם`, copied from the local database for preview and test use. No production article content, distribution approval flags, chapter routes or book routes were changed to create these images. The article remains complete, its heading appears once before its author, and canonical scripture retains its taamim and biblical maqaf. The PDF rendering content path remains unchanged.

The screenshots load local HTML files through an isolated Playwright Chromium session. The genuine native/PDF wordmark is the main heading image, with descriptive brand alt text, a proportional 220-pixel width and automatic height. Its verified HTTPS URL is under the existing public regional S3 asset bucket; normal TLS validation remains enabled. Website-derived PNG contact icons and the website link's globe use that same verified asset origin.

The chapter and article paragraphs are justified, with their last line aligned right and RTL direction retained. Verse letters are readable 14-pixel inline labels on the text baseline, without superscript positioning. The section label is `מאמר על הפרק` and the chapter link is `להמשך לימוד על הפרק`. The transport-composition step stubbed the provider send operation, preserving the real header, content, footer and native unsubscribe placeholder without sending an email. Final visual inspection confirmed the footer shares the content card's width and right alignment, contact values remain readable left-to-right, and the phone layout has no horizontal overflow.

The local source artifacts are `.outputs/ses-email-before.html` and `.outputs/ses-email-react-footer-complete.html`. The final after source uses the reviewed React server rendering of the footer. Fresh desktop and phone captures from that final composition were compared against the approved images; both their PNG hashes and pixel contents are identical. Reproduce the after capture from the repository root:

```powershell
node web/admin/node_modules/playwright/cli.js screenshot --browser chromium --viewport-size '900,1100' --full-page --wait-for-selector .bulletin-verse-number file:///ABSOLUTE_WORKTREE_PATH/.outputs/ses-email-react-footer-complete.html docs/daily-bulletin/screenshots/email-after.png
```

## WhatsApp panel evidence

- [Desktop before](whatsapp-before.png) and [desktop after](whatsapp-after.png): 1440 x 1100 viewports.
- [Phone before](whatsapp-before-mobile.png) and [phone after](whatsapp-after-mobile.png): 390 x 844 viewports.

The baseline renders the committed `DailyBulletinPage` before the WhatsApp controls were added. The after captures render the modified component and the real `BulletinWhatsAppControls`. Both use the admin's actual React components, Tailwind CSS and TanStack Router, with only the server-function modules replaced by local fixture functions. These are full-page captures from fresh, isolated Chromium contexts, without a user browser profile.

All content is synthetic: `reader@example.com`, a local sample bulletin and PDF, and a sample two-member test group with no provider identifiers. The real group is unconfigured, its option is disabled, and the saved WhatsApp audience is test. Existing email controls and the email preview remain visible. The test send button is shown only because the sample prepared PDF and cached connection verification satisfy the UI checks; every mutation function, including connection verification, throws in this preview.

The preview runs on `127.0.0.1:3122` with environment-file loading and public-file serving disabled. The isolated Vite configuration refuses backend imports beyond the three explicitly mocked server-function modules. Playwright permits only local GET requests and rejects every external request, API request, server-function request and non-GET request. The capture report recorded zero external, provider or mutation requests, zero page errors and no horizontal overflow in all four captures. No account, database, worker, credential, AWS resource or provider was accessed.

The ignored reproduction sources are `.outputs/whatsapp-visual/`; `capture-report.json` records the viewports and request checks. Start the isolated Vite configuration, then run `node .outputs/whatsapp-visual/capture.mjs`. The email iframe is scrolled into view before full-page capture so Chromium paints its local contents. Visual inspection confirmed readable Hebrew RTL controls, stacked group cards on a phone, the missing real-group message, and preserved email controls and preview.

## Telegram controls evidence

- [Before](telegram-before.png): the original actual DailyBulletinPage before Telegram controls were added, at 1440 x 1100. This baseline image is preserved unchanged.
- [After](telegram-after.png): the current actual component with independent Telegram controls, saved test mode, a named private test destination and disabled public activation.
- [Phone](telegram-after-mobile.png): the current component at 390 x 844, retaining the existing chapter, email controls and HTML preview.

The refreshed after captures use the ignored local Vite harness in .outputs/telegram-visual/. They render the actual source components, admin Tailwind CSS and TanStack Router with memory history. Only server-function modules use fixture adapters. The saved bulletin, two example.com email recipients, 52 pending subscribers and private destination are synthetic display fixtures. The public handle is the owner-selected @alhaperek channel. These fixture values do not establish that any bot or destination is configured or verified.

Every fixture mutation throws instead of sending, preparing or changing an audience. The preview disables environment-file loading and public-file serving and rejects backend imports beyond its three explicit server-function mocks. Fresh Chromium contexts have no user browser profile. Their request interceptor permits only local GET requests and refuses every external request, API/server-function request and non-GET request. The capture report records zero external, provider or mutation requests, zero page errors, no horizontal overflow and zero send clicks for both after captures. No database, AWS profile, token, provider API, authentication session or personal browser profile was accessed.

The desktop and phone captures show target-neutral private-test wording, the correct public channel and the existing email actions. The iframe is scrolled into view before capture so Chromium paints its local sample contents. Reproduce the after captures from the repository root by starting the isolated Vite configuration on 127.0.0.1:3123 and then running node .outputs/telegram-visual/capture.mjs. The ignored capture-report.json records the checks and viewports. The original before capture remains the pre-Telegram baseline. The preview server was stopped after capture.
