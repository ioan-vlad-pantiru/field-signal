#!/usr/bin/env node
/**
 * Checks messages/en.json and messages/ro.json against each other and against the code in src/:
 *   1. both files have exactly the same key paths;
 *   2. every key keeps the same ICU placeholders (and rich-text tags) in both languages;
 *   3. every key in en.json is referenced from src/ (literally, or under an allowlisted dynamic prefix);
 *   4. every literal key the code asks for exists, and every dynamic call is covered by the allowlist.
 *
 * References are found per file: `const t = useTranslations("Ns.sub")` (or `getTranslations`),
 * a parameter typed `ReturnType<typeof useTranslations<"Ns">>`, then `t("a.b")`, `t.rich("a")`,
 * `t.has("a")`, `t.markup("a")`, `t.raw("a")`. A call binds to the nearest declaration of that name
 * above it in the same file.
 *
 * Dynamic keys are listed in DYNAMIC below.
 *
 * Run: `node scripts/check-messages.mjs` (exits 1 on any problem). `pnpm test` runs it too.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Keys the code builds at run time. Every dynamic call in src/ (a template literal or a variable as
 * the key) must start with one of these prefixes. With `keys`, only those keys under the prefix count
 * as used (and must exist); without it, every key under the prefix does.
 */
export const DYNAMIC = [
  // Crop names from crop ids: tc(crop), tCrops(c) on results, simulator, farm, buyers, landing.
  { prefix: "Crops." },
  { prefix: "CropsShort." },
  // Labels for API enums: season status, risk level, confidence level, indicator unit (use-unit-label.ts).
  { prefix: "Status." },
  { prefix: "Risk." },
  { prefix: "Confidence." },
  { prefix: "Units." },
  // useErrorText() maps AccountError.code (account/shared.tsx).
  { prefix: "Account.errors." },
  // AssistantError.code and the tool names the assistant reports (assistant/assistant.tsx).
  { prefix: "Assistant.errors.", keys: ["off", "failed", "offline"] },
  { prefix: "Assistant.tools." },
  // NAV_ITEMS keys (layout/nav.tsx).
  { prefix: "Nav.", keys: ["fields", "buyers", "more"] },
  // VIEWS (buyers/buyers-view.tsx).
  { prefix: "Buyers.", keys: ["region", "stocks"] },
  // Commune table sort columns, risk counts and summaries (feed/commune-table.tsx, feed/crop-filter.tsx).
  { prefix: "Feed.table.", keys: ["name", "area", "risk", "quality", "confidence"] },
  { prefix: "Feed.counts." },
  { prefix: "Feed.summary." },
  // Priorities and levels (farmer/steps/priorities-step.tsx).
  { prefix: "Field.setup.priority." },
  { prefix: "Field.setup.level." },
  // Results: verdict kinds (verdict.tsx), soil rows (evidence.tsx), shift direction (shift.tsx),
  // score breakdown (strategy-sheet.tsx, optimizer-plan.tsx), explanation source (strategy-sheet.tsx),
  // non-farmland reasons on the hero's example plan (home/hero-scene.tsx, lib/land-cover.ts).
  { prefix: "Results.verdict.", keys: ["fewer", "more"] },
  { prefix: "Results.soil.", keys: ["carbon.label", "carbon.help", "ph.label", "ph.help", "texture.label", "texture.help"] },
  { prefix: "Results.shift.", keys: ["up", "down", "steady"] },
  { prefix: "Results.rotations.breakdown." },
  { prefix: "Results.explain.generatedBy." },
  { prefix: "Results.plan.reason." },
  // Optimizer rule ids and statuses (optimizer-plan.tsx, RuleChecks).
  {
    prefix: "Optimizer.rules.",
    keys: ["max_crop_share", "max_two_crops_share", "legume_share", "crop_change", "within", "outside", "belowThreshold", "metByRotation", "onlyWithEcoScheme"],
  },
  // Stock cover status and supplier score names (stocks/inventory-table.tsx, stocks/candidate-card.tsx).
  { prefix: "Stocks.status." },
  { prefix: "Stocks.scores." },
  // Fixed lists rendered in loops: About sources and limits, Glossary ids, landing steps and doors,
  // simulator phases, shapes, cameras and legend items.
  { prefix: "About.sources." },
  { prefix: "About.limits." },
  { prefix: "Glossary." },
  { prefix: "Home.steps." },
  { prefix: "Home.doors." },
  { prefix: "Simulator.phase." },
  { prefix: "Simulator.shape." },
  { prefix: "Simulator.camera." },
  { prefix: "Simulator.legend." },
];

