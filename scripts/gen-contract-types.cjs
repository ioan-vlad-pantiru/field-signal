// Generate apps/web/src/lib/contracts.ts from contracts/*.schema.json.
// Kept out of package.json on purpose (rarely run, avoids lockfile churn). From the repo root:
//   npm i --prefix /tmp/jstt json-schema-to-typescript@15
//   NODE_PATH=/tmp/jstt/node_modules node scripts/gen-contract-types.cjs
const { readFileSync, writeFileSync } = require("node:fs");
const { compile } = require("json-schema-to-typescript");

const NAMES = [
  "field_request",
  "field_analysis",
  "sourcing_region",
  "model_prediction",
  "sign_up",
  "sign_in",
  "account",
  "account_update",
  "password_change",
  "account_deletion",
  "saved_field_input",
  "saved_field",
  "assistant_request",
  "assistant_reply",
  "parcel_collection",
  "parcel_merge_request",
  "merged_parcels",
  "farm",
  "farm_import",
  "farm_rematch",
  "farm_suggest_request",
  "farm_suggestion",
  "farm_plan_request",
  "farm_plan",
];
const OUT = "apps/web/src/lib/contracts.ts";

// Pydantic puts a `title` on every property; that makes json-schema-to-typescript emit one
// alias per field (Id1, Value2, ...). Strip property titles so primitives are inlined.
function stripPropertyTitles(node) {
  if (Array.isArray(node)) return node.forEach(stripPropertyTitles);
  if (!node || typeof node !== "object") return;
  if (node.properties) {
    for (const prop of Object.values(node.properties)) {
      delete prop.title;
      for (const k of ["anyOf", "oneOf", "allOf"]) (prop[k] ?? []).forEach((s) => delete s.title);
    }
  }
  for (const v of Object.values(node)) stripPropertyTitles(v);
}

async function main() {
let out =
  "// GENERATED from contracts/*.schema.json. Do not edit by hand.\n" +
  "// Regenerate from the repo root:\n" +
  "//   uv run --package api python -m api.export_contracts\n" +
  "//   NODE_PATH=/tmp/jstt/node_modules node scripts/gen-contract-types.cjs\n\n";
const seen = new Set();
for (const name of NAMES) {
  const schema = JSON.parse(readFileSync(`contracts/${name}.schema.json`, "utf8"));
  stripPropertyTitles(schema);
  const ts = await compile(schema, schema.title, {
    bannerComment: "",
    additionalProperties: false,
    declareExternallyReferenced: true,
  });
  for (const block of ts.split(/\n(?=export )/)) {
    const m = block.match(/^export (?:interface|type) (\w+)/);
    if (m && seen.has(m[1])) continue;
    if (m) seen.add(m[1]);
    out += block.trim() + "\n\n";
  }
}
writeFileSync(OUT, out.trimEnd() + "\n");
console.log(`wrote ${OUT} (${seen.size} types)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
