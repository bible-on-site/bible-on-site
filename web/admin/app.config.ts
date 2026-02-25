import { defineConfig } from "@tanstack/react-start/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	vite: {
		plugins: [tsConfigPaths()],
	},
	server: {
		preset: "node-server",
	},
});
