// Payload contract shared with the populator Lambda:
// docs/aws/cloudformation/data-deploy/data-deploy-lambda.py reads
// event["db_url"] — renaming this field breaks production deploys.
// The URL is a secret; never log the returned object.
export function buildDeployPayload(
	sqlFiles: string[],
	s3Prefix: string,
	dbUrl: string,
): { sql_files: string[]; s3_prefix: string; db_url: string } {
	return { sql_files: sqlFiles, s3_prefix: s3Prefix, db_url: dbUrl };
}
