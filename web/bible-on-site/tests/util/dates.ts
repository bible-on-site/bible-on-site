import moment from "moment-timezone";

export function parseKosherChristianDate(
	dateString: string,
	timeString = "12:00:00",
	timezone = "Asia/Jerusalem", // Default to Jerusalem timezone
): Date {
	const dateParts = dateString.split("/");
	const day = Number.parseInt(dateParts[0], 10);
	const month = new Date(`${dateParts[1]} 1, 2000`).getMonth(); // getMonth() needs a valid year
	const year = Number.parseInt(dateParts[2], 10) + 2000; // Assumes the year is 2024, not 1924
	const timeParts = timeString.split(":");
	const hours = Number.parseInt(timeParts[0], 10);
	const minutes = Number.parseInt(timeParts[1], 10);
	const seconds = Number.parseInt(timeParts[2], 10);

	const date = moment.tz(
		new Date(year, month, day, hours, minutes, seconds),
		timezone,
	);
	return date.toDate();
}
