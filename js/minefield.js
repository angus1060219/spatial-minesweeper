/**
 * minefield.js — core logic for Spatial Autocorrelation Minesweeper.
 * 踩地雷核心邏輯：隨機場生成、高斯平滑、放雷、鄰居計數、Moran's I。
 *
 * Works in the browser (window.Minefield) and in Node (require).
 * No dependencies.
 */
(function (root) {
  "use strict";

  // ---------- Seeded RNG (mulberry32) 可重現的亂數 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard normal noise via Box–Muller 標準常態雜訊
  function gaussianNoise(n, rand) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const r = Math.sqrt(-2 * Math.log(u1));
      out[i] = r * Math.cos(2 * Math.PI * u2);
      if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
    }
    return out;
  }

  // Reflect index at edges (like scipy mode="reflect") 邊界反射
  function reflect(i, n) {
    while (i < 0 || i >= n) {
      if (i < 0) i = -i - 1;
      if (i >= n) i = 2 * n - i - 1;
    }
    return i;
  }

  /**
   * Separable Gaussian blur. sigma = 0 → no smoothing (pure random).
   * 可分離高斯濾波；sigma 越大，空間聚集越強。
   */
  function gaussianBlur(field, rows, cols, sigma) {
    if (!(sigma > 0)) return Float64Array.from(field);
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = [];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      kernel.push(w);
      sum += w;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

    const tmp = new Float64Array(rows * cols);
    const out = new Float64Array(rows * cols);
    // horizontal pass
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          acc += kernel[k + radius] * field[r * cols + reflect(c + k, cols)];
        }
        tmp[r * cols + c] = acc;
      }
    }
    // vertical pass
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          acc += kernel[k + radius] * tmp[reflect(r + k, rows) * cols + c];
        }
        out[r * cols + c] = acc;
      }
    }
    return out;
  }

  /**
   * Queen contiguity neighbours (8-connected) — the spatial weights W.
   * Queen 鄰接：上下左右＋四個斜角，就是踩地雷的 8 鄰居。
   */
  function neighbors(idx, rows, cols) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
      }
    }
    return out;
  }

  /**
   * Place mines on the top-k cells of the latent field (excluding safe cells).
   * 取潛在場數值最高的前 k 格當雷（排除第一下點擊的安全區）。
   */
  function placeMines(field, mineCount, excluded) {
    const n = field.length;
    const order = [];
    for (let i = 0; i < n; i++) if (!excluded.has(i)) order.push(i);
    order.sort((a, b) => field[b] - field[a]);
    const mines = new Uint8Array(n);
    const k = Math.min(mineCount, order.length);
    for (let i = 0; i < k; i++) mines[order[i]] = 1;
    return mines;
  }

  /**
   * Hint numbers = spatial lag of the mine indicator: (W·x)_i.
   * 提示數字＝雷指標變數的 spatial lag。
   */
  function spatialLag(x, rows, cols) {
    const out = new Int8Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let s = 0;
      for (const j of neighbors(i, rows, cols)) s += x[j];
      out[i] = s;
    }
    return out;
  }

  /**
   * Global Moran's I with binary queen weights (unstandardised).
   * I = (n / S0) · Σ_i Σ_j w_ij z_i z_j / Σ_i z_i²
   */
  function moransI(x, rows, cols) {
    const n = x.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean /= n;
    let num = 0;
    let den = 0;
    let s0 = 0;
    for (let i = 0; i < n; i++) {
      const zi = x[i] - mean;
      den += zi * zi;
      for (const j of neighbors(i, rows, cols)) {
        num += zi * (x[j] - mean);
        s0 += 1;
      }
    }
    if (den === 0) return 0;
    return (n / s0) * (num / den);
  }

  /**
   * Permutation inference: shuffle values across cells, recompute I.
   * 置換檢定：把雷隨機打散重算 I，得到 pseudo p-value。
   */
  function moranPermutation(x, rows, cols, perms, rand) {
    const observed = moransI(x, rows, cols);
    const arr = Array.from(x);
    let extreme = 0;
    let sum = 0;
    for (let p = 0; p < perms; p++) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      const ip = moransI(arr, rows, cols);
      sum += ip;
      if (ip >= observed) extreme++;
    }
    return {
      I: observed,
      expected: -1 / (x.length - 1),
      permMean: sum / perms,
      pValue: (extreme + 1) / (perms + 1),
    };
  }

  /**
   * Build a full board. The safe cell (first click) and its neighbours never hold a mine.
   * 產生一整張盤面；第一下點的格子與其鄰居保證安全。
   */
  function generateBoard(opts) {
    const { rows, cols, density, sigma, seed, safeIdx } = opts;
    const n = rows * cols;
    const rand = mulberry32(seed);
    const noise = gaussianNoise(n, rand);
    const field = gaussianBlur(noise, rows, cols, sigma);

    const excluded = new Set();
    if (safeIdx != null && safeIdx >= 0) {
      excluded.add(safeIdx);
      for (const j of neighbors(safeIdx, rows, cols)) excluded.add(j);
    }
    const mineCount = Math.min(Math.round(n * density), n - excluded.size);
    const mines = placeMines(field, mineCount, excluded);
    const counts = spatialLag(mines, rows, cols);
    return { rows, cols, field, mines, counts, mineCount };
  }

  const api = {
    mulberry32,
    gaussianNoise,
    gaussianBlur,
    neighbors,
    placeMines,
    spatialLag,
    moransI,
    moranPermutation,
    generateBoard,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Minefield = api;
})(typeof self !== "undefined" ? self : this);
