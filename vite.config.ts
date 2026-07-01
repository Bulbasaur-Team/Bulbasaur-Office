import { defineConfig } from "vite";

export default defineConfig({
  base: "/Bulbasaur-Office/",
  server: { open: true },
  build: { target: "es2020" },
});
