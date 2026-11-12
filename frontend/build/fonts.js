import { readFileSync } from "node:fs";

export const FONT_NAMES = [
  "vazirmatn-1.woff2",
  "vazirmatn-2.woff2",
  "vazirmatn-3.woff2",
];
const fontRoot = new URL("../public/fonts/", import.meta.url);

// The repository owns one copy of the fonts; dev and production expose the same URLs.
export function repositoryFonts() {
  return {
    name: "repository-fonts",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, "http://vite.local").pathname;
        const name = pathname.startsWith("/fonts/") ? pathname.slice(7) : "";
        if (
          !FONT_NAMES.includes(name) ||
          !["GET", "HEAD"].includes(request.method)
        )
          return next();
        response.setHeader("Content-Type", "font/woff2");
        response.setHeader("Cache-Control", "no-cache");
        response.end(
          request.method === "HEAD"
            ? undefined
            : readFileSync(new URL(name, fontRoot)),
        );
      });
    },
    generateBundle() {
      for (const name of FONT_NAMES) {
        this.emitFile({
          type: "asset",
          fileName: `fonts/${name}`,
          source: readFileSync(new URL(name, fontRoot)),
        });
      }
    },
  };
}
