# Tool Registry

Tracks researched tools. Check before first use, update after research.

| Tool | Version | Date | Key Learnings |
|------|---------|------|---------------|
| sqlite3 | 3.51.1 | 2026-01-03 | Path: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\SQLite.SQLite_Microsoft.Winget.Source_8wekyb3d8bbwe\sqlite3.exe`. Installed via WinGet. Use for querying SQLite databases. |
| icu_calendar | 2.1.1 | 2025-07-01 | Unicode-3.0 license (permissive). Hebrew calendar: `Date::try_new_iso(y,m,d).to_calendar(Hebrew::new())`. Access: `extended_year()`, `month().ordinal` (1-13), `day_of_month().0`. Months start from Tishrei. Leap years have 13 months (Adar I at ordinal 6, Adar II at 7). |