/** Keys reached through a translator passed as a plain function, which the scan cannot follow. */
export const INDIRECT = {
  "Optimizer.modelName": "modelLabel(version, t) in farmer/results/optimizer-plan.tsx, with the Optimizer translator",
};

/**
 * Namespaces left out of the unused-key and missing-key checks.
 * TODO(redesign): the farm import is being rewritten in another branch; check these again after it lands.
 */
export const SKIP_NAMESPACES = ["Farm", "FarmPlan"];

// ------------------------------------------------------------------------------------------- helpers

function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

/** Argument names and rich-text tag names in an ICU message, e.g. {count}, {name}, <b>. */
export function placeholders(message) {
  const names = new Set();
  let i = 0;
  function text(stopAtClose) {
    while (i < message.length) {
      const c = message[i];
      if (c === "'" && (message[i + 1] === "{" || message[i + 1] === "}" || message[i + 1] === "'")) {
        // Quoted literal: skip to the closing quote.
        const end = message.indexOf("'", i + 1);
        i = end === -1 ? message.length : end + 1;
      } else if (c === "{") {
        i++;
        argument();
      } else if (c === "}") {
        if (stopAtClose) return;
        i++;
      } else if (c === "<") {
        const m = /^<\/?([A-Za-z][\w-]*)\s*\/?>/.exec(message.slice(i));
        if (m) {
          names.add(`<${m[1]}>`);
          i += m[0].length;
        } else i++;
      } else i++;
    }
  }
  function readUntil(chars) {
    const start = i;
    while (i < message.length && !chars.includes(message[i])) i++;
    return message.slice(start, i).trim();
  }
  function skipBlock() {
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
  }
  function argument() {
    const name = readUntil(",}");
    if (name) names.add(name);
    if (message[i] === "}") {
      i++;
      return;
    }
    i++; // ,
    const type = readUntil(",}");
    if (!["plural", "select", "selectordinal"].includes(type)) {
      skipBlock();
      return;
    }
    if (message[i] === ",") i++;
    // Branches: selector { message } ... }
    while (i < message.length) {
      readUntil("{}");
      if (message[i] === "}") {
        i++;
        return;
      }
      i++; // {
      text(true);
      i++; // }
    }
  }
  text(false);
  return names;
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const DECLARATION =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*(?:"([^"]*)"|\{[^}]*namespace:\s*"([^"]*)"[^}]*\})?\s*\)/g;
const TYPED_PARAM = /(\w+)\??\s*:\s*(?:Awaited<)?ReturnType<typeof (?:use|get)Translations<"([^"]*)">>/g;
// A translator taken as a plain function parameter: its namespace is unknown here (see INDIRECT).
const UNTYPED_PARAM = /(\w+)\??\s*:\s*\(\s*key\s*:\s*string/g;

/** Every key reference in one file: literal keys and dynamic prefixes. */
export function referencesIn(source) {
  const bindings = [];
  for (const m of source.matchAll(DECLARATION)) bindings.push({ name: m[1], ns: m[2] ?? m[3] ?? "", at: m.index });
  for (const m of source.matchAll(TYPED_PARAM)) bindings.push({ name: m[1], ns: m[2], at: m.index });
  for (const m of source.matchAll(UNTYPED_PARAM)) bindings.push({ name: m[1], ns: null, at: m.index });
  bindings.sort((x, y) => x.at - y.at);
  const literal = [];
  const dynamic = [];
  const names = [...new Set(bindings.map((b) => b.name))];
  for (const name of names) {
    const call = new RegExp(`(?<![\\w.])${name}(?:\\.(?:rich|has|markup|raw))?\\(\\s*`, "g");
    for (const m of source.matchAll(call)) {
      const binding = bindings.filter((b) => b.name === name && b.at <= m.index).at(-1);
      if (!binding || binding.ns === null) continue;
      const ns = binding.ns ? `${binding.ns}.` : "";
      const rest = source.slice(m.index + m[0].length);
      const str = /^(["'])((?:(?!\1).)*)\1/.exec(rest);
      const tpl = /^`([^`]*)`/.exec(rest);
      // cond ? "a" : "b"
      const ternary = /^(?:[^,()`?]|\([^()]*\))*\?\s*(["'])([^"']*)\1\s*:\s*(["'])([^"']*)\3/.exec(rest);
      const line = source.slice(0, m.index).split("\n").length;
      if (str) literal.push({ key: ns + str[2], line });
      else if (ternary) literal.push({ key: ns + ternary[2], line }, { key: ns + ternary[4], line });
      else if (tpl && !tpl[1].includes("${")) literal.push({ key: ns + tpl[1], line });
      else if (tpl) dynamic.push({ prefix: ns + tpl[1].slice(0, tpl[1].indexOf("${")), line });
      else dynamic.push({ prefix: ns, line });
    }
  }
  return { literal, dynamic };
}

// --------------------------------------------------------------------------------------------- check

export function checkMessages(root = ROOT) {
  const problems = [];
  const en = flatten(JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8")));
  const ro = flatten(JSON.parse(readFileSync(join(root, "messages/ro.json"), "utf8")));

  for (const key of en.keys()) if (!ro.has(key)) problems.push(`missing in ro.json: ${key}`);
  for (const key of ro.keys()) if (!en.has(key)) problems.push(`missing in en.json: ${key}`);

  for (const [key, text] of en) {
    if (!ro.has(key)) continue;
    const a = [...placeholders(text)].sort().join(", ");
    const b = [...placeholders(ro.get(key))].sort().join(", ");
    if (a !== b) problems.push(`placeholders differ for ${key}: en {${a}} vs ro {${b}}`);
  }

  const skipped = (key) => SKIP_NAMESPACES.some((ns) => key === ns || key.startsWith(`${ns}.`));
  const used = new Set(Object.keys(INDIRECT));
  const coveredBy = (key) =>
    DYNAMIC.find((d) => key.startsWith(d.prefix) && (!d.keys || d.keys.includes(key.slice(d.prefix.length))));
  for (const file of sourceFiles(join(root, "src"))) {
    const where = relative(root, file);
    const { literal, dynamic } = referencesIn(readFileSync(file, "utf8"));
    for (const { key, line } of literal) {
      used.add(key);
      // A literal key may also name a whole group (t.raw("x")).
      const isGroup = [...en.keys()].some((k) => k.startsWith(`${key}.`));
      if (!en.has(key) && !isGroup && !skipped(key)) problems.push(`missing key ${key} (${where}:${line})`);
    }
    for (const { prefix, line } of dynamic) {
      if (skipped(prefix)) continue;
      if (!DYNAMIC.some((d) => prefix.startsWith(d.prefix)))
        problems.push(`dynamic key under "${prefix}" is not in DYNAMIC (${where}:${line})`);
    }
  }

  for (const key of en.keys()) {
    if (skipped(key) || used.has(key) || coveredBy(key)) continue;
    problems.push(`unused key: ${key}`);
  }
  for (const d of DYNAMIC) {
    if (d.keys) {
      for (const k of d.keys) if (!en.has(d.prefix + k)) problems.push(`DYNAMIC lists a missing key: ${d.prefix}${k}`);
    } else if (![...en.keys()].some((k) => k.startsWith(d.prefix))) problems.push(`DYNAMIC entry matches no key: ${d.prefix}`);
  }
  for (const key of Object.keys(INDIRECT)) if (!en.has(key)) problems.push(`INDIRECT lists a missing key: ${key}`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkMessages();
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s) in messages.`);
    process.exit(1);
  }
  console.log("messages: OK");
}
