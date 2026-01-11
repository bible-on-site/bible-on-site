//! Cycle dates generator.
//!
//! Generates Hebrew calendar dates and star rise times for the 929 Perakim study cycles.
//! Each cycle has 929 study days (one perek per day), with every 5th day
//! being a review day (3-day gap instead of 1).

use bson::Bson;
use chrono::{Datelike, NaiveDate, Timelike};
use chrono_tz::Asia::Jerusalem;
use icu_calendar::{Date, cal::Hebrew};
use sunrise::{Coordinates, SolarDay, SolarEvent};

/// Number of perakim in the Tanah
const NUM_PERAKIM: usize = 929;

/// Number of study cycles
const NUM_CYCLES: usize = 4;

/// Jerusalem coordinates (for star rise calculation)
const JERUSALEM_LAT: f64 = 31.7683;
const JERUSALEM_LON: f64 = 35.2137;
const JERUSALEM_ALTITUDE: f64 = 754.0; // meters

/// Cycle begin dates (Gregorian) for each 929 cycle
const CYCLE_BEGIN_DATES: [(i32, u32, u32); NUM_CYCLES] = [
    (2014, 12, 21), // Cycle 1: 29 Kislev 5775
    (2018, 7, 15),  // Cycle 2: 3 Av 5778
    (2022, 2, 6),   // Cycle 3: 5 Adar I 5782
    (2025, 8, 31),  // Cycle 4: 7 Elul 5785
];

/// Cycle dates: 929 perakim × 4 cycles each.
/// Each inner Vec contains 4 date integers (YYYYMMDD format in Hebrew calendar).
pub type CycleDates = Vec<Vec<i64>>;

/// Star rise times: 929 perakim × 4 cycles each.
/// Each inner Vec contains 4 time strings (HH:MM format).
pub type StarRiseTimes = Vec<Vec<String>>;

/// Generated cycle data including dates and star rise times.
pub struct CycleData {
    /// Hebrew dates in YYYYMMDD format
    pub dates: CycleDates,
    /// Star rise times in HH:MM format
    pub star_rise: StarRiseTimes,
}

/// Check if a Hebrew year is a leap year (has 13 months).
/// Leap years are years 3, 6, 8, 11, 14, 17, 19 in the 19-year Metonic cycle.
fn is_hebrew_leap_year(year: i32) -> bool {
    (7 * year + 1) % 19 < 7
}

/// Converts icu_calendar month ordinal to legacy format used in the database.
///
/// icu_calendar Hebrew months are numbered 1-12 for non-leap years:
///   1-Tishrei, 2-Ḥešvan, 3-Kīslev, 4-Ṭevet, 5-Šəvaṭ, 6-ʾĂdār,
///   7-Nīsān, 8-ʾĪyyar, 9-Sivan, 10-Tammūz, 11-ʾAv, 12-ʾElūl
///
/// In leap years, month 6 becomes Adar I (M05L), and Adar II is month 7 (M06L),
/// shifting subsequent months by 1.
///
/// Legacy format:
///   1-6:  Tishrei, Cheshvan, Kislev, Teves, Shvat, Adar (non-leap year only)
///   7-12: Nissan, Iyar, Sivan, Tammuz, Av, Elul
///   13:   Adar I (leap year only)
///   14:   Adar II (leap year only)
fn month_ordinal_to_legacy(ordinal: u8, year: i32) -> u8 {
    let is_leap = is_hebrew_leap_year(year);
    if !is_leap {
        // Non-leap year: direct mapping
        // ordinal 1-5 -> 1-5, 6 -> 6 (Adar), 7-12 -> 7-12
        ordinal
    } else {
        // Leap year: 1-12 months where 6=Adar I, 7=Adar II
        // icu_calendar uses 1-13 in leap years
        match ordinal {
            1..=5 => ordinal, // Tishrei..Shvat
            6 => 13,          // Adar I
            7 => 14,          // Adar II
            8 => 7,           // Nissan
            9 => 8,           // Iyar
            10 => 9,          // Sivan
            11 => 10,         // Tammuz
            12 => 11,         // Av
            13 => 12,         // Elul
            _ => ordinal,     // Shouldn't happen
        }
    }
}

