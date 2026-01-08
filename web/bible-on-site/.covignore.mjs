export const covIgnoreList = [
	"**/api/dev/**",
	"tsconfig.json",
	"**/node_modules/**",
	"**/src/app/layout.tsx",
	"__nextjs-internal-proxy.mjs",
	"app/geistmono*.js",
	"app/geistsans*.js",
	"src/app/*--route-entry.js", // Next.js generated route entry files
	"**/*.css",
	"**/*.woff",
	"**/*.ico",
];

// Build the filter object for monocart from covIgnoreList
// Each pattern in covIgnoreList should be excluded (false)
export const monocartAllFilter = Object.fromEntries([
	...covIgnoreList.map((pattern) => [pattern, false]),
	["**/*", true], // Include everything else
]);
