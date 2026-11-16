import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailJobSummary } from "~/lib/bulletin-email";
import type {
	EmailAdmissionStatus,
	EmailRolloutAction,
	EmailRolloutState,
	EmailRolloutSummary,
} from "~/lib/bulletin-rollout";
import { setDailyBulletinEmailRollout } from "~/server/bulletin-email";

const STATE_NAMES: Record<EmailRolloutState, string> = {
	disabled: "כבויה - אין צירופים ואין משלוחי מנויים מהרשימה המקורית",
	running: "פעילה - מתווסף לכל היותר מנוי אחד בכל יום",
	paused: "מושהית - אין צירופים חדשים; משלוחים למי שצורף נמשכים",
	completed: "הושלמה - כל המנויים הזכאים צורפו",
};
const ADMISSION_NAMES: Record<EmailAdmissionStatus, string> = {
	reserved: "בתהליך",
	admitted: "הושלם",
	exhausted: "אין מועמדים נוספים היום",
	lapsed: "המועמד ששוריין הפך ללא מתאים",
};
const EMAIL_STATUS_NAMES: Record<string, string> = {
	queued: "ממתין בתור",
	sending: "בשליחה",
	accepted: "התקבל ב-SES",
	delivered: "נמסר לשרת הדואר",
	failed: "נכשל",
	uncertain: "נדרשת בדיקה",
	suppressed: "השליחה נחסמה",
};

function actionLabel(action: EmailRolloutAction): string {
	switch (action) {
		case "enable":
			return "הפעלת ההדרגתיות";
		case "pause":
			return "השהיית צירופים";
		case "resume":
			return "חידוש צירופים";
		case "disable":
			return "ביטול מלא";
	}
}

function allowedActions(state: EmailRolloutState): EmailRolloutAction[] {
	switch (state) {
		case "disabled":
			return ["enable"];
		case "running":
			return ["pause", "disable"];
		case "paused":
			return ["resume", "disable"];
		case "completed":
			return ["disable"];
	}
}

/**
 * Original-cohort ramp panel (#3382). The rollout row is revision-checked on
 * every control, so two operators cannot race a transition. `date`/`job`
 * identify the limited-cohort send for the displayed bulletin day.
 */
export function BulletinEmailRollout({
	rollout,
	job,
	disabled = false,
}: {
	rollout: EmailRolloutSummary;
	job: EmailJobSummary | null;
	disabled?: boolean;
}) {
	const client = useQueryClient();
	const change = useMutation({
		mutationFn: (action: EmailRolloutAction) =>
			setDailyBulletinEmailRollout({
				data: { action, revision: rollout.revision },
			}),
		retry: false,
		onSettled: () => client.invalidateQueries({ queryKey: ["bulletin-email"] }),
	});
	const busy = disabled || change.isPending;
	return (
		<div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
			<h3 className="font-semibold">הפעלה הדרגתית - רשימת המנויים המקורית</h3>
			<p className="font-semibold">{STATE_NAMES[rollout.state]}</p>
			<p>
				צורפו: {rollout.admitted} | נותרו ברשימה המקורית: {rollout.remaining} |
				לא מתאימים: {rollout.excluded}
			</p>
			{rollout.admission && (
				<p className="text-sm text-gray-700">
					שמורת היום ({rollout.admission.localDate}):{" "}
					{ADMISSION_NAMES[rollout.admission.status] ??
						rollout.admission.status}
					{rollout.admission.lastError
						? ` - ${rollout.admission.lastError}`
						: ""}
				</p>
			)}
			{rollout.lastError && (
				<p className="text-sm text-red-800">
					שגיאה אחרונה: {rollout.lastError}
				</p>
			)}
			{job && (
				<p role="status" className="text-sm text-gray-700">
					משלוח מנויים הדרגתי להיום:{" "}
					{EMAIL_STATUS_NAMES[job.status] ?? job.status} (<bdi>{job.id}</bdi>)
				</p>
			)}
			<p className="text-sm text-gray-600">
				ההשהיה עוצרת צירופים חדשים בלבד; מי שכבר צורף ממשיך לקבל עלונים. הביטול
				המלא עוצר גם את המשלוח לקהל שהתווסף. היסטוריית ההסכמה והמשלוח נשמרת בכל
				פעולה.
			</p>
			<div className="flex flex-wrap gap-3">
				{allowedActions(rollout.state).map((action) => (
					<button
						key={action}
						type="button"
						disabled={busy}
						onClick={() => change.mutate(action)}
						className={
							action === "disable"
								? "rounded-lg border border-red-600 px-4 py-2 text-red-700 disabled:opacity-50"
								: "rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
						}
					>
						{change.isPending && change.variables === action
							? "מבצע..."
							: actionLabel(action)}
					</button>
				))}
			</div>
			{change.error && (
				<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
					{change.error.message}
				</p>
			)}
		</div>
	);
}
