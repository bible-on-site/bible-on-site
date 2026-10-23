export const SSM_DB_URL_PARAM = "bible-on-site-tanah-db-url";

// The populator Lambda reads its DB credentials from the DB_URL environment
// variable instead of calling SSM from inside the VPC. Injecting it at deploy
// time lets the SSM interface endpoint (hourly cost) be removed; the
// deployer's OIDC role already holds ssm:GetParameter on
// bible-on-site-tanah-db-*.
//
// Returns the merged environment to set via UpdateFunctionConfiguration, or
// undefined when DB_URL already matches — existing vars are preserved.
export function updatedLambdaEnv(
	existing: Record<string, string>,
	dbUrl: string,
): Record<string, string> | undefined {
	if (existing.DB_URL === dbUrl) return undefined;
	return { ...existing, DB_URL: dbUrl };
}

// The OIDC role gains lambda:GetFunction/UpdateFunctionConfiguration on the
// populator only after github-oidc.yaml is applied. Until then injection is
// best-effort: the deployed Lambda still reads credentials from SSM at
// runtime, so a denied call must not abort the deploy.
export function isAccessDenied(err: unknown): boolean {
	return (err as { name?: string } | null)?.name === "AccessDeniedException";
}
