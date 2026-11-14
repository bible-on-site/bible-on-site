import { describe, expect, it } from "vitest";
import {
	isJoinChannel,
	JOIN_CHANNELS,
	validateJoinDestination,
	validateJoinLinkChange,
} from "~/lib/bulletin-join";

describe("JOIN_CHANNELS / isJoinChannel", () => {
	it("declares telegram before whatsapp in canonical order", () => {
		expect(JOIN_CHANNELS).toEqual(["telegram", "whatsapp"]);
	});

	it.each(["telegram", "whatsapp"])("accepts %s", (channel) => {
		expect(isJoinChannel(channel)).toBe(true);
	});

	it.each(["email", "Telegram", "WHATSAPP", "", null, undefined, 7, {}])(
		"rejects %j",
		(value) => {
			expect(isJoinChannel(value)).toBe(false);
		},
	);
});

describe("validateJoinDestination", () => {
	it.each([
		"https://chat.whatsapp.com/AbCdEfGh1234567890",
		"  https://chat.whatsapp.com/AbCdEfGh1234567890  ",
		"https://CHAT.WHATSAPP.COM/AbCdEfGh1234567890",
	])("accepts and normalizes a whatsapp invitation %s", (value) => {
		expect(validateJoinDestination("whatsapp", value)).toBe(
			"https://chat.whatsapp.com/AbCdEfGh1234567890",
		);
	});

	it.each(["https://t.me/alhaperek", "https://t.me/AlHaPerek_1/"])(
		"accepts a telegram channel %s",
		(value) => {
			expect(validateJoinDestination("telegram", value)).toMatch(
				/^https:\/\/t\.me\//,
			);
		},
	);

	it.each([
		["whatsapp", "https://t.me/alhaperek"],
		["whatsapp", "https://whatsapp.com/AbCdEfGh1234567890"],
		["whatsapp", "https://chat.whatsapp.com.evil.example/AbCdEfGh1234567890"],
		["whatsapp", "http://chat.whatsapp.com/AbCdEfGh1234567890"],
		["whatsapp", "https://chat.whatsapp.com/short"],
		["whatsapp", "https://chat.whatsapp.com/a/b/AbCdEfGh1234567890"],
		["whatsapp", "https://chat.whatsapp.com/AbCdEfGh1234567890?x=1"],
		["whatsapp", "https://chat.whatsapp.com/AbCdEfGh1234567890#frag"],
		["whatsapp", "https://user:pw@chat.whatsapp.com/AbCdEfGh1234567890"],
		["whatsapp", "https://chat.whatsapp.com:8443/AbCdEfGh1234567890"],
		["whatsapp", "https://chat.whatsapp.com/AbCdEfGh_1234567890!"],
		["whatsapp", "https://chat.whatsapp.com/"],
		["telegram", "https://telegram.me/alhaperek"],
		["telegram", "https://t.me/ab"],
		["telegram", "https://t.me/alhaperek/2"],
		["telegram", "https://t.me/alhaperek?start=x"],
		["telegram", "https://t.me/1alhaperek"],
		["telegram", "https://t.me/+AbCdEfGh1234567890"],
		["telegram", "https://user@t.me/alhaperek"],
		["whatsapp", "not a url"],
		["whatsapp", ""],
		["whatsapp", "   "],
		["whatsapp", null],
		["whatsapp", undefined],
		["telegram", 42],
	] as const)("rejects %s destination %s", (channel, value) => {
		expect(validateJoinDestination(channel, value)).toBeNull();
	});
});

describe("validateJoinLinkChange", () => {
	const telegram = {
		channel: "telegram",
		enabled: true,
		destination: "https://t.me/alhaperek",
		expectedRevision: 3,
	};

	it("accepts an enabled channel with a valid destination", () => {
		expect(validateJoinLinkChange(telegram)).toEqual({
			channel: "telegram",
			enabled: true,
			destination: "https://t.me/alhaperek",
			expectedRevision: 3,
		});
	});

	it("accepts disabling a channel while keeping its stored destination", () => {
		expect(
			validateJoinLinkChange({ ...telegram, enabled: false }),
		).toMatchObject({ enabled: false, destination: "https://t.me/alhaperek" });
	});

	it("accepts a disabled channel with an empty destination", () => {
		expect(
			validateJoinLinkChange({
				channel: "whatsapp",
				enabled: false,
				destination: "",
				expectedRevision: 0,
			}),
		).toMatchObject({ destination: null, expectedRevision: 0 });
	});

	it.each([
		null,
		undefined,
		"telegram",
		{},
		{ ...telegram, channel: "email" },
		{ ...telegram, enabled: "yes" },
		{ ...telegram, expectedRevision: "3" },
		{ ...telegram, expectedRevision: -1 },
		{ ...telegram, expectedRevision: 1.5 },
		{ ...telegram, enabled: true, destination: "" },
		{ ...telegram, enabled: true, destination: null },
	])("rejects an invalid payload %j", (value) => {
		expect(() => validateJoinLinkChange(value)).toThrow();
	});

	it("explains a whatsapp invitation format failure in Hebrew", () => {
		expect(() =>
			validateJoinLinkChange({
				channel: "whatsapp",
				enabled: true,
				destination: "https://t.me/alhaperek",
				expectedRevision: 1,
			}),
		).toThrow(/chat\.whatsapp\.com/);
	});

	it("explains a telegram channel format failure in Hebrew", () => {
		expect(() =>
			validateJoinLinkChange({
				...telegram,
				destination: "https://chat.whatsapp.com/AbCdEfGh1234567890",
			}),
		).toThrow(/t\.me/);
	});
});
