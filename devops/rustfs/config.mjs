export function publicReadPolicy(bucket) {
	return JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: "*",
				Action: "s3:GetObject",
				Resource: `arn:aws:s3:::${bucket}/*`,
			},
		],
	});
}

export const localCorsConfiguration = {
	CORSRules: [
		// Public audio must be fetchable for sample-accurate Web Audio playback.
		{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["Content-Range", "Accept-Ranges"], MaxAgeSeconds: 3600 },
		{
			AllowedOrigins: ["http://localhost:3101", "http://127.0.0.1:3101"],
			AllowedMethods: ["GET", "HEAD", "PUT"],
			AllowedHeaders: ["*"],
			ExposeHeaders: ["ETag"],
			MaxAgeSeconds: 3600,
		},
	],
};
