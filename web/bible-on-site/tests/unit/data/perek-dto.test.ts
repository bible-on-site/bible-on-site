import moment from "moment-timezone";
import { getPerekIdByDate } from "../../../src/data/perek-dto";

function parseKosherChristianDate(
  dateString: string,
  timeString: string = "12:00:00",
  timezone: string = "Asia/Jerusalem" // Default to Jerusalem timezone
): Date {
  const dateParts = dateString.split("/");
  const day = parseInt(dateParts[0], 10);
  const month = new Date(dateParts[1] + " 1, 2000").getMonth(); // getMonth() needs a valid year
  const year = parseInt(dateParts[2], 10) + 2000; // Assumes the year is 2024, not 1924
  const timeParts = timeString.split(":");
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2], 10);

  const date = moment.tz(
    new Date(year, month, day, hours, minutes, seconds),
    timezone
  );
  return date.toDate();
}

describe("getPerekIdByDate", () => {
  describe("when 21 Sivan 5784", () => {
    it("returns 625", () => {
      const actual = getPerekIdByDate(parseKosherChristianDate("27/June/24"));
      expect(actual).toBe(625);
    });
  });
});
