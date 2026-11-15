import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkMessages, placeholders } from "../../scripts/check-messages.mjs";

describe("messages", () => {
  it("en.json and ro.json match each other and the code", () => {
    const problems = checkMessages();
    assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
  });

  it("reads ICU arguments, not plural branch text", () => {
    const names = placeholders("{count, plural, =0 {None} one {# field} other {# fields}} near {place} <b>now</b>");
    assert.deepEqual([...names].sort(), ["<b>", "count", "place"]);
  });
});
