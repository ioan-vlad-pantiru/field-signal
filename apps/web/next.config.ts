import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (apps/web/Dockerfile).
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  cacheComponents: true,
  /**
   * Old routes from before the three-tab navigation. They run before the locale proxy and pass the
   * query string through, so `/feed?…`, `/stocks?path=B` and bookmarks keep working.
   * `/field`, `/simulator` and `/stocks/report` did not move.
   */
  async redirects() {
    const moved: [string, string][] = [
      ["/feed", "/buyers?view=region"],
      ["/stocks", "/buyers?view=stocks"],
      ["/account", "/more/account"],
      ["/about", "/more/about"],
      // The farm import is a path inside My fields now.
      ["/farm", "/field?import=1"],
    ];
    return [
      ...moved.flatMap(([from, to]) => [
        { source: `/:locale(en|ro)${from}`, destination: `/:locale${to}`, permanent: false },
        { source: from, destination: to, permanent: false },
      ]),
      // The pitch deck is a static page in public/pitch; its assets are relative to that folder.
      { source: "/:locale(en|ro)/pitch", destination: "/pitch/index.html", permanent: false },
      { source: "/pitch", destination: "/pitch/index.html", permanent: false },
      { source: "/pitch/", destination: "/pitch/index.html", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
