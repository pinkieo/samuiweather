"""
Live sync: BaldEagle MySQL `gps_dat` + usage aggregates → Supabase `ship_positions`,
`ship_last_position`, and `usage_hourly`. UIDs are loaded from `public.ships` (source of truth).

Run from this directory with `.env` configured:
  python sync.py
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

import mysql.connector
from dotenv import load_dotenv
from supabase import Client, create_client

# ---------------------------
# ENV
# ---------------------------
_ENV_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=_ENV_DIR / ".env", override=True)

if not os.getenv("SUPABASE_URL"):
    raise RuntimeError("ENV NOT LOADED (SUPABASE_URL missing)")

_DEFAULT_LOCAL_DB = _ENV_DIR / "ULF.db"
# Legacy default path (single-machine); override with ULF_LOCAL_DB
_LEGACY_LOCAL_DB = Path(r"C:\Users\andre\esim-webapp\SQL ulf data\ULF.db")
ULF_LOCAL_DB = Path(os.getenv("ULF_LOCAL_DB", str(_LEGACY_LOCAL_DB if _LEGACY_LOCAL_DB.exists() else _DEFAULT_LOCAL_DB)))

print("SCRIPT STARTED")

with open(_ENV_DIR / "log.txt", "a", encoding="utf-8") as f:
    f.write(f"{datetime.now()} - run started\n")

# ---------------------------
# SUPABASE + MYSQL + SQLITE
# ---------------------------
supabase: Client = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_KEY", ""),
)

remote_db = mysql.connector.connect(
    host=os.getenv("REMOTE_DB_HOST"),
    user=os.getenv("REMOTE_DB_USER"),
    password=os.getenv("REMOTE_DB_PASSWORD"),
    database=os.getenv("REMOTE_DB_NAME"),
)

local_db = sqlite3.connect(str(ULF_LOCAL_DB))
local_cursor = local_db.cursor()
remote_cursor = remote_db.cursor()


def _migrate_verbruik_uur_if_needed() -> None:
    """
    Older installs used PRIMARY KEY (uur) only, which breaks multi-vessel usage.
    Migrate to PRIMARY KEY (uur, uid).
    """
    local_cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='verbruik_uur'"
    )
    if not local_cursor.fetchone():
        return
    local_cursor.execute("PRAGMA table_info(verbruik_uur)")
    cols = local_cursor.fetchall()
    pk_parts = sorted(
        [(c[1], c[5]) for c in cols if c[5] and c[5] > 0],
        key=lambda x: x[1],
    )
    pk_names = [p[0] for p in pk_parts]
    if not pk_names:
        return
    if set(pk_names) == {"uur", "uid"}:
        return
    if pk_names != ["uur"]:
        return

    local_cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS verbruik_uur_new (
            uur TEXT NOT NULL,
            uid TEXT NOT NULL,
            download_mb REAL,
            upload_mb REAL,
            PRIMARY KEY (uur, uid)
        )
        """
    )
    local_cursor.execute(
        """
        INSERT OR REPLACE INTO verbruik_uur_new (uur, uid, download_mb, upload_mb)
        SELECT uur, COALESCE(NULLIF(TRIM(uid), ''), '2097274FF158'), download_mb, upload_mb
        FROM verbruik_uur
        """
    )
    local_cursor.execute("DROP TABLE verbruik_uur")
    local_cursor.execute("ALTER TABLE verbruik_uur_new RENAME TO verbruik_uur")
    local_db.commit()
    print("SQLite: migrated verbruik_uur to PRIMARY KEY (uur, uid)")


_migrate_verbruik_uur_if_needed()

local_cursor.execute(
    """
    CREATE TABLE IF NOT EXISTS verbruik_uur (
        uur TEXT NOT NULL,
        uid TEXT NOT NULL,
        download_mb REAL,
        upload_mb REAL,
        PRIMARY KEY (uur, uid)
    )
    """
)
local_db.commit()


