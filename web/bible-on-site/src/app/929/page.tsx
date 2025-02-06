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

	Object.entries(resolvedSearchParams).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((v) => {
				params.append(key, v);
			});
		} else if (value !== undefined) {
			params.append(key, value);
		}
	});

	const paramsString = params.toString();
	redirect(
		`/929/${perekId}${paramsString.length > 0 ? `?${paramsString}` : ""}`,
		RedirectType.replace,
	);
}
