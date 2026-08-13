import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || "https://Tua7ce.github.io",
  base: process.env.BASE_PATH || "/",
  trailingSlash: "never"
});
