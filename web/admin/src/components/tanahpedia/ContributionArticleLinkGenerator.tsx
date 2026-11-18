import { useState } from "react";
import { contributionArticleId } from "~/lib/tanahpedia/contribution-article-links";

/** The deterministic engine opens the same ordinary PRs as a human or agent. */
export function ContributionArticleLinkGenerator({
	generate,
	openPr,
}: {
	generate: (articleId: string) => Promise<string[]>;
	openPr: (id: string) => Promise<unknown>;
}) {
	const [articleId, setArticleId] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	return (
		<details className="contribution-card contribution-card-body">
			<summary>איתור קישורים למאמר</summary>
			<form
				className="contribution-source-fields"
				aria-label="איתור קישורי מאמר"
				onSubmit={async (event) => {
					event.preventDefault();
					if (pending) return;
					setError("");
					setMessage("");
					setPending(true);
					try {
						const ids = await generate(contributionArticleId(articleId));
						if (ids.length) await openPr(ids[0]);
						else
							setMessage(
								"לא נמצאו קישורים חדשים שניתן להציע למאמר זה. אפשר לפתוח פנייה ולשייך אותה לסוכן מקומי להמשך חקירה.",
							);
					} catch (failure) {
						setError(
							failure instanceof Error
								? failure.message
								: "איתור הקישורים נכשל",
						);
					} finally {
						setPending(false);
					}
				}}
			>
				<p>
					איתור לפי הפניות וציטוטים במאמר פותח PR רגיל עם מקורות והשוואת
					שינויים, וממתין לסקירה.
				</p>
				<label>
					מספר מאמר לאיתור
					<input
						className="contribution-input"
						aria-label="מספר מאמר לאיתור"
						inputMode="numeric"
						required
						disabled={pending}
						value={articleId}
						onChange={(event) => setArticleId(event.target.value)}
					/>
				</label>
				<button
					type="submit"
					className="contribution-button"
					disabled={pending || !articleId}
				>
					{pending ? "מאתר קישורים..." : "איתור ופתיחת PR"}
				</button>
				{error && <p role="alert">{error}</p>}
				{message && <p role="status">{message}</p>}
			</form>
		</details>
	);
}
