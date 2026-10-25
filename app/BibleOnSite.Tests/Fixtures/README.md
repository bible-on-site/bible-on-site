`seek-reference.pcm.gz` is the independent, mono 44100 Hz signed 16-bit PCM reference for `data/recitation/fixtures/seek.mp3`. It was generated with:

```sh
ffmpeg -i data/recitation/fixtures/seek.mp3 -f s16le seek-reference.pcm
```

The app decoder browser regression compares original sample positions against this reference, including MP3 encoder priming, the first and last samples, word-sized clips, and disjoint verse selections. Small codec rounding differences are allowed; timing shifts are not.

`esther-10.mp3` is the unchanged original chapter recording, pinned by SHA-256 in `esther-10-reference.json`. Its reference contains only three approved canonical word windows (beginning, middle, end), decoded independently with `ffmpeg -i esther-10.mp3 -ar 44100 -ac 1 -f s16le`. Sample offsets use nearest-sample rounding with half samples rounded up, matching the decoder's interval convention. The complete recording remains intact; no MP3 segment seeking is used to build the reference.

`sedra-schedule.json` is the published weekly-parasha schedule for every
Shabbat of Gregorian years 2020-2060 (Hebrew years 5781-5821), on both the
Israel (`il`) and Diaspora (`dias`) calendars — 4,014 dated readings fetched
from the hebcal API (`cfg=json&s=on`, per-year). Festival Shabbats carry no
entry, so the fixture also asserts which weeks have no ordinary parasha. It
pins `SedraSchedule`'s keviyah join table and date arithmetic end-to-end.
