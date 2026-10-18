"""
Cross-check the browser's Moran's I with PySAL (esda + libpysal).
用 PySAL 驗證網頁算出來的 Moran's I 是否正確。

Usage 用法:
    pip install esda libpysal pandas numpy
    python scripts/verify_moran.py board_16x16_sigma2_seed42.csv

The CSV comes from the "Download board CSV" button in the game.
CSV 從遊戲裡的「Download board CSV」按鈕下載。
"""
import sys

import numpy as np
import pandas as pd


def numpy_moran(x: np.ndarray, rows: int, cols: int) -> float:
    """Plain NumPy Moran's I with binary queen weights (no PySAL needed)."""
    grid = x.reshape(rows, cols).astype(float)
    z = grid - grid.mean()
    lag = np.zeros_like(z)
    count = np.zeros_like(z)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            src = z[max(0, dr):rows + min(0, dr), max(0, dc):cols + min(0, dc)]
            lag[max(0, -dr):rows + min(0, -dr), max(0, -dc):cols + min(0, -dc)] += src
            count[max(0, -dr):rows + min(0, -dr), max(0, -dc):cols + min(0, -dc)] += 1
    s0 = count.sum()
    return (z.size / s0) * (z * lag).sum() / (z ** 2).sum()


def main(path: str) -> None:
    df = pd.read_csv(path).sort_values(["row", "col"])
    rows, cols = df["row"].max() + 1, df["col"].max() + 1
    x = df["is_mine"].to_numpy()

    print(f"Board {rows}x{cols}, mines = {x.sum()} ({x.mean():.1%})")
    print(f"NumPy Moran's I        : {numpy_moran(x, rows, cols):.4f}")

    try:
        from esda.moran import Moran
        from libpysal.weights import lat2W
    except ImportError:
        print("(Install esda + libpysal to also compare with PySAL.)")
        return

    w = lat2W(rows, cols, rook=False)  # queen contiguity on a lattice
    # NOTE: esda.Moran row-standardises W by default (transformation="r") and
    # changes w in place. The game uses binary weights, so force "B".
    # 注意：esda 預設會把 W 列標準化，遊戲用的是二元權重，所以指定 "B"。
    mi = Moran(x, w, transformation="B", permutations=999)
    print(f"PySAL Moran's I        : {mi.I:.4f}")
    print(f"E[I]                   : {mi.EI:.4f}")
    print(f"Pseudo p-value (999)   : {mi.p_sim:.4f}")

    # Bonus: hint numbers are the spatial lag of the mine indicator.
    # 額外驗證：提示數字＝雷的 spatial lag
    from libpysal.weights import lag_spatial
    lag = lag_spatial(w, x.astype(float))
    ok = np.allclose(lag, df["neighbor_mines"].to_numpy())
    print(f"Hint numbers == W·x    : {ok}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
