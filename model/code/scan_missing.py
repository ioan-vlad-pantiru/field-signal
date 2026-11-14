"""Count eligible candidates per NUTS3 over every HRL tile (read-only)."""
import sys, collections
import multiprocessing as mp
import numpy as np
sys.path.insert(0, "code")
import points

pairs, tiles = points._inventory()
nuts, countries = points._load_nuts()
keep = np.array([r["country"] in points.FULL_COUNTRIES or r["code"].startswith(("AT1", "RS12"))
                 for r in nuts], dtype=bool)
points._CTX.update(pairs=pairs, nuts=nuts, keep=keep)

if __name__ == "__main__":
    ctx = mp.get_context("fork")
    per_nuts = collections.Counter()
    per_stratum = collections.Counter()
    with ctx.Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 16) as pool:
        for c in pool.imap_unordered(points._tile_candidates, tiles):
            if c is None: continue
            for i, n in zip(*np.unique(c["nidx"], return_counts=True)):
                per_nuts[nuts[int(i)]["code"]] += int(n)
            for k, n in zip(*np.unique(c["keys"], return_counts=True)):
                per_stratum[int(k)] += int(n)
    np.save("/tmp/per_nuts.npy", np.array(sorted(per_nuts.items(), key=lambda kv: kv[0]), dtype=object))
    np.save("/tmp/per_stratum.npy", np.array(sorted(per_stratum.items()), dtype=object))
    print("tiles", len(tiles), "nuts3 with candidates", len(per_nuts), "eligible total", sum(per_nuts.values()))
