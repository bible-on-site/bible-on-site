import { RedirectType, redirect } from "next/navigation";
import { getTodaysPerekId } from "../../data/perek-dto";

export default async function TodaysPerek({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const resolvedSearchParams = await searchParams;
	const perekId = getTodaysPerekId();
	const params = new URLSearchParams();

	for (const [key, value] of Object.entries(resolvedSearchParams)) {
		if (Array.isArray(value)) {
			for (const v of value) {
				params.append(key, v);
			}
		} else if (value !== undefined) {
			params.append(key, value);
		}
	}

	const paramsString = params.toString();
	redirect(
		`/929/${perekId}${paramsString.length > 0 ? `?${paramsString}` : ""}`,
		RedirectType.replace,
	);
}
