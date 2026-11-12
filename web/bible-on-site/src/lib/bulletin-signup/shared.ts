/**
 * Client-safe constants for the public daily-bulletin email signup (#2940).
 * Server logic lives in `./service` (server-only); display copy and the
 * recorded consent contract are shared so the rendered consent text is
 * exactly the text persisted with the intent.
 */
export const SIGNUP_SOURCES = ["card", "page", "app"] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export function isSignupSource(value: unknown): value is SignupSource {
	return (
		typeof value === "string" &&
		(SIGNUP_SOURCES as readonly string[]).includes(value)
	);
}

/** The exact consent wording recorded with every signup intent. */
export const CONSENT_TEXT =
	'אני מאשר/ת לתנ"ך על הפרק לשלוח אליי את העלון היומי בדוא"ל, ואני יודע/ת שאפשר להסיר את ההרשמה בכל עת.';
export const CONSENT_VERSION = "2026-11";
