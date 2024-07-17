import { getTodaysPerekId } from "@/data/perek-dto";
import { RedirectType, redirect } from "next/navigation";

export default function TodaysPerek({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const perekId = getTodaysPerekId();
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
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
