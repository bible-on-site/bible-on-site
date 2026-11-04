"use client";

import { useState } from "react";
import type { ConfirmOutcome } from "@/lib/bulletin-signup/shared";
import styles from "../page.module.css";

interface ConfirmEmailFormProps {
	token: string;
}

type FormState = "idle" | "pending" | ConfirmOutcome | "error";

/**
 * Explicit confirmation for the emailed challenge (#2940).
 *
 * The mailed link lands on the confirm page as a GET (scanner-safe — GET only
 * renders this form) and the actual consume is a POST to
 * `/api/bulletin/confirm`, here via fetch or a no-JS form post. The hidden
 * input keeps the native POST working end to end without JavaScript.
 */
export function ConfirmEmailForm({ token }: ConfirmEmailFormProps) {
	const [state, setState] = useState<FormState>("idle");

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (state === "pending") return;
		setState("pending");
		try {
			const response = await fetch("/api/bulletin/confirm", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token }),
			});
			const body = (await response.json()) as { status?: ConfirmOutcome };
			setState(
				body.status === "confirmed" ||
					body.status === "expired" ||
					body.status === "invalid"
					? body.status
					: "error",
			);
		} catch {
			setState("error");
		}
	}

	if (state === "confirmed") {
		return (
			<p className={styles.statusOk} role="status">
				ההרשמה אושרה בהצלחה! העלון היומי יגיע אליכם בדוא&quot;ל. אפשר להסיר את
				ההרשמה בכל עת דרך הקישור בתחתית כל עלון.
			</p>
		);
	}
	if (state === "expired") {
		return (
			<p className={styles.statusWarn} role="status">
				תוקף קישור האימות פג. בקשו מייל אימות חדש דרך{" "}
				<a href="/join/email">עמוד ההרשמה</a>.
			</p>
		);
	}
	if (state === "invalid") {
		return (
			<p className={styles.statusWarn} role="status">
				קישור האימות אינו תקף. נסו להירשם מחדש דרך{" "}
				<a href="/join/email">עמוד ההרשמה</a>.
			</p>
		);
	}

	return (
		<form method="post" action="/api/bulletin/confirm" onSubmit={onSubmit}>
			<input type="hidden" name="token" value={token} />
			<p className={styles.confirmText}>
				לחצו על הכפתור כדי לאשר את ההרשמה לעלון היומי בדוא&quot;ל.
			</p>
			<button
				className={styles.submit}
				type="submit"
				disabled={state === "pending"}
			>
				{state === "pending" ? "מאשר…" : "אישור ההרשמה"}
			</button>
			{state === "error" && (
				<p className={styles.statusWarn} role="alert">
					לא ניתן לאשר כרגע. נסו שוב מאוחר יותר.
				</p>
			)}
		</form>
	);
}
