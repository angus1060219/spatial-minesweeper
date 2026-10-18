// Run: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const M = require("../js/minefield.js");

test("first click and its neighbours are always safe", () => {
  for (let seed = 0; seed < 50; seed++) {
    const b = M.generateBoard({ rows: 16, cols: 16, density: 0.2, sigma: 2, seed, safeIdx: 0 });
    assert.strictEqual(b.mines[0], 0);
    for (const j of M.neighbors(0, 16, 16)) assert.strictEqual(b.mines[j], 0);
  }
});

test("mine count matches density", () => {
  const b = M.generateBoard({ rows: 16, cols: 30, density: 0.2, sigma: 0, seed: 1, safeIdx: 100 });
  assert.strictEqual(b.mines.reduce((a, v) => a + v, 0), Math.round(480 * 0.2));
});

test("hint numbers equal queen spatial lag", () => {
  const b = M.generateBoard({ rows: 9, cols: 9, density: 0.15, sigma: 1, seed: 7, safeIdx: 40 });
  for (let i = 0; i < 81; i++) {
    const s = M.neighbors(i, 9, 9).reduce((a, j) => a + b.mines[j], 0);
    assert.strictEqual(b.counts[i], s);
  }
});

test("Moran's I: checkerboard is negative, two blocks are positive", () => {
  const rows = 8, cols = 8;
  const checker = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) + (i % 8)) % 2);
  const blocks = Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 1 : 0));
  assert.ok(M.moransI(checker, rows, cols) < 0);
  assert.ok(M.moransI(blocks, rows, cols) > 0.5);
});

test("larger sigma gives higher Moran's I on average", () => {
  const avg = (sigma) => {
    let s = 0;
    for (let seed = 0; seed < 20; seed++) {
      const b = M.generateBoard({ rows: 16, cols: 16, density: 0.16, sigma, seed, safeIdx: 0 });
      s += M.moransI(b.mines, 16, 16);
    }
    return s / 20;
  };
  const i0 = avg(0), i2 = avg(2);
  console.log(`  mean I: sigma=0 → ${i0.toFixed(3)}, sigma=2 → ${i2.toFixed(3)}`);
  assert.ok(Math.abs(i0) < 0.1);
  assert.ok(i2 > i0 + 0.2);
});
