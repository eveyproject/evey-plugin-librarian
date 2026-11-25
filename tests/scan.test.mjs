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
const { normTitle, sagaKey, findDuplicates, findSagaHoles, fetchWatchables, dupKey } = require(join(here, "../dist/scan.js"));

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

test("findDuplicates groups same-title watchables of one year, never another year's film", () => {
  const dups = findDuplicates([
    movie("a", "Dune", 2021),
    movie("b", "Dune", 2021),
    movie("c", "Dune", 1984),
    movie("d", "Alien", 1979),
    { id: "e", title: "Dune", type: "MEDIA_ITEM_TYPE_EPISODE" }, // never counted
  ]);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].entries.map((e) => e.id).sort(), ["a", "b"]);
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

// Real false positives seen on a library: none of these is a spare copy.
const film = (id, title, year, filePath, durationMs, extra = {}) =>
  ({ id, title, year, type: "MEDIA_ITEM_TYPE_MOVIE", filePath, quality: { durationMs: String(durationMs) }, ...extra });

test("findDuplicates: three different shows matched to one title stay apart by their file names", () => {
  const dups = findDuplicates([
    film("ny", "Les Experts", 1992, "/media/dvdrip/LES EXPERTS NEW YORK .avi", 2_600_000),
    film("mi", "Les Experts", 1992, "/media/dvdrip/LES EXPERTS MIAMI .avi", 2_600_000),
    film("lv", "Les Experts", 1992, "/media/dvdrip/LES EXPERTS LAS VEGAS .avi", 2_600_000),
  ]);
  assert.equal(dups.length, 0);
});

test("findDuplicates: the same title in different years is another film, never a duplicate", () => {
  assert.equal(findDuplicates([
    film("a", "The Colony", 2026, "/media/films/Colony - 1080P.mkv", 6_000_000),
    film("b", "The Colony", 2013, "/media/films/The colony - 1080P.mkv", 5_700_000),
  ]).length, 0);
  assert.equal(findDuplicates([
    film("c", "Die Alone", 2024, "/media/films/Die alone - 1080P.mkv", 5_800_000),
    film("d", "Die Alone", 2020, "/media/films/Alone - 1080P.mkv", 5_900_000),
  ]).length, 0);
});

test("findDuplicates: a misidentified film of another length is not a copy", () => {
  assert.equal(findDuplicates([
    film("dw", "Deadpool & Wolverine", 2024, "/media/films/Deadpool and wolverine - 2160P.mkv", 7_680_000),
    film("w", "Deadpool & Wolverine", 2024, "/media/dvdrip/Wolverine.avi", 6_420_000),
  ]).length, 0);
});

test("findDuplicates: a 3D edition is not a spare of the 2D film", () => {
  assert.equal(findDuplicates([
    film("3d", "Edge of Tomorrow", 2014, "/media/films/Edge of Tomorrow - 3D - 1080p.mkv", 6_780_000),
    film("2d", "Edge of Tomorrow", 2014, "/media/films/Edge of Tomorrow - 1080p.mkv", 6_780_000),
  ]).length, 0);
});

test("findDuplicates: true copies still group, whatever their release tags", () => {
  const dups = findDuplicates([
    film("a", "Dune", 2021, "/media/films/Dune (2021) - 2160p.mkv", 9_330_000),
    film("b", "Dune", 2021, "/media/dl/Dune.2021.1080p.BluRay.x264-GROUP.mkv", 9_310_000),
    film("c", "Dune", 2021, "/media/films/dune 720p.mkv", 9_330_000),
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].entries.length, 3);
});

test("findDuplicates: without paths (not an admin) same title and year still group", () => {
  const dups = findDuplicates([movie("a", "Dune", 2021), movie("b", "Dune", 2021)]);
  assert.equal(dups.length, 1);
});

test("dupKey: a dismissed group is named by its copies, so a new copy brings it back", () => {
  const g = findDuplicates([movie("b", "Dune", 2021), movie("a", "Dune", 2021)])[0];
  assert.equal(dupKey(g), "dup:a,b");
});
