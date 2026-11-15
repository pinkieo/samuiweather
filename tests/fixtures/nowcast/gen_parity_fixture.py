#!/usr/bin/env python3
"""Regenerate the TS<->Python parity fixtures for the experimental rain nowcast.

Reads archived RainViewer frames from the offline Python prototype (samui-nowcast; default /workspace/samui-nowcast,
override with NOWCAST_PROTO_DIR), runs the prototype's nowcast at every archived frame (only frames up to that time,
3 h window, 'now' = frame time + 4 min), and writes:
  parity-frames.json    archived frames (gzip+base64 uint8 q = dBZ+32) + palette decode cases
  parity-expected.json  prototype output per issue time (verdict text, per-cell motion / status / ETA ...)
Run:  python3 tests/fixtures/nowcast/gen_parity_fixture.py
Only reads the archive; writes only into this folder.
"""
import base64, gzip, json, math, os, sys
from pathlib import Path

PROTO = Path(os.environ.get("NOWCAST_PROTO_DIR", "/workspace/samui-nowcast"))
sys.path.insert(0, str(PROTO))
import numpy as np
from snw import config as C, rvfetch, nowcast, verdict

OUT = Path(__file__).resolve().parent
HOURS = 3.0
NOW_LAG = 240

def b64gz(a: np.ndarray) -> str:
    return base64.b64encode(gzip.compress(a.tobytes(), 9)).decode()

def num(x):
    if x is None: return None
    x = float(x)
    return None if math.isnan(x) else x

def main():
    frames = rvfetch.load_frames()
    assert len(frames) >= 6, "archive too small"
    out_frames = [dict(t=f["t"], q=b64gz(f["q"])) for f in frames]

    rng = np.random.default_rng(7)
    n = 3000
    img = rng.integers(0, 256, size=(1, n, 4), dtype=np.uint8)
    # include exact palette colours, transparent pixels and near-palette colours
    pal = rvfetch._PAL_RGBA.astype(np.uint8)
    for i in range(0, n, 3):
        img[0, i] = pal[rng.integers(0, len(pal))]
    for i in range(1, n, 7):
        img[0, i, 3] = 0
    for i in range(2, n, 5):
        img[0, i] = np.clip(pal[rng.integers(0, len(pal))].astype(int) + rng.integers(-3, 4, size=4), 0, 255)
    decode = dict(rgba=base64.b64encode(img.tobytes()).decode(), q=base64.b64encode(rvfetch.decode_rgba(img).tobytes()).decode(), n=n)

    expected = []
    for i in range(2, len(frames)):
        sub = frames[: i + 1]
        tmax = sub[-1]["t"]
        sub = [f for f in sub if f["t"] >= tmax - HOURS * 3600]
        now = tmax + NOW_LAG
        nc = nowcast.issue_nowcast(sub, now)
        cells = []
        for it in nc["items"]:
            tr, c, ex = it["track"], it["cell"], it["ex"]
            cells.append(dict(
                tid=tr.tid, n_obs=len(tr.cells), cx=c.cx, cy=c.cy, area_px=c.area_px, area_km2=c.area_km2, max_dbz=c.max_dbz,
                elong=c.elong, edge_km=c.edge_km, edge_bearing=c.edge_bearing,
                vx=tr.v[0], vy=tr.v[1], speed=tr.speed, heading=num(tr.heading), v_conf=tr.v_conf, v_spread=tr.v_spread,
                trend=tr.trend.get("label"), dlnA=tr.trend.get("dlnA_per_h"), ddbz=tr.trend.get("ddbz_per_h"), status=ex["status"], edge_km_now=ex["edge_km_now"],
                eta=ex["eta_central_min"], window=list(ex["eta_window_min"]) if ex["eta_window_min"] else None, prob=ex["prob"],
                clear=ex["clear_central_min"], eta_near=ex["eta_near_central_min"], prob_near=ex["prob_near"],
                closest_km=ex["closest_km"], closest_at=ex["closest_at_min"],
                text=verdict.describe(it, nc["issue_frame_t"])))
        v = nc["verdict"]
        expected.append(dict(
            index=i, now=now, n_frames=len(sub), t_frame=nc["issue_frame_t"], data_t=nc["data_frame_t"], n_unique=nc["n_unique"],
            prior_global=list(nc["prior_global"]) if nc["prior_global"] else None,
            verdict=dict(text=v["text"], category=v["category"], stale=v["stale"], age_min=v["age_min"],
                         frame_time_ict=v["frame_time_ict"], headline_tid=v["headline_tid"]),
            cells=cells))
    (OUT / "parity-frames.json").write_text(json.dumps(dict(frames=out_frames, decode=decode), separators=(",", ":")))
    (OUT / "parity-expected.json").write_text(json.dumps(dict(
        generated_from=dict(n_frames=len(frames), first_t=frames[0]["t"], last_t=frames[-1]["t"], hours=HOURS, now_lag=NOW_LAG),
        issues=expected), separators=(",", ":")))
    ncell = sum(len(e["cells"]) for e in expected)
    print(f"frames={len(frames)} issues={len(expected)} cell-records={ncell} "
          f"max-cells={max(len(e['cells']) for e in expected)}")
    from collections import Counter
    print(Counter(c["status"] for e in expected for c in e["cells"]))
    print(Counter(e["verdict"]["category"] for e in expected))

if __name__ == "__main__":
    main()
