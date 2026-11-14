import { setTimeout } from "node:timers/promises";

const RESTORATION_RETRIES = 30;
const RESTORATION_RETRY_DELAY_MS = 10_000;

// An inactive VPC Lambda rejects the invocation before executing any SQL and
// starts restoring its resources. Retry only that explicit rejection: a generic
// service/transport error could follow an execution and must not replay writes.
export async function invokeWithRestorationRetry<T>(
	invoke: () => Promise<T>,
	info: (message: string) => void,
	pause: (delayMs: number) => Promise<unknown> = setTimeout,
): Promise<T> {
	for (let retry = 0; ; retry++) {
		try {
			return await invoke();
		} catch (error) {
			if (
				(error as { name?: string } | null)?.name !==
					"ResourceNotReadyException" ||
				retry === RESTORATION_RETRIES
			) {
				throw error;
			}

			info(
				`Lambda is restoring its resources; retry ${retry + 1}/${RESTORATION_RETRIES} in 10 seconds.`,
			);
			await pause(RESTORATION_RETRY_DELAY_MS);
		}
	}
}
