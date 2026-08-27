import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github",
  base: "./",
  plugins: [react()],
  publicDir: "../public",
  build: { outDir: "../github-pages-dist", emptyOutDir: true },
});
