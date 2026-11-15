import { defineRouting } from "next-intl/routing";

/**
 * English by default. Locale detection stays on: a phone set to Romanian lands on /ro (then the
 * NEXT_LOCALE cookie remembers a choice made with the language switch).
 */
export const routing = defineRouting({
  locales: ["en", "ro"],
  defaultLocale: "en",
});
