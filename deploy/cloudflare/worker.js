// Field Signal front door: serves fieldsignal.ioan-vlad-pantiru.com from the two Azure Container
// Apps. /api/* goes to the API (prefix stripped), everything else to the web app, so the browser
// talks to a single origin.
const WEB = "https://field-signal.proudocean-c71411f0.germanywestcentral.azurecontainerapps.io";
const API = "https://field-signal-api.proudocean-c71411f0.germanywestcentral.azurecontainerapps.io";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const origin = isApi ? API : WEB;
    const path = isApi ? url.pathname.slice(4) || "/" : url.pathname;

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", "https");
    const upstream = await fetch(origin + path + url.search, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    // Keep redirects (e.g. / → /ro) on the public domain.
    const location = upstream.headers.get("Location");
    if (!location) return upstream;
    const response = new Response(upstream.body, upstream);
    const target = new URL(location, origin);
    if (target.origin === WEB || target.origin === API) {
      response.headers.set("Location", (isApi ? "/api" : "") + target.pathname + target.search);
    }
    return response;
  },
};
