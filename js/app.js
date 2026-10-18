/* app.js — UI for Spatial Minesweeper. 介面與遊戲流程。 */
(function () {
  "use strict";
  const M = window.Minefield;
  const $ = (id) => document.getElementById(id);

  const el = {
    preset: $("preset"), sigma: $("sigma"), sigmaOut: $("sigmaOut"),
    density: $("density"), densOut: $("densOut"), seed: $("seed"), reseed: $("reseed"),
    newGame: $("newGame"), flagMode: $("flagMode"), showField: $("showField"), exportCsv: $("exportCsv"),
    board: $("board"), minesLeft: $("minesLeft"), timer: $("timer"), message: $("message"),
    moranI: $("moranI"), moranE: $("moranE"), moranP: $("moranP"), moranTxt: $("moranTxt"),
  };

  let game = null;
  let timerId = null;
  let flagMode = false;
  let showField = false;

  const randomSeed = () => Math.floor(Math.random() * 1e9);

  function settings() {
    const [rows, cols] = el.preset.value.split("x").map(Number);
    return {
      rows, cols,
      sigma: Number(el.sigma.value),
      density: Number(el.density.value),
      seed: Number(el.seed.value) || 0,
    };
  }

  function newGame() {
    stopTimer();
    const s = settings();
    game = {
      ...s,
      board: null,            // generated on first click 第一下才產生
      open: new Uint8Array(s.rows * s.cols),
      flag: new Uint8Array(s.rows * s.cols),
      state: "ready",         // ready | playing | won | lost
      opened: 0,
      start: 0,
      cells: [],
    };
    el.timer.textContent = "0";
    el.minesLeft.textContent = Math.round(s.rows * s.cols * s.density);
    el.message.textContent = "Click any cell to start · 點任一格開始";
    el.exportCsv.disabled = true;
    ["moranI", "moranE", "moranP", "moranTxt"].forEach((k) => (el[k].textContent = "–"));
    buildGrid();
  }

  function buildGrid() {
    // Reuse existing cells when size is unchanged, so a click that triggers a
    // settings "change" event (e.g. leaving the seed box) is not swallowed.
    const existing = el.board.querySelectorAll(".cell");
    if (existing.length === game.rows * game.cols &&
        el.board.dataset.cols === String(game.cols)) {
      existing.forEach((b) => { b.className = "cell"; b.textContent = ""; game.cells.push(b); });
      return;
    }
    el.board.dataset.cols = game.cols;
    el.board.innerHTML = "";
    el.board.style.gridTemplateColumns = `repeat(${game.cols}, var(--cell-size))`;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < game.rows * game.cols; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell";
      b.dataset.i = i;
      b.setAttribute("aria-label", `r${Math.floor(i / game.cols) + 1} c${(i % game.cols) + 1}`);
      frag.appendChild(b);
      game.cells.push(b);
    }
    el.board.appendChild(frag);
  }

  // ---------- game actions ----------
  function startIfNeeded(i) {
    if (game.state !== "ready") return;
    game.board = M.generateBoard({ ...settings(), rows: game.rows, cols: game.cols, safeIdx: i });
    game.state = "playing";
    game.start = Date.now();
    el.minesLeft.textContent = game.board.mineCount;
    el.message.textContent = "";
    el.exportCsv.disabled = false;
    timerId = setInterval(() => {
      el.timer.textContent = Math.floor((Date.now() - game.start) / 1000);
    }, 250);
    updateStats();
    if (showField) paintField();
  }

  function reveal(i) {
    if (game.state === "won" || game.state === "lost") return;
    startIfNeeded(i);
    if (game.flag[i] || game.open[i]) return;
    if (game.board.mines[i]) return lose(i);

    // flood fill on zeros 數字為 0 時自動展開
    const stack = [i];
    while (stack.length) {
      const k = stack.pop();
      if (game.open[k] || game.flag[k]) continue;
      game.open[k] = 1;
      game.opened++;
      drawCell(k);
      if (game.board.counts[k] === 0) {
        for (const j of M.neighbors(k, game.rows, game.cols)) if (!game.open[j]) stack.push(j);
      }
    }
    checkWin();
  }

  // Chord: clicking an open number whose flags match reveals the rest 雙擊展開
  function chord(i) {
    const nb = M.neighbors(i, game.rows, game.cols);
    const flags = nb.reduce((s, j) => s + game.flag[j], 0);
    if (flags !== game.board.counts[i]) return;
    for (const j of nb) if (!game.flag[j] && !game.open[j]) reveal(j);
  }

  function toggleFlag(i) {
    if (game.state !== "playing" || game.open[i]) return;
    game.flag[i] ^= 1;
    drawCell(i);
    const flags = game.flag.reduce((a, b) => a + b, 0);
    el.minesLeft.textContent = game.board.mineCount - flags;
  }

  function lose(i) {
    game.state = "lost";
    stopTimer();
    const { mines } = game.board;
    for (let k = 0; k < mines.length; k++) {
      if (mines[k] && !game.flag[k]) { game.open[k] = 1; drawCell(k); }
      else if (!mines[k] && game.flag[k]) { drawCell(k); game.cells[k].classList.add("wrong"); }
    }
    game.cells[i].classList.add("boom");
    el.message.textContent = "💥 Boom! Try a different σ? · 踩到雷了，換個 σ 試試？";
  }

  function checkWin() {
    const safe = game.rows * game.cols - game.board.mineCount;
    if (game.state === "playing" && game.opened === safe) {
      game.state = "won";
      stopTimer();
      for (let k = 0; k < game.flag.length; k++) {
        if (game.board.mines[k]) { game.flag[k] = 1; drawCell(k); }
      }
      el.minesLeft.textContent = "0";
      el.message.textContent = `🎉 Cleared in ${el.timer.textContent}s · 過關！`;
    }
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  // ---------- drawing ----------
  function drawCell(i) {
    const b = game.cells[i];
    const heat = b.querySelector(".heat");
    b.className = "cell";
    b.textContent = "";
    if (game.open[i]) {
      b.classList.add("open");
      if (game.board.mines[i]) {
        b.classList.add("mine");
        b.textContent = "💣";
      } else if (game.board.counts[i] > 0) {
        b.textContent = game.board.counts[i];
        b.classList.add("n" + game.board.counts[i]);
      }
    } else if (game.flag[i]) {
      b.textContent = "🚩";
    }
    if (heat) b.appendChild(heat);
  }

  function paintField() {
    game.cells.forEach((b) => b.querySelector(".heat")?.remove());
    if (!showField || !game.board) return;
    const f = game.board.field;
    let lo = Infinity, hi = -Infinity;
    for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
    game.cells.forEach((b, i) => {
      const t = (f[i] - lo) / (hi - lo || 1);
      const d = document.createElement("span");
      d.className = "heat";
      // low = blue, high = red (diverging) 低值藍、高值紅
      const hue = 220 - 220 * t;
      d.style.background = `hsla(${hue}, 75%, 50%, 0.45)`;
      b.appendChild(d);
    });
  }

  function updateStats() {
    const { mines, rows, cols } = game.board;
    const res = M.moranPermutation(mines, rows, cols, 199, M.mulberry32(game.seed + 1));
    el.moranI.textContent = res.I.toFixed(3);
    el.moranE.textContent = res.expected.toFixed(3);
    el.moranP.textContent = res.pValue.toFixed(3);
    let txt;
    if (res.pValue > 0.05) txt = "Close to random — mines are scattered. 接近隨機分布。";
    else if (res.I > 0) txt = "Significant clustering — mines come in groups. 顯著聚集：雷成群出現。";
    else txt = "Significant dispersion — mines avoid each other. 顯著分散：雷彼此遠離。";
    el.moranTxt.textContent = txt;
  }

  function exportCsv() {
    if (!game.board) return;
    const { rows, cols, mines, counts, field } = game.board;
    const lines = ["row,col,is_mine,neighbor_mines,latent"];
    for (let i = 0; i < rows * cols; i++) {
      lines.push(`${Math.floor(i / cols)},${i % cols},${mines[i]},${counts[i]},${field[i].toFixed(5)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `board_${rows}x${cols}_sigma${game.sigma}_seed${game.seed}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- events ----------
  el.board.addEventListener("click", (e) => {
    const b = e.target.closest(".cell");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (game.state !== "ready" && game.open[i]) return chord(i);
    if (flagMode && game.state === "playing") return toggleFlag(i);
    reveal(i);
  });
  el.board.addEventListener("contextmenu", (e) => {
    const b = e.target.closest(".cell");
    if (!b) return;
    e.preventDefault();
    toggleFlag(Number(b.dataset.i));
  });

  el.sigma.addEventListener("input", () => { el.sigmaOut.textContent = Number(el.sigma.value).toFixed(1); });
  el.density.addEventListener("input", () => { el.densOut.textContent = Math.round(el.density.value * 100) + "%"; });
  ["change"].forEach((ev) => {
    el.sigma.addEventListener(ev, newGame);
    el.density.addEventListener(ev, newGame);
    el.preset.addEventListener(ev, newGame);
    el.seed.addEventListener(ev, newGame);
  });
  el.reseed.addEventListener("click", () => { el.seed.value = randomSeed(); newGame(); });
  el.newGame.addEventListener("click", () => { el.seed.value = randomSeed(); newGame(); });
  el.flagMode.addEventListener("click", () => {
    flagMode = !flagMode;
    el.flagMode.setAttribute("aria-pressed", flagMode);
  });
  el.showField.addEventListener("click", () => {
    showField = !showField;
    el.showField.setAttribute("aria-pressed", showField);
    paintField();
  });
  el.exportCsv.addEventListener("click", exportCsv);

  el.seed.value = randomSeed();
  newGame();
})();
