"use client";

import { useState } from "react";
import { CONSENT_TEXT, type SignupSource } from "@/lib/bulletin-signup/shared";
import styles from "./EmailSignupForm.module.css";

interface EmailSignupFormProps {
	/** Where the consent came from; recorded with the intent. */
	source: SignupSource;
}

type FormState = "idle" | "pending" | "sent" | "error";

/**
 * Public daily-bulletin email signup (#2940). Submits the address and the
 * explicit consent to `/api/bulletin/subscribe` — a direct subscription, no
 * confirmation mail — and reports only the generic outcome: the API
 * deliberately never reveals whether the address was already subscribed or
 * throttled.
 */
export function EmailSignupForm({ source }: EmailSignupFormProps) {
	const [state, setState] = useState<FormState>("idle");
	const [email, setEmail] = useState("");
	const [consent, setConsent] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (state === "pending") return;
		setState("pending");
		try {
			const response = await fetch("/api/bulletin/subscribe", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, consent, source }),
			});
			setState(response.ok ? "sent" : "error");
		} catch {
			setState("error");
		}
	}

	if (state === "sent") {
		return (
			<p className={styles.status} role="status">
				ההרשמה התקבלה. העלון היומי יישלח אליכם כל בוקר, ואפשר להסיר את ההרשמה
				בכל עת.
			</p>
		);
	}

	return (
		<form className={styles.form} onSubmit={onSubmit}>
			<label className={styles.emailLabel} htmlFor={`bulletin-email-${source}`}>
				כתובת דוא&quot;ל
			</label>
			<input
				id={`bulletin-email-${source}`}
				className={styles.emailInput}
				type="email"
				name="email"
				dir="ltr"
				required
				maxLength={254}
				autoComplete="email"
				value={email}
				onChange={(event) => setEmail(event.target.value)}
				disabled={state === "pending"}
			/>
			<label className={styles.consentLabel}>
				<input
					type="checkbox"
					name="consent"
					required
					checked={consent}
					onChange={(event) => setConsent(event.target.checked)}
					disabled={state === "pending"}
				/>
				<span>{CONSENT_TEXT}</span>
			</label>
			<button
				className={styles.submit}
				type="submit"
				disabled={state === "pending"}
			>
				{state === "pending" ? "שולח…" : "הרשמה"}
			</button>
			{state === "error" && (
				<p className={styles.error} role="alert">
					לא ניתן להשלים את ההרשמה כרגע. נסו שוב מאוחר יותר.
				</p>
			)}
		</form>
	);
}
