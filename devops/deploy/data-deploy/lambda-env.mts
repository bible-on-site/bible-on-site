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
