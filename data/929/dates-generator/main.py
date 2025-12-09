from zoneinfo import ZoneInfo
from hdate import HDateInfo
from datetime import date
from typing import List

# Conversion from new month values to legacy format
# New: TISHREI=1, MARCHESHVAN=2, KISLEV=3, TEVET=4, SHVAT=5, ADAR=6, ADAR_I=7, ADAR_II=8, NISAN=9, IYYAR=10, SIVAN=11, TAMMUZ=12, AV=13, ELUL=14
# Legacy: TISHREI=1, MARCHESHVAN=2, KISLEV=3, TEVET=4, SHVAT=5, ADAR=6, NISAN=7, IYYAR=8, SIVAN=9, TAMMUZ=10, AV=11, ELUL=12, ADAR_I=13, ADAR_II=14
MONTH_NEW_TO_LEGACY = {
    1: 1,   # TISHREI
    2: 2,   # MARCHESHVAN
    3: 3,   # KISLEV
    4: 4,   # TEVET
    5: 5,   # SHVAT
    6: 6,   # ADAR (non-leap)
    7: 13,  # ADAR_I (leap) -> legacy 13
    8: 14,  # ADAR_II (leap) -> legacy 14
    9: 7,   # NISAN -> legacy 7
    10: 8,  # IYYAR -> legacy 8
    11: 9,  # SIVAN -> legacy 9
    12: 10,  # TAMMUZ -> legacy 10
    13: 11,  # AV -> legacy 11
    14: 12,  # ELUL -> legacy 12
}

# Initial cycle begin dates
cycle_begin_dates: List[HDateInfo] = list(
    map(HDateInfo, [date(2014, 12, 21), date(2018, 7, 15), date(2022, 2, 6), date(2025, 8, 31)],))

dates: List[List[int]] = []


def advance_date(hdate_obj: HDateInfo, steps: int) -> HDateInfo:
    for _ in range(steps):
        hdate_obj = hdate_obj.next_day
    return hdate_obj


for i in range(929):
    steps: int = 3 if i % 5 == 0 and i != 0 else 1
    curr_dates: List[HDateInfo] = cycle_begin_dates if i == 0 else [
        advance_date(hdate_item, steps) for hdate_item in curr_dates]
    perek_dates: List[int] = [int(
        f"{hdate_item.hdate.year}{str(MONTH_NEW_TO_LEGACY[hdate_item.hdate.month.value]).zfill(2)}{str(hdate_item.hdate.day).zfill(2)}") for hdate_item in curr_dates]
    dates.append(perek_dates)

print(dates)

# latest output can be found in aggregarions/text/tanah_view.txt
