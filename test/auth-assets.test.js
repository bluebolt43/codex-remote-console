import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isUnauthenticatedAsset } from "../auth-assets.js";

test("every module imported by unauthenticated pages is publicly readable", async () => {
  for (const script of ["login.js", "pair.js"]) {
    const source = await readFile(new URL(`../public/${script}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)]
      .map((match) => `/${match[1].slice(2)}`);
    assert.ok(imports.length > 0, `${script} should have module dependencies`);
    for (const pathname of imports) assert.equal(isUnauthenticatedAsset(pathname), true, `${pathname} imported by ${script}`);
  }
});
