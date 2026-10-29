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

## App join carousel evidence (#2806)

Real captures from the Android emulator (`1080 x 2400`) running the native עלון יומי join carousel.

- [Flyout before](app-bulletin-flyout-before.png): the app menu without a bulletin entry.
- [Flyout after](app-bulletin-flyout-after.png): עלון יומי and its nested קבוצת ווטסאפ entry, mirroring the website navigation.
- [Telegram card](app-bulletin-card-telegram.png): the first carousel card; הצטרפות opens the verified public channel `https://t.me/alhaperek`.
- [WhatsApp card](app-bulletin-card-whatsapp.png): the second card, also reached by the קבוצת ווטסאפ deep link (`?channel=whatsapp`); הצטרפות opens the published `wa.me` join number with a prefilled join request.
- [Email card](app-bulletin-card-email.png): the third card; הצטרפות opens the published subscription address with a join subject until the shared public signup API ships (see "Restore public email signup and channel/group join links" in `docs/daily-bulletin/daily-bulletin.md`).

The carousel is RTL, shows the shared top bar, peeks the adjacent card on narrow screens and exposes `BulletinJoin{Telegram|Whatsapp|Email}` automation identifiers with Hebrew semantic descriptions on each join button. No private test groups, destination IDs or provider credentials appear in the captures.
