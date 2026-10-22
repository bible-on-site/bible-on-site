/**
 * Public URL for an object in the shared assets bucket (recordings,
 * illustrations, author portraits, media pages).
 *
 * Resolution order:
 * 1. ASSETS_BASE_URL — CDN distribution domain in production
 *    (https://assets.xn--febl3a.co.il, see docs/aws/cloudformation/cloudfront-assets.yaml)
 * 2. S3_ENDPOINT — local RustFS/MinIO, path-style
 * 3. The bucket's virtual-hosted S3 URL
 */
export function assetsUrl(key: string): string {
	const cdn = process.env.ASSETS_BASE_URL;
	if (cdn) return `${cdn.replace(/\/+$/, "")}/${key}`;
	const bucket = process.env.S3_BUCKET || "bible-on-site-assets";
	const endpoint = process.env.S3_ENDPOINT;
	if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
	const region =
		process.env.S3_REGION || process.env.AWS_REGION || "il-central-1";
	return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