/// Converts a Hebrew Date to the legacy integer format: YYYYMMDD
/// where MM is the legacy month number (see month_ordinal_to_legacy)
fn hdate_to_legacy_int(hdate: &Date<Hebrew>) -> i64 {
    let year = hdate.extended_year() as i64;
    let month_ordinal = hdate.month().ordinal;
    let month = month_ordinal_to_legacy(month_ordinal, hdate.extended_year()) as i64;
    let day = hdate.day_of_month().0 as i64;
    year * 10000 + month * 100 + day
}

/// Calculates star rise time (tzais hakochavim - when 3 medium stars appear) for a given date.
/// Uses sun at 7.083° below horizon, which is a common halachic opinion for tzais.
/// Returns time in HH:MM format in local Jerusalem time (with proper DST handling).
fn calculate_star_rise(date: NaiveDate) -> String {
    let coord = Coordinates::new(JERUSALEM_LAT, JERUSALEM_LON)
        .expect("Jerusalem coordinates should be valid");

    let solar_day = SolarDay::new(coord, date).with_altitude(JERUSALEM_ALTITUDE);

    // Tzais hakochavim: sun at 7.083° below horizon (common halachic opinion)
    // The sunrise crate expects a positive angle for dusk calculations
    // (the internal formula applies -sin(angle) to handle below-horizon geometry)
    const TZEIT_DEGREES: f64 = 7.083;
    let tzeit_radians = TZEIT_DEGREES.to_radians();

    let tzeit_event = SolarEvent::Elevation {
        elevation: tzeit_radians,
        morning: false, // evening event
    };

    let tzeit_time = solar_day.event_time(tzeit_event);

    match tzeit_time {
        Some(utc_datetime) => {
            // The sunrise crate returns DateTime<Utc>
            // Convert to Jerusalem local time (handles DST automatically)
            let jerusalem_datetime = utc_datetime.with_timezone(&Jerusalem);

            format!(
                "{:02}:{:02}",
                jerusalem_datetime.hour(),
                jerusalem_datetime.minute()
            )
        }
        None => {
            // Polar regions or calculation error - return empty
            "00:00".to_string()
        }
    }
}

/// Generates all cycle dates and star rise times.
pub fn generate() -> CycleData {
    // Track Gregorian dates - we'll derive Hebrew dates from these
    let mut cycle_gregorian: Vec<NaiveDate> = CYCLE_BEGIN_DATES
        .iter()
        .map(|(y, m, d)| NaiveDate::from_ymd_opt(*y, *m, *d).expect("Invalid Gregorian date"))
        .collect();

    let mut all_dates: CycleDates = Vec::with_capacity(NUM_PERAKIM);
    let mut all_star_rise: StarRiseTimes = Vec::with_capacity(NUM_PERAKIM);

    let hebrew_calendar = Hebrew::new();

    for perek in 0..NUM_PERAKIM {
        // Every 5th perek (except the first) has a 3-day gap (review day)
        let steps = if perek % 5 == 0 && perek != 0 { 3 } else { 1 };

        if perek != 0 {
            // Advance each cycle's date by `steps` days
            cycle_gregorian = cycle_gregorian
                .into_iter()
                .map(|d| d + chrono::Duration::days(steps.into()))
                .collect();
        }

        // Convert Gregorian to Hebrew dates using icu_calendar
        let perek_dates: Vec<i64> = cycle_gregorian
            .iter()
            .map(|&d| {
                let iso_date = Date::try_new_iso(d.year(), d.month() as u8, d.day() as u8)
                    .expect("Invalid ISO date");
                let hdate = iso_date.to_calendar(hebrew_calendar);
                hdate_to_legacy_int(&hdate)
            })
            .collect();

        let perek_star_rise: Vec<String> = cycle_gregorian
            .iter()
            .map(|&d| calculate_star_rise(d))
            .collect();

        all_dates.push(perek_dates);
        all_star_rise.push(perek_star_rise);
    }

    CycleData {
        dates: all_dates,
        star_rise: all_star_rise,
    }
}

