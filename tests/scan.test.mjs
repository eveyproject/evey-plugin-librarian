// node --test suite for the detection logic, plus the drift guard: admin.js
// and library.js inline scan.js's block verbatim, and an edited copy that no
// longer matches the source of truth must fail loudly here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { normTitle, sagaKey, findDuplicates, findSagaHoles, fetchWatchables } = require(join(here, "../dist/scan.js"));

const movie = (id, title, year) => ({ id, title, year, type: "MEDIA_ITEM_TYPE_MOVIE" });

test("normTitle collides accents, case, punctuation and leading articles", () => {
  assert.equal(normTitle("L'Été meurtrier"), normTitle("l ete MEURTRIER!"));
  assert.equal(normTitle("The Matrix"), normTitle("Matrix"));
  assert.notEqual(normTitle("Matrix"), normTitle("Matrix Reloaded"));
});

test("sagaKey reads arabic and roman numbering, and part/chapter wrappers", () => {
  assert.deepEqual(sagaKey("Rocky III"), { base: "rocky", num: 3 });
  assert.deepEqual(sagaKey("Iron Man 2"), { base: "iron man", num: 2 });
  assert.deepEqual(sagaKey("Halloween part 4"), { base: "halloween", num: 4 });
  assert.deepEqual(sagaKey("Rocky"), { base: "rocky", num: 1 });
  // A year-like trailing number is NOT an episode.
  assert.equal(sagaKey("Blade Runner 2049").num, 1);
});

test("findDuplicates groups same-title watchables and tells copies from remakes", () => {
  const dups = findDuplicates([
    movie("a", "Dune", 2021),
    movie("b", "Dune", 2021),
    movie("c", "Dune", 1984),
    movie("d", "Alien", 1979),
    { id: "e", title: "Dune", type: "MEDIA_ITEM_TYPE_EPISODE" }, // never counted
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].entries.length, 3);
  assert.equal(dups[0].sameYear, false);
  const copies = findDuplicates([movie("a", "Dune", 2021), movie("b", "Dune", 2021)]);
  assert.equal(copies[0].sameYear, true);
});

test("findSagaHoles reports missing numbers, including a missing first episode", () => {
  const holes = findSagaHoles([
    movie("r2", "Rocky II", 1979),
    movie("r3", "Rocky III", 1982),
    movie("h1", "Halloween", 1978),
    movie("h2", "Halloween 2", 1981),
    movie("b2", "Blade II", 2002), // lone numbered entry: a choice, not a hole
  ]);
  assert.equal(holes.length, 1);
  assert.equal(holes[0].base, "rocky");
  assert.deepEqual(holes[0].missing, [1]);
});

test("fetchWatchables walks every page of movies, then of series", async () => {
  const calls = [];
  const movies = Array.from({ length: 1203 }, (_, i) => movie("m" + i, "M" + i, 2000));
  const list = async (opts) => {
    calls.push(opts);
    const pool = opts.type === "MEDIA_ITEM_TYPE_MOVIE" ? movies : [{ id: "s1", title: "S", type: "MEDIA_ITEM_TYPE_SERIES" }];
    const from = (opts.page - 1) * opts.pageSize;
    return { items: pool.slice(from, from + opts.pageSize), total: String(pool.length) };
  };
  const items = await fetchWatchables(list, "L1");
  assert.equal(items.length, 1204);
  assert.deepEqual(calls.map((c) => [c.type, c.page]), [
    ["MEDIA_ITEM_TYPE_MOVIE", 1], ["MEDIA_ITEM_TYPE_MOVIE", 2], ["MEDIA_ITEM_TYPE_MOVIE", 3], ["MEDIA_ITEM_TYPE_SERIES", 1],
  ]);
  assert.ok(calls.every((c) => c.libraryId === "L1" && c.pageSize === 500));
});

test("fetchWatchables stops on a server that ignores paging", async () => {
  let n = 0;
  const full = Array.from({ length: 500 }, (_, i) => movie("x" + i, "X", 2000));
  const items = await fetchWatchables(async () => { n++; return { items: full, total: 999999 }; });
  assert.equal(n, 400, "bounded at 200 pages per type");
  assert.equal(items.length, 200000);
});

test("the inlined copies in admin.js and library.js match scan.js verbatim", () => {
  const src = readFileSync(join(here, "../dist/scan.js"), "utf8");
  const start = src.indexOf("  // normTitle flattens");
  const end = src.indexOf("\n\n  var api =");
  assert.ok(start >= 0 && end > start, "scan.js block markers moved - update the drift guard");
  const block = src.slice(start, end);
  for (const file of ["admin.js", "library.js"]) {
    const mod = readFileSync(join(here, "../dist", file), "utf8");
    assert.ok(mod.includes(block), `${file} drifted from scan.js`);
  }
});
