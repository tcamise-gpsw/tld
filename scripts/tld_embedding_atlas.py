#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pandas>=2.0",
#   "pyarrow>=14.0",
#   "embedding-atlas>=0.20.0",
# ]
# ///
"""Interactive visualization of tld symbol embeddings using Apple's Embedding Atlas.

https://github.com/apple/embedding-atlas

Usage:
  uv run scripts/tld_embedding_atlas.py [OPTIONS]

Examples:
  uv run scripts/tld_embedding_atlas.py
  uv run scripts/tld_embedding_atlas.py --db ~/.local/share/tldiagram/tld.db
  uv run scripts/tld_embedding_atlas.py --repository myrepo --sample 5000
  uv run scripts/tld_embedding_atlas.py --port 5056 --umap-random-state 0
"""

import argparse
import struct
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Visualize tld symbol embeddings with Apple's Embedding Atlas.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--db",
        default=str(Path.home() / ".local/share/tldiagram/tld.db"),
        help="Path to tld SQLite database (default: ~/.local/share/tldiagram/tld.db)",
    )
    p.add_argument(
        "--repository",
        default="",
        metavar="NAME_OR_ID",
        help="Repository display name or numeric ID to visualize (default: most recent)",
    )
    p.add_argument(
        "--model",
        default="",
        metavar="NAME_OR_ID",
        help="Embedding model name/provider+model or numeric ID (default: most recent)",
    )
    p.add_argument(
        "--sample",
        type=int,
        default=0,
        metavar="N",
        help="Limit to N symbols (0 = all, useful for quick exploration)",
    )
    p.add_argument(
        "--port",
        type=int,
        default=5055,
        help="Port for the Embedding Atlas web server (default: 5055)",
    )
    p.add_argument(
        "--umap-metric",
        default="cosine",
        choices=["cosine", "euclidean", "correlation"],
        help="Distance metric for UMAP (default: cosine)",
    )
    p.add_argument(
        "--umap-n-neighbors",
        type=int,
        default=15,
        help="UMAP n_neighbors parameter (default: 15)",
    )
    p.add_argument(
        "--umap-min-dist",
        type=float,
        default=0.1,
        help="UMAP min_dist parameter (default: 0.1)",
    )
    p.add_argument(
        "--umap-random-state",
        type=int,
        default=42,
        help="UMAP random seed for reproducibility (default: 42)",
    )
    p.add_argument(
        "--keep-parquet",
        action="store_true",
        help="Keep the temporary parquet file after launching (useful for debugging)",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def decode_vector(blob: bytes) -> list[float]:
    """Decode a little-endian float32 BLOB into a Python list of floats."""
    n = len(blob) // 4
    return list(struct.unpack_from(f"<{n}f", blob))


def resolve_repository(con: sqlite3.Connection, selector: str) -> tuple[int, str]:
    rows = con.execute(
        "SELECT id, display_name, repo_root FROM watch_repositories "
        "ORDER BY updated_at DESC, id DESC"
    ).fetchall()
    if not rows:
        print("ERROR: No repositories found in database.", file=sys.stderr)
        sys.exit(1)
    if not selector:
        r = rows[0]
        return r["id"], r["display_name"]
    for r in rows:
        if str(r["id"]) == selector or r["display_name"] == selector:
            return r["id"], r["display_name"]
    names = [r["display_name"] for r in rows]
    print(f"ERROR: Repository {selector!r} not found. Available: {names}", file=sys.stderr)
    sys.exit(1)


def resolve_model(con: sqlite3.Connection, selector: str) -> tuple[int, str]:
    rows = con.execute(
        "SELECT id, provider, model FROM watch_embedding_models "
        "ORDER BY created_at DESC, id DESC"
    ).fetchall()
    if not rows:
        print("ERROR: No embedding models found in database.", file=sys.stderr)
        sys.exit(1)
    if not selector:
        m = rows[0]
        return m["id"], f"{m['provider']}/{m['model']}"
    for m in rows:
        full = f"{m['provider']}/{m['model']}"
        if str(m["id"]) == selector or m["model"] == selector or full == selector:
            return m["id"], full
    names = [f"{m['provider']}/{m['model']}" for m in rows]
    print(f"ERROR: Model {selector!r} not found. Available: {names}", file=sys.stderr)
    sys.exit(1)


def load_symbols(
    db_path: str, repo_selector: str, model_selector: str, sample: int
) -> tuple[list[dict], str, str]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    repo_id, repo_name = resolve_repository(con, repo_selector)
    model_id, model_name = resolve_model(con, model_selector)

    print(f"Repository : {repo_name}  (id={repo_id})")
    print(f"Model      : {model_name}  (id={model_id})")

    limit_clause = f"LIMIT {sample}" if sample > 0 else ""

    rows = con.execute(
        f"""
        SELECT
            e.owner_key,
            e.vector,
            s.id          AS symbol_id,
            s.stable_key,
            s.name,
            s.qualified_name,
            s.kind,
            f.path        AS file,
            s.start_line,
            s.end_line,
            COALESCE(fd.decision, '')   AS decision,
            COALESCE(fd.score,    0.0)  AS score,
            COALESCE(fd.tier,     0)    AS tier
        FROM watch_symbols s
        JOIN watch_files f ON f.id = s.file_id
        LEFT JOIN watch_symbol_identities i
               ON i.repository_id = s.repository_id
              AND i.current_stable_key = s.stable_key
        CROSS JOIN watch_embeddings e
               ON e.model_id = ?
              AND e.owner_type = 'symbol'
              AND e.owner_key = COALESCE(i.identity_key, s.stable_key)
        LEFT JOIN watch_filter_decisions fd ON fd.id = (
            SELECT MAX(fd2.id)
            FROM watch_filter_decisions fd2
            WHERE fd2.owner_type = 'symbol'
              AND fd2.owner_key = e.owner_key
        )
        WHERE s.repository_id = ?
        ORDER BY f.path, s.start_line, s.name
        {limit_clause}
        """,
        (model_id, repo_id),
    ).fetchall()

    con.close()

    print(f"Symbols    : {len(rows)}")

    records = []
    for row in rows:
        raw_vec = row["vector"]
        if not raw_vec:
            continue
        vec = decode_vector(raw_vec)
        end_line = row["end_line"] if row["end_line"] is not None else row["start_line"]
        # Construct a short human-readable label used by Embedding Atlas search.
        label = f"{row['kind']}  {row['qualified_name'] or row['name']}"
        records.append(
            {
                "label":          label,
                "name":           row["name"],
                "qualified_name": row["qualified_name"] or row["name"],
                "kind":           row["kind"],
                "file":           row["file"],
                "lines":          f"{row['start_line']}–{end_line}",
                "decision":       row["decision"],
                "score":          float(row["score"]),
                "tier":           int(row["tier"]),
                "stable_key":     row["stable_key"],
                "vector":         vec,
            }
        )
    return records, repo_name, model_name


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        print(f"ERROR: Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    print(f"\ntld Embedding Atlas")
    print(f"{'=' * 40}")
    print(f"Database   : {db_path}")

    records, repo_name, model_name = load_symbols(
        str(db_path), args.repository, args.model, args.sample
    )

    if not records:
        print("ERROR: No symbols with embeddings found.", file=sys.stderr)
        sys.exit(1)

    # Build DataFrame and write parquet -----------------------------------
    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq

    df = pd.DataFrame(records)

    # Explicitly type the vector column as list<float32> so UMAP treats it
    # correctly (rather than inferring float64 from Python floats).
    schema_fields = []
    for col in df.columns:
        if col == "vector":
            schema_fields.append(pa.field("vector", pa.list_(pa.float32())))
        elif col in ("score",):
            schema_fields.append(pa.field(col, pa.float32()))
        elif col in ("tier",):
            schema_fields.append(pa.field(col, pa.int32()))
        else:
            schema_fields.append(pa.field(col, pa.string()))
    schema = pa.schema(schema_fields)

    table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)

    tmp = tempfile.NamedTemporaryFile(
        suffix=".parquet", delete=False, prefix="tld_embeddings_"
    )
    tmp.close()
    pq.write_table(table, tmp.name, compression="snappy")

    size_kb = Path(tmp.name).stat().st_size // 1024
    print(f"Parquet    : {tmp.name}  ({size_kb} KB, {len(df)} rows × {len(df.columns)} cols)")

    # Build and run the embedding-atlas CLI command -----------------------
    cmd = [
        "uvx",
        "embedding-atlas",
        tmp.name,
        "--vector", "vector",
        "--umap-metric", args.umap_metric,
        "--umap-n-neighbors", str(args.umap_n_neighbors),
        "--umap-min-dist", str(args.umap_min_dist),
        "--umap-random-state", str(args.umap_random_state),
        "--port", str(args.port),
        "--auto-port",
    ]

    print(f"\nRunning    : {' '.join(cmd)}")
    print(f"Browser    : http://localhost:{args.port}/\n")

    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if not args.keep_parquet:
            try:
                Path(tmp.name).unlink()
            except OSError:
                pass
        else:
            print(f"Kept parquet: {tmp.name}")


if __name__ == "__main__":
    main()
