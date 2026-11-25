import { readFile } from "node:fs/promises";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as contract from "../shared/contracts/v1.js";

const fixtureSchema = z.array(
  z.object({ name: z.string(), schema: z.string(), valid: z.boolean(), value: z.unknown() }),
);
const fixtures = fixtureSchema.parse(
  JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8")),
);
const schemas = new Map<string, z.ZodType>();
for (const [key, schema] of Object.entries(contract)) {
  if (schema instanceof z.ZodType) schemas.set(key, schema);
}
describe("portable video contracts", () => {
  it.each(fixtures)("$name", ({ schema, valid, value }) => {
    const validator = schemas.get(`${schema}Schema`);
    if (!validator) throw new Error(`Missing schema: ${schema}`);
    expect(validator.safeParse(value).success).toBe(valid);
  });
});
