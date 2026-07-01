import { defineConfig } from "vite";

export default defineConfig({
  base: "/bulbasaur_office/",
  server: { open: true },
  build: { target: "es2020" },
});
