import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
	JoinChannel,
	JoinLinkChange,
	JoinLinkState,
} from "~/lib/bulletin-join";
import { WEBSITE_BASE } from "~/lib/website-base";
import {
	getBulletinJoinLinks,
	updateBulletinJoinLink,
} from "~/server/bulletin-join";

const CHANNEL_TITLES: Record<JoinChannel, string> = {
	telegram: "טלגרם",
	whatsapp: "ווטסאפ",
};

const PLACEHOLDERS: Record<JoinChannel, string> = {
	telegram: "https://t.me/alhaperek",
	whatsapp: "https://chat.whatsapp.com/…",
};

function formatTime(value: string | null): string {
	return value
		? new Date(value).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })
		: "";
}

function JoinLinkCard({
	link,
	busy,
	onSave,
}: {
	link: JoinLinkState;
	busy: boolean;
	onSave: (change: Omit<JoinLinkChange, "channel">) => void;
}) {
	const [enabled, setEnabled] = useState(link.enabled);
	const [destination, setDestination] = useState(link.destination ?? "");
	const dirty =
		enabled !== link.enabled || destination.trim() !== (link.destination ?? "");
	const stableUrl = `${WEBSITE_BASE}/dailyBulletin/join/${link.channel}`;
	return (
		<fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
			<legend className="px-2 font-semibold">
				{CHANNEL_TITLES[link.channel]}
			</legend>
			<p className="text-sm text-gray-600">
				כתובת קבועה:{" "}
				<a
					href={stableUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-700 underline"
					dir="ltr"
				>
					{stableUrl}
				</a>
			</p>
			<label className="flex items-center gap-2 font-semibold">
				<input
					type="checkbox"
					checked={enabled}
					disabled={busy}
					onChange={(event) => setEnabled(event.target.checked)}
				/>
				הפניה פעילה
			</label>
			<label
				className="flex flex-col gap-2 font-semibold"
				htmlFor={`join-destination-${link.channel}`}
			>
				יעד ההפניה
				<input
					id={`join-destination-${link.channel}`}
					type="url"
					dir="ltr"
					value={destination}
					disabled={busy}
					placeholder={PLACEHOLDERS[link.channel]}
					onChange={(event) => setDestination(event.target.value)}
					className="rounded-lg border border-gray-300 px-4 py-2 font-normal"
				/>
			</label>
			<button
				type="button"
				disabled={busy || !dirty || (enabled && !destination.trim())}
				onClick={() =>
					onSave({
						enabled,
						destination: destination.trim() || null,
						expectedRevision: link.revision,
					})
				}
				className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
			>
				שמירה
			</button>
			{link.updatedAt && (
				<p className="text-xs text-gray-500">
					עודכן לאחרונה על ידי {link.updatedBy} ב-
					{formatTime(link.updatedAt)}
				</p>
			)}
		</fieldset>
	);
}

/**
 * Admin screen for the public `/dailyBulletin/join/{channel}` destinations (#2939).
 * Lives on the daily-bulletin page and is always visible — managing join
 * links does not depend on preparing a bulletin.
 */
export function BulletinJoinLinks() {
	const queryClient = useQueryClient();
	const linksQuery = useQuery({
		queryKey: ["bulletin-join-links"],
		queryFn: () => getBulletinJoinLinks(),
	});
	const update = useMutation({
		mutationFn: (data: JoinLinkChange) => updateBulletinJoinLink({ data }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["bulletin-join-links"] }),
	});
	const links = linksQuery.data?.links ?? [];
	const audit = linksQuery.data?.audit ?? [];
	return (
		<section
			aria-labelledby="join-links-title"
			className="space-y-4 rounded-xl border border-gray-200 bg-white p-6"
		>
			<h2 id="join-links-title" className="text-xl font-semibold">
				קישורי הצטרפות לעלון
			</h2>
			<p className="text-sm text-gray-600">
				הכתובות הקבועות באתר מפנות ליעדים הנשמרים כאן. שינוי נכנס לתוקף מיד
				ומתועד ביומן השינויים.
			</p>
			{linksQuery.isLoading && <p role="status">טוען קישורי הצטרפות...</p>}
			{(linksQuery.error || update.error) && (
				<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
					{(update.error || linksQuery.error)?.message}
				</p>
			)}
			{links.map((link) => (
				<JoinLinkCard
					key={`${link.channel}:${link.revision}`}
					link={link}
					busy={update.isPending}
					onSave={(change) =>
						update.mutate({ ...change, channel: link.channel })
					}
				/>
			))}
			{audit.length > 0 && (
				<div>
					<h3 className="font-semibold">יומן שינויים אחרונים</h3>
					<ul className="mt-2 space-y-1 text-sm text-gray-700">
						{audit.map((entry) => (
							<li key={entry.id}>
								{formatTime(entry.changedAt)} | {CHANNEL_TITLES[entry.channel]}
								{entry.enabled ? " | פעיל" : " | כבוי"}
								{entry.destination && (
									<>
										{" "}
										| <bdi dir="ltr">{entry.destination}</bdi>
									</>
								)}
								{entry.changedBy && <> | {entry.changedBy}</>}
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
