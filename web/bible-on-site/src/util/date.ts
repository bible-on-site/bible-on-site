// Wrapper around Date constructor
// In E2E tests, the /api/dev/mock-date API sets process.env.MOCK_DATE

export function getCurrentDate(): Date {
	if (process.env.MOCK_DATE) {
		return new Date(process.env.MOCK_DATE);
	}
	return new Date();
}
