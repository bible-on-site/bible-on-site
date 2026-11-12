/** @jest-environment node */
jest.mock("server-only", () => ({}));

const mockQuery = jest.fn();
jest.mock("@/lib/api-client", () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

import {
	isJoinChannel,
	resolveJoinDestination,
	validateJoinDestination,
} from "@/lib/bulletin-join";

describe("bulletin-join", () => {
	describe("isJoinChannel", () => {
		it.each(["whatsapp", "telegram"])("accepts %s", (channel) => {
			expect(isJoinChannel(channel)).toBe(true);
		});
		it.each(["email", "WhatsApp", "", "whatsapp/extra", null, 7])(
			"rejects %s",
			(channel) => {
				expect(isJoinChannel(channel)).toBe(false);
			},
		);
	});

	describe("validateJoinDestination", () => {
		it.each([
			"https://chat.whatsapp.com/AbCdEfGh1234567890",
			" https://chat.whatsapp.com/AbCdEfGh1234567890 ",
		])("accepts a whatsapp invitation %s", (value) => {
			expect(validateJoinDestination("whatsapp", value)).toBe(
				"https://chat.whatsapp.com/AbCdEfGh1234567890",
			);
		});

		it("accepts a telegram channel", () => {
			expect(validateJoinDestination("telegram", "https://t.me/alhaperek")).toBe(
				"https://t.me/alhaperek",
			);
		});

		it.each([
			["whatsapp", "https://t.me/alhaperek"],
			["whatsapp", "https://whatsapp.com/AbCdEfGh1234567890"],
			["whatsapp", "https://chat.whatsapp.com.evil.example/AbCdEfGh1234567890"],
			["whatsapp", "http://chat.whatsapp.com/AbCdEfGh1234567890"],
			["whatsapp", "https://chat.whatsapp.com/short"],
			["whatsapp", "https://chat.whatsapp.com/a/b/AbCdEfGh1234567890"],
			["whatsapp", "https://chat.whatsapp.com/AbCdEfGh1234567890?x=1"],
			["whatsapp", "https://chat.whatsapp.com/AbCdEfGh1234567890#f"],
			["whatsapp", "https://user:pw@chat.whatsapp.com/AbCdEfGh1234567890"],
			["whatsapp", "https://chat.whatsapp.com:8443/AbCdEfGh1234567890"],
			["whatsapp", "https://chat.whatsapp.com/AbCdEfGh_1234567890!"],
			["telegram", "https://telegram.me/alhaperek"],
			["telegram", "https://t.me/ab"],
			["telegram", "https://t.me/alhaperek/2"],
			["telegram", "https://t.me/alhaperek?start=x"],
			["telegram", "https://t.me/-123456789"],
			["telegram", "https://user@t.me/alhaperek"],
			["whatsapp", "not a url"],
			["whatsapp", ""],
			["whatsapp", null],
			["telegram", 42],
		])("rejects %s destination %s", (channel, value) => {
			expect(
				validateJoinDestination(
					channel as "whatsapp" | "telegram",
					value,
				),
			).toBeNull();
		});

		it("normalizes trailing slashes and case of the host", () => {
			expect(
				validateJoinDestination(
					"telegram",
					"https://T.ME/alhaperek/",
				),
			).toBe("https://t.me/alhaperek");
		});
	});

	describe("resolveJoinDestination", () => {
		beforeEach(() => mockQuery.mockReset());

		it("returns the normalized enabled destination", async () => {
			mockQuery.mockResolvedValue([{ destination: "https://t.me/alhaperek/" }]);
			await expect(resolveJoinDestination("telegram")).resolves.toBe(
				"https://t.me/alhaperek",
			);
			expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["telegram"]);
		});

		it("returns null when the row is missing or the channel disabled", async () => {
			mockQuery.mockResolvedValue([]);
			await expect(resolveJoinDestination("whatsapp")).resolves.toBeNull();
		});

		it("returns null for a stored value that fails validation", async () => {
			mockQuery.mockResolvedValue([{ destination: "https://evil.example/" }]);
			await expect(resolveJoinDestination("telegram")).resolves.toBeNull();
		});

		it("returns null for a null destination", async () => {
			mockQuery.mockResolvedValue([{ destination: null }]);
			await expect(resolveJoinDestination("whatsapp")).resolves.toBeNull();
		});
	});
});
