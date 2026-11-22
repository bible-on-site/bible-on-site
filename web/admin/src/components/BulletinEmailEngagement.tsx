import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { EmailEditionStats } from "~/lib/bulletin-email";
import {
	confirmDailyBulletinInactivityUnsubscribe,
	getDailyBulletinEmailEngagement,
} from "~/server/bulletin-email";

function rate(part: number, whole: number): string {
	if (!whole) return "-";
	return `${Math.round((part / whole) * 100)}%`;
}

function EditionRow({ edition }: { edition: EmailEditionStats }) {
	return (
		<tr className="border-t border-gray-200">
			<td className="px-3 py-2">{edition.date}</td>
			<td className="px-3 py-2">{edition.delivered}</td>
			{edition.tracked ? (
				<>
					<td className="px-3 py-2">
						{edition.opened} ({rate(edition.opened, edition.delivered)})
					</td>
					<td className="px-3 py-2">
						{edition.clicked} ({rate(edition.clicked, edition.delivered)})
					</td>
				</>
			) : (
				<td className="px-3 py-2 text-gray-500" colSpan={2}>
					לפני הפעלת המדידה - אין נתוני פתיחות וקליקים
				</td>
			)}
		</tr>
	);
}

/**
 * Tracked open/click engagement and the one-year inactivity review (#3707).
 *
 * Statistics count each delivered recipient once per edition and use confirmed
 * deliveries as the denominator; test sends never appear here. Editions sent
 * before tracking was enabled are labeled "untracked" instead of a false zero.
 * The review list holds confirmed subscribers with a full year of reliable
 * tracked delivery and no recorded open or content click during it; an admin
 * confirms each removal, and eligibility is rechecked at confirmation.
 */
