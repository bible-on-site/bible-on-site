/// <reference types="vite/client" />

declare global {
	interface ImportMetaEnv {
		readonly VITE_API_URL: string;
		readonly VITE_AWS_REGION: string;
		readonly VITE_S3_BUCKET: string;
		readonly VITE_WEBSITE_URL: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}
}

export {};
