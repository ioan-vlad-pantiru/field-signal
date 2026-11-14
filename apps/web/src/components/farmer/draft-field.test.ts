import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { farmRequest, type SubmittedField } from "./draft-field.ts";

const field = {
  request: { location: { lat: 46.3, lon: 23.75 }, current_rotation: ["maize", "wheat"], priorities: {} },
  boundary: [],
  place: null,
  accountId: null,
  name: null,
} as unknown as SubmittedField;

describe("farmRequest", () => {
  it("ids the fields f1, f2, … and caps names at the contract's 80 characters", () => {
    const body = farmRequest([field, field], (_, i) => (i === 0 ? "x".repeat(200) : "Field 2"));
    assert.deepEqual(body.fields.map((f) => f.id), ["f1", "f2"]);
    assert.deepEqual(body.fields.map((f) => f.name), ["x".repeat(80), "Field 2"]);
  });
});
