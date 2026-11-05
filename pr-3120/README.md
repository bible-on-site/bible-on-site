# Evidence — #3069 Telegram bulletin: attachment-only delivery

The Telegram bulletin already arrives as a native `sendDocument` PDF
attachment; this change removes the `להורדת העלון` inline-keyboard button
that pointed at the now-deleted anonymous admin route
(`/api/bulletin-documents/{date}/{sha256}.pdf`).

## What each file shows

| File | Content |
| --- | --- |
| `before-telegram-bulletin.png` | Channel message on master: frozen PDF attachment + caption/source link + the extra inline download button whose URL hit the anonymous admin handler. |
| `after-telegram-bulletin.png` | Channel message on this PR: identical attachment, filename, caption and source link — the button is gone. The PDF remains tappable/downloadable inside Telegram itself. |
| `mock.html` | The faithful static mockup the captures were rendered from (Playwright, `bun x playwright`/`@playwright/test` in `web/admin`). |

## Note on capture method

These are faithful mockups, not live Telegram captures: a real send requires
production bot credentials and would post to a channel — out of scope for PR
evidence. The wire-level before/after is covered by unit tests instead
(`tests/unit/server/telegram-client.test.ts` asserts the `sendDocument`
FormData contains exactly `chat_id`, `caption` and `document` — no
`reply_markup`, no admin URL).
