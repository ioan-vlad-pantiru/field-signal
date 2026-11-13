import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Field Signal",
    short_name: "Field Signal",
    description:
      "Ajutor pentru alegerea rotației culturilor, pe baza datelor din satelit. Crop-rotation help from satellite data.",
    id: "/",
    start_url: "/ro",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "ro",
    background_color: "#f2f4ee",
    theme_color: "#1f6b45",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