/// Converts cycle dates to BSON array format for MongoDB aggregation.
pub fn dates_to_bson(dates: &CycleDates) -> Bson {
    let bson_dates: Vec<Bson> = dates
        .iter()
        .map(|perek_dates| Bson::Array(perek_dates.iter().map(|&d| Bson::Int64(d)).collect()))
        .collect();
    Bson::Array(bson_dates)
}

/// Converts star rise times to BSON array format for MongoDB aggregation.
pub fn star_rise_to_bson(star_rise: &StarRiseTimes) -> Bson {
    let bson_times: Vec<Bson> = star_rise
        .iter()
        .map(|perek_times| {
            Bson::Array(
                perek_times
                    .iter()
                    .map(|t| Bson::String(t.clone()))
                    .collect(),
            )
        })
        .collect();
    Bson::Array(bson_times)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_hebrew_leap_year() {
        // 5779 is a leap year (year 3 in cycle)
        assert!(is_hebrew_leap_year(5779));
        // 5782 is a leap year (year 6 in cycle)
        assert!(is_hebrew_leap_year(5782));
        // 5784 is a leap year (year 8 in cycle)
        assert!(is_hebrew_leap_year(5784));
        // 5775, 5778, 5785, 5786 are not leap years
        assert!(!is_hebrew_leap_year(5775));
        assert!(!is_hebrew_leap_year(5778));
        assert!(!is_hebrew_leap_year(5785));
        assert!(!is_hebrew_leap_year(5786));
    }

    #[test]
    fn test_month_ordinal_to_legacy_non_leap() {
        let year = 5775; // non-leap year
        assert_eq!(month_ordinal_to_legacy(1, year), 1); // Tishrei
        assert_eq!(month_ordinal_to_legacy(2, year), 2); // Cheshvan
        assert_eq!(month_ordinal_to_legacy(3, year), 3); // Kislev
        assert_eq!(month_ordinal_to_legacy(4, year), 4); // Teves
        assert_eq!(month_ordinal_to_legacy(5, year), 5); // Shvat
        assert_eq!(month_ordinal_to_legacy(6, year), 6); // Adar
        assert_eq!(month_ordinal_to_legacy(7, year), 7); // Nissan
        assert_eq!(month_ordinal_to_legacy(8, year), 8); // Iyar
        assert_eq!(month_ordinal_to_legacy(9, year), 9); // Sivan
        assert_eq!(month_ordinal_to_legacy(10, year), 10); // Tammuz
        assert_eq!(month_ordinal_to_legacy(11, year), 11); // Av
        assert_eq!(month_ordinal_to_legacy(12, year), 12); // Elul
    }

    #[test]
    fn test_month_ordinal_to_legacy_leap() {
        let year = 5779; // leap year
        assert_eq!(month_ordinal_to_legacy(5, year), 5); // Shvat
        assert_eq!(month_ordinal_to_legacy(6, year), 13); // Adar I
        assert_eq!(month_ordinal_to_legacy(7, year), 14); // Adar II
        assert_eq!(month_ordinal_to_legacy(8, year), 7); // Nissan
        assert_eq!(month_ordinal_to_legacy(13, year), 12); // Elul
    }

    #[test]
    fn test_hdate_to_legacy_int() {
        let hebrew_calendar = Hebrew::new();

        // 29 Kislev 5775 = Dec 21, 2014
        let iso_date = Date::try_new_iso(2014, 12, 21).unwrap();
        let hdate = iso_date.to_calendar(hebrew_calendar);
        assert_eq!(hdate.extended_year(), 5775);
        assert_eq!(hdate.month().ordinal, 3); // Kislev
        assert_eq!(hdate.day_of_month().0, 29);
        assert_eq!(hdate_to_legacy_int(&hdate), 57750329);

        // 3 Av 5778 = July 15, 2018
        let iso_date2 = Date::try_new_iso(2018, 7, 15).unwrap();
        let hdate2 = iso_date2.to_calendar(hebrew_calendar);
        assert_eq!(hdate2.extended_year(), 5778);
        // Av is month 11 in legacy, ordinal 11 in non-leap year
        assert_eq!(hdate_to_legacy_int(&hdate2), 57781103);
    }

    #[test]
    fn test_cycle_begin_dates_convert() {
        let hebrew_calendar = Hebrew::new();

        // First cycle begins on 2014-12-21 which is 29 Kislev 5775
        let iso_date = Date::try_new_iso(2014, 12, 21).unwrap();
        let hdate = iso_date.to_calendar(hebrew_calendar);
        assert_eq!(hdate.extended_year(), 5775);
        assert_eq!(hdate.month().ordinal, 3); // Kislev is month 3
        assert_eq!(hdate.day_of_month().0, 29);
        // Kislev = month 3 in legacy format
        assert_eq!(hdate_to_legacy_int(&hdate), 57750329);

        // Second cycle begins on 2018-07-15 which is 3 Av 5778
        let iso_date2 = Date::try_new_iso(2018, 7, 15).unwrap();
        let hdate2 = iso_date2.to_calendar(hebrew_calendar);
        assert_eq!(hdate2.extended_year(), 5778);
        assert_eq!(hdate2.month().ordinal, 11); // Av is month 11 in non-leap year
        assert_eq!(hdate2.day_of_month().0, 3);
        // Av = month 11 in legacy format
        assert_eq!(hdate_to_legacy_int(&hdate2), 57781103);
    }

    #[test]
    fn test_generate_produces_correct_structure() {
        let data = generate();

        assert_eq!(data.dates.len(), NUM_PERAKIM, "Should have 929 perakim");
        assert_eq!(
            data.star_rise.len(),
            NUM_PERAKIM,
            "Should have 929 star rise entries"
        );

        assert_eq!(
            data.dates[0].len(),
            NUM_CYCLES,
            "Each perek should have 4 cycle dates"
        );
        assert_eq!(
            data.star_rise[0].len(),
            NUM_CYCLES,
            "Each perek should have 4 star rise times"
        );

        // Verify first perek dates match cycle begin dates
        assert_eq!(data.dates[0][0], 57750329); // Cycle 1: 29 Kislev 5775
        assert_eq!(data.dates[0][1], 57781103); // Cycle 2: 3 Av 5778
    }

    #[test]
    fn test_star_rise_format() {
        let data = generate();

        // Star rise times should be in HH:MM format
        for perek_times in &data.star_rise {
            for time in perek_times {
                assert_eq!(time.len(), 5, "Time should be in HH:MM format");
                assert_eq!(&time[2..3], ":", "Time should have colon separator");

                let hours: u32 = time[0..2].parse().expect("Hours should be numeric");
                let minutes: u32 = time[3..5].parse().expect("Minutes should be numeric");

                assert!(hours < 24, "Hours should be < 24");
                assert!(minutes < 60, "Minutes should be < 60");
            }
        }
    }

    #[test]
    fn test_star_rise_reasonable_times() {
        let data = generate();

        // For Jerusalem, star rise should generally be between 17:00 and 21:00
        // depending on season. Allow some margin for edge cases.
        let first_perek_times = &data.star_rise[0];

        for time in first_perek_times {
            let hours: u32 = time[0..2].parse().unwrap();
            // Star rise in Jerusalem is typically between 17:00 and 21:00
            // (earlier in winter, later in summer)
            assert!(
                (17..=21).contains(&hours),
                "Star rise time {} should be between 17:00 and 21:00 for Jerusalem",
                time
            );
        }
    }
}