export function BulletinEmailEngagement({
	disabled = false,
}: {
	disabled?: boolean;
}) {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState<number | null>(null);
	const engagement = useQuery({
		queryKey: ["bulletin-email-engagement"],
		queryFn: () => getDailyBulletinEmailEngagement(),
		retry: false,
	});
	const unsubscribe = useMutation({
		mutationFn: (subscriberId: number) =>
			confirmDailyBulletinInactivityUnsubscribe({ data: { subscriberId } }),
		retry: false,
		onSettled: () => {
			// Refetch even on failure: a rejected mirror leaves the local opt-out
			// on the pending-sync list, which the panel must show immediately.
			setConfirming(null);
			return queryClient.invalidateQueries({
				queryKey: ["bulletin-email-engagement"],
			});
		},
	});
	const busy = disabled || unsubscribe.isPending;
	const data = engagement.data;
	return (
		<div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
			<h3 className="font-semibold">סטטיסטיקת פתיחות וקליקים - דוא"ל יומי</h3>
			{engagement.isLoading && <p role="status">טוען נתוני מדידה...</p>}
			{engagement.error && (
				<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
					{engagement.error.message}
				</p>
			)}
			{data === null && (
				<p className="text-sm text-gray-600">
					מדידת פתיחות וקליקים טרם הופעלה בסביבה זו.
				</p>
			)}
			{data && (
				<>
					{data.editions.length === 0 ? (
						<p className="text-sm text-gray-600">אין עדיין משלוחי מנויים.</p>
					) : (
						<table className="w-full border-collapse bg-white text-sm">
							<thead>
								<tr className="text-gray-600">
									<th className="px-3 py-2 text-right font-semibold">עלון</th>
									<th className="px-3 py-2 text-right font-semibold">נמסרו</th>
									<th className="px-3 py-2 text-right font-semibold">
										נפתחו (מדוד)
									</th>
									<th className="px-3 py-2 text-right font-semibold">
										קליקים (מדוד)
									</th>
								</tr>
							</thead>
							<tbody>
								{data.editions.map((edition) => (
									<EditionRow key={edition.jobId} edition={edition} />
								))}
							</tbody>
						</table>
					)}
					<p className="text-sm text-gray-600">
						המדידה מתבססת על אירועי המעקב של SES: פתיחה נרשמת כשנטען פיקסל
						המעקב, וקליק נרשם רק בקישורי התוכן - קישורי ההסרה וניהול המנוי אינם
						נספרים. חסימת תמונות מדווחת פתיחה נמוכה מהאמת; שירותי פרטיות (כגון
						Apple Mail Privacy Protection) וסורקי קישורים של שירותי דואר עשויים
						לדווח פתיחות וקליקים גם בלי פעולה אמיתית של הקורא. יש להתייחס
						למספרים כאומדן פעילות מדודה ולא כראיה מלאה לקריאה.
					</p>
					<section className="space-y-2">
						<h4 className="font-semibold">
							סקירת חוסר פעילות - מנויים ללא פתיחה מדודה בשנה האחרונה
						</h4>
						<p className="text-sm text-gray-600">
							ברשימה מופיעים רק מנויים פעילים עם היסטוריית מסירה מדודה מלאה של
							שנה לפחות וללא פתיחה או קליק מדודים בשנה החולפת. מנוי שסריקת
							הקישורים או פיקסל הפתיחה שלו הופעלו בשנה זו אינו מופיע. אישור
							ההסרה בודק שוב את הזכאות ושומר את פעולת המנהל.
						</p>
						{data.inactive.length === 0 ? (
							<p className="text-sm text-gray-600">
								אין מנויים העומדים כרגע בתנאי ההסרה.
							</p>
						) : (
							<ul className="space-y-2">
								{data.inactive.map((subscriber) => (
									<li
										key={subscriber.id}
										className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3"
									>
										<bdi className="font-mono text-sm">{subscriber.email}</bdi>
										<span className="text-sm text-gray-600">
											מסירה מדודה ראשונה: {subscriber.firstTrackedDelivery} |
											משלוחים מדודים בשנה האחרונה: {subscriber.trackedLastYear}
										</span>
										{confirming === subscriber.id ? (
											<span className="flex items-center gap-2">
												<button
													type="button"
													disabled={busy}
													onClick={() => unsubscribe.mutate(subscriber.id)}
													className="rounded-lg bg-red-600 px-3 py-1 text-white disabled:opacity-50"
												>
													{unsubscribe.isPending
														? "מסיר..."
														: "אישור הסרה מהדיוור"}
												</button>
												<button
													type="button"
													disabled={unsubscribe.isPending}
													onClick={() => setConfirming(null)}
													className="rounded-lg border border-gray-400 px-3 py-1 disabled:opacity-50"
												>
													ביטול
												</button>
											</span>
										) : (
											<button
												type="button"
												disabled={busy}
												onClick={() => setConfirming(subscriber.id)}
												className="rounded-lg border border-red-600 px-3 py-1 text-red-700 disabled:opacity-50"
											>
												הסרה מהדיוור
											</button>
										)}
									</li>
								))}
							</ul>
						)}
						{unsubscribe.error && (
							<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
								{unsubscribe.error.message}
							</p>
						)}
					</section>
					{data.pendingMirror.length > 0 && (
						<section className="space-y-2">
							<h4 className="font-semibold">הסרות הממתינות לסנכרון אל SES</h4>
							<p className="text-sm text-gray-600">
								המנויים הבאים הוסרו מקומית מהדיוור, אך סנכרון ההסרה אל SES טרם
								הושלם. ההסרה המקומית תקפה; ניתן לנסות את הסנכרון שוב.
							</p>
							<ul className="space-y-2">
								{data.pendingMirror.map((subscriber) => (
									<li
										key={subscriber.id}
										className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3"
									>
										<bdi className="font-mono text-sm">{subscriber.email}</bdi>
										<button
											type="button"
											disabled={busy}
											onClick={() => unsubscribe.mutate(subscriber.id)}
											className="rounded-lg border border-blue-600 px-3 py-1 text-blue-700 disabled:opacity-50"
										>
											{unsubscribe.isPending
												? "מסנכרן..."
												: "ניסיון סנכרון חוזר"}
										</button>
									</li>
								))}
							</ul>
						</section>
					)}
				</>
			)}
		</div>
	);
}