def fetch_ship_uids(supabase_client: Client) -> list[str]:
    """Distinct non-empty uid values from public.ships."""
    page_size = 1000
    offset = 0
    seen: set[str] = set()
    while True:
        res = (
            supabase_client.table("ships")
            .select("uid")
            .order("uid")
            .limit(page_size)
            .offset(offset)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            u = r.get("uid")
            if u is None:
                continue
            s = str(u).strip()
            if s:
                seen.add(s)
        if len(rows) < page_size:
            break
        offset += page_size
    return sorted(seen)


def last_sync_for_uid(uid: str) -> str:
    local_cursor.execute(
        "SELECT MAX(uur) FROM verbruik_uur WHERE uid = ?", (uid,)
    )
    row = local_cursor.fetchone()
    return row[0] if row and row[0] else "2026-01-01 00:00:00"


def coords_valid(lat: Any, lon: Any) -> bool:
    if lat is None or lon is None:
        return False
    for v in (lat, lon):
        if isinstance(v, str):
            t = v.strip().lower()
            if t in ("", "undefined", "null", "nan"):
                return False
    try:
        la = float(lat)
        lo = float(lon)
    except (TypeError, ValueError):
        return False
    return abs(la) <= 90 and abs(lo) <= 180


def row_to_ship_position_payload(row: tuple[Any, ...]) -> dict[str, Any] | None:
    uid, ts, lat, lon = row[0], row[1], row[2], row[3]
    if uid is None or not str(uid).strip():
        return None
    if not coords_valid(lat, lon):
        return None
    if ts is None:
        return None
    if hasattr(ts, "strftime"):
        position_time = ts.strftime("%Y-%m-%d %H:%M:%S")
    else:
        position_time = str(ts).strip()
    try:
        return {
            "uid": str(uid).strip(),
            "position_time": position_time,
            "latitude": float(lat),
            "longitude": float(lon),
        }
    except (TypeError, ValueError):
        return None


USAGE_QUERY = """
    SELECT
        DATE_FORMAT(`timestamp`, '%Y-%m-%d %H:00:00') AS uur,
        `uid`,
        ROUND((MAX(`wan4_dn`) - MIN(`wan4_dn`)) / 1024 / 1024, 2),
        ROUND((MAX(`wan4_up`) - MIN(`wan4_up`)) / 1024 / 1024, 2)
    FROM gps_dat
    WHERE `uid` = %s AND `timestamp` > %s
    GROUP BY 1, 2
"""

GPS_INCREMENTAL_QUERY = """
    SELECT
        `uid`,
        `timestamp`,
        `lat`,
        `lon`
    FROM gps_dat
    WHERE `uid` = %s
      AND `timestamp` > %s
      AND `lat` IS NOT NULL
      AND `lon` IS NOT NULL
      AND `lat` <> ''
      AND `lon` <> ''
    ORDER BY `timestamp` ASC
"""

# Prefer ll_id DESC when the column exists (MySQL 1054 = unknown column); else timestamp DESC.
LATEST_GPS_BY_LLID = """
    SELECT
        `uid`,
        `timestamp`,
        `lat`,
        `lon`
    FROM gps_dat
    WHERE `uid` = %s
      AND `lat` IS NOT NULL
      AND `lon` IS NOT NULL
      AND `lat` <> ''
      AND `lon` <> ''
    ORDER BY `ll_id` DESC
    LIMIT 1
"""
LATEST_GPS_QUERY = """
    SELECT
        `uid`,
        `timestamp`,
        `lat`,
        `lon`
    FROM gps_dat
    WHERE `uid` = %s
      AND `lat` IS NOT NULL
      AND `lon` IS NOT NULL
      AND `lat` <> ''
      AND `lon` <> ''
    ORDER BY `timestamp` DESC
    LIMIT 1
"""


def fetch_latest_gps_row(uid: str) -> tuple[Any, ...] | None:
    try:
        remote_cursor.execute(LATEST_GPS_BY_LLID, (uid,))
    except mysql.connector.Error as e:
        if getattr(e, "errno", None) == 1054:
            remote_cursor.execute(LATEST_GPS_QUERY, (uid,))
        else:
            raise
    return remote_cursor.fetchone()


def sync_one_uid(uid: str) -> dict[str, Any]:
    """Returns summary counts for logging."""
    summary: dict[str, Any] = {
        "uid": uid,
        "last_sync_u": None,
        "usage_rows": 0,
        "gps_history_fetched": 0,
        "gps_invalid_skipped": 0,
        "gps_history_upserted": 0,
        "latest_row_found": False,
        "ship_last_position_upserted": False,
    }

    last_u = last_sync_for_uid(uid)
    summary["last_sync_u"] = last_u

    # --- Usage (hourly aggregate since last_u) ---
    remote_cursor.execute(USAGE_QUERY, (uid, last_u))
    usage_rows = remote_cursor.fetchall()
    summary["usage_rows"] = len(usage_rows)

    if usage_rows:
        local_cursor.executemany(
            "INSERT OR REPLACE INTO verbruik_uur VALUES (?, ?, ?, ?)",
            usage_rows,
        )
        local_db.commit()

        usage_payload = [
            {
                "uur": row[0],
                "uid": row[1],
                "download_mb": float(row[2]) if row[2] is not None else None,
                "upload_mb": float(row[3]) if row[3] is not None else None,
            }
            for row in usage_rows
        ]
        supabase.table("usage_hourly").upsert(
            usage_payload,
            on_conflict="uur,uid",
        ).execute()

    # --- GPS history (incremental) ---
    remote_cursor.execute(GPS_INCREMENTAL_QUERY, (uid, last_u))
    gps_rows = remote_cursor.fetchall()
    summary["gps_history_fetched"] = len(gps_rows)

    gps_payload: list[dict[str, Any]] = []
    for row in gps_rows:
        p = row_to_ship_position_payload(row)
        if p is None:
            summary["gps_invalid_skipped"] += 1
            continue
        gps_payload.append(p)

    summary["gps_history_upserted"] = len(gps_payload)

    if gps_payload:
        supabase.table("ship_positions").upsert(
            gps_payload,
            on_conflict="uid,position_time",
        ).execute()

    # --- Latest position (always from MySQL; independent of incremental batch) ---
    latest = fetch_latest_gps_row(uid)
    if latest and coords_valid(latest[2], latest[3]):
        p = row_to_ship_position_payload(latest)
        if p:
            summary["latest_row_found"] = True
            supabase.table("ship_last_position").upsert(
                {
                    "uid": p["uid"],
                    "position_time": p["position_time"],
                    "latitude": p["latitude"],
                    "longitude": p["longitude"],
                    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                },
                on_conflict="uid",
            ).execute()
            summary["ship_last_position_upserted"] = True

    return summary


# ---------------------------
# MAIN
# ---------------------------
ship_uids = fetch_ship_uids(supabase)
if not ship_uids:
    msg = "No UIDs in public.ships — nothing to sync."
    print(msg)
    with open(_ENV_DIR / "log.txt", "a", encoding="utf-8") as f:
        f.write(msg + "\n")
else:
    print(f"Ships UIDs to sync: {len(ship_uids)}")

    total_usage = 0
    total_gps_hist = 0
    summaries: list[dict[str, Any]] = []

    for uid in ship_uids:
        s = sync_one_uid(uid)
        summaries.append(s)
        total_usage += s["usage_rows"]
        total_gps_hist += s["gps_history_upserted"]

        print(
            f"[sync] uid={uid} last_sync_u={s['last_sync_u']} "
            f"usage_rows={s['usage_rows']} "
            f"gps_history_fetched={s['gps_history_fetched']} "
            f"invalid_skipped={s['gps_invalid_skipped']} "
            f"gps_history_upserted={s['gps_history_upserted']} "
            f"latest_row_found={s['latest_row_found']} "
            f"ship_last_position_upserted={s['ship_last_position_upserted']}"
        )

    message = (
        f"Sync voltooid op {datetime.now()}: {total_usage} usage-uren (alle schepen), "
        f"{total_gps_hist} gps-punten (incrementeel), {len(ship_uids)} uid(s) verwerkt."
    )
    with open(_ENV_DIR / "log.txt", "a", encoding="utf-8") as f:
        f.write(message + "\n")
        for s in summaries:
            f.write(
                f"  uid={s['uid']} usage={s['usage_rows']} hist={s['gps_history_upserted']} "
                f"skipped={s['gps_invalid_skipped']} last_ok={s['ship_last_position_upserted']}\n"
            )

    print(message)

print("SCRIPT FINISHED")

remote_db.close()
local_db.close()
