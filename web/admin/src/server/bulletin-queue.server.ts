import "@tanstack/react-start/server-only";
import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";

export function loadBulletinQueue(configError: string): {
	queueUrl: string;
	region: string;
} {
	const region =
		process.env.BULLETIN_SES_REGION || process.env.AWS_REGION || "il-central-1";
	const account = process.env.BULLETIN_SES_ACCOUNT_ID;
	const queueUrl = process.env.BULLETIN_EMAIL_QUEUE_URL?.trim();
	if (!account || !/^[0-9]{12}$/.test(account) || !queueUrl)
		throw new Error(configError);
	let url: URL;
	try {
		url = new URL(queueUrl);
	} catch {
		throw new Error(configError);
	}
	const queuePath = url.pathname.split("/");
	if (
		url.protocol !== "https:" ||
		url.hostname !== `sqs.${region}.amazonaws.com` ||
		url.port ||
		url.search ||
		url.hash ||
		url.username ||
		url.password ||
		queuePath.length !== 3 ||
		queuePath[1] !== account ||
		!/^[A-Za-z0-9_-]+$/.test(queuePath[2] ?? "")
	)
		throw new Error(configError);
	return { queueUrl, region };
}

export async function publishJobs(
	client: SQSClient,
	queueUrl: string,
	kind: string,
	jobs: { id: string }[],
	signal: AbortSignal | undefined,
	failMessage: string,
): Promise<void> {
	const abortSignal = signal ?? AbortSignal.timeout(15_000);
	try {
		for (let offset = 0; offset < jobs.length; offset += 10) {
			abortSignal.throwIfAborted();
			const entries = jobs.slice(offset, offset + 10).map(({ id }) => ({
				Id: id,
				MessageBody: JSON.stringify({ kind, jobId: id }),
			}));
			const result = await client.send(
				new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }),
				{ abortSignal },
			);
			abortSignal.throwIfAborted();
			const accepted = new Set(result.Successful?.map((entry) => entry.Id));
			if (result.Failed?.length || entries.some(({ Id }) => !accepted.has(Id)))
				throw new Error(failMessage);
		}
	} catch {
		throw new Error(failMessage);
	}
}
