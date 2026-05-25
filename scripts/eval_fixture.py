#!/usr/bin/env python3
"""Evaluate populate retrieval results against a text fixture.

This is intentionally isolated from the Go test suite. It calls a running TLD
server's populate endpoint and compares returned element paths with a YAML
fixture of expected architecture-level folders/files.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import yaml


DEFAULT_FIXTURE = "fixtures/populate-retrieval/tld-architecture-overview.yaml"
DEFAULT_SERVER = "http://127.0.0.1:8060"


@dataclass
class QueryStats:
    element: str
    query: str
    hit_count: int
    expected_count: int
    reject_count: int
    top_paths: list[str]
    missed: list[str]
    error: str = ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate TLD populate retrieval against a YAML fixture.")
    parser.add_argument("--fixture", default=DEFAULT_FIXTURE, help=f"fixture YAML path (default: {DEFAULT_FIXTURE})")
    parser.add_argument("--server", default=DEFAULT_SERVER, help=f"TLD server base URL (default: {DEFAULT_SERVER})")
    parser.add_argument("--view-id", type=int, default=542, help="view id to use for populate endpoint (default: 542)")
    parser.add_argument("--limit", type=int, default=10, help="populate result limit per query (default: 10)")
    parser.add_argument(
        "--queries",
        choices=("name", "aliases", "all"),
        default="name",
        help="which fixture queries to evaluate per element (default: name)",
    )
    parser.add_argument("--show-top", type=int, default=3, help="number of returned paths to print per element (default: 3)")
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout seconds per query (default: 60)")
    args = parser.parse_args()

    fixture = load_fixture(args.fixture)
    stats: list[QueryStats] = []
    for item in fixture.get("fixtures", []):
        for query in queries_for(item, args.queries):
            try:
                results = populate(args.server, args.view_id, query, args.limit, args.timeout)
                stats.append(score_query(item, query, results, args.show_top))
            except Exception as exc:  # noqa: BLE001 - continue collecting fixture diagnostics.
                stats.append(error_stats(item, query, str(exc)))

    print_report(stats, args.limit)
    return 0


def load_fixture(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def queries_for(item: dict[str, Any], mode: str) -> list[str]:
    name = str(item["element"])
    aliases = [str(value) for value in item.get("aliases", [])]
    if mode == "name":
        return [name]
    if mode == "aliases":
        return aliases or [name]
    out: list[str] = []
    for value in [name, *aliases]:
        if value and value not in out:
            out.append(value)
    return out


def populate(server: str, view_id: int, query: str, limit: int, timeout: float) -> list[dict[str, Any]]:
    base = server.rstrip("/")
    params = urllib.parse.urlencode({"q": query, "limit": str(limit)})
    url = f"{base}/api/views/{view_id}/populate?{params}"
    with urllib.request.urlopen(url, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body)
    return list(parsed.get("results", []))


def score_query(item: dict[str, Any], query: str, results: list[dict[str, Any]], show_top: int) -> QueryStats:
    expected = expected_paths(item)
    rejects = [normalize_path(row["path"]) for row in item.get("reject_examples", []) if row.get("path")]
    result_paths = [result_path(result) for result in results]
    hits = [path for path in expected if any(path_matches(path, result) for result in result_paths)]
    reject_hits = [result for result in result_paths if any(path_matches(reject, result) for reject in rejects)]
    missed = [path for path in expected if path not in hits]
    return QueryStats(
        element=str(item["element"]),
        query=query,
        hit_count=len(hits),
        expected_count=len(expected),
        reject_count=len(reject_hits),
        top_paths=result_paths[:show_top],
        missed=missed,
    )


def error_stats(item: dict[str, Any], query: str, error: str) -> QueryStats:
    return QueryStats(
        element=str(item["element"]),
        query=query,
        hit_count=0,
        expected_count=len(expected_paths(item)),
        reject_count=0,
        top_paths=[],
        missed=expected_paths(item),
        error=error,
    )


def expected_paths(item: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for section in ("expected_folders", "expected_files"):
        for row in item.get(section, []):
            path = normalize_path(row.get("path", ""))
            if path and path not in out:
                out.append(path)
    return out


def result_path(result: dict[str, Any]) -> str:
    path = result.get("file_path") or result.get("name") or ""
    return normalize_path(str(path))


def normalize_path(path: str) -> str:
    path = path.strip().replace("\\", "/")
    marker = "/apps/diag/tld/"
    if marker in path:
        path = path.split(marker, 1)[1]
    if path.startswith("/Users/"):
        parts = PurePosixPath(path).parts
        if "tld" in parts:
            idx = parts.index("tld")
            path = "/".join(parts[idx + 1 :])
    path = path.strip("/")
    if path.endswith("/"):
        path = path[:-1]
    return path


def path_matches(expected: str, actual: str) -> bool:
    if not expected or not actual:
        return False
    return actual == expected or actual.startswith(expected + "/")


def print_report(stats: list[QueryStats], limit: int) -> None:
    if not stats:
        print("No fixture rows evaluated.")
        return
    width = max(len(row.element) for row in stats)
    query_width = min(max(len(row.query) for row in stats), 34)
    total_hits = 0
    total_expected = 0
    total_rejects = 0
    query_hits = 0
    print(f"Populate fixture eval (hit if expected folder/file appears in top {limit})")
    print(f"{'element':<{width}}  {'query':<{query_width}}  hit/exp  rejects  top")
    print("-" * (width + query_width + 34))
    for row in stats:
        total_hits += row.hit_count
        total_expected += row.expected_count
        total_rejects += row.reject_count
        if row.hit_count > 0:
            query_hits += 1
        query = row.query if len(row.query) <= query_width else row.query[: query_width - 1] + "…"
        top = "ERROR: " + row.error if row.error else ", ".join(row.top_paths) if row.top_paths else "-"
        print(f"{row.element:<{width}}  {query:<{query_width}}  {row.hit_count:>3}/{row.expected_count:<3}  {row.reject_count:>7}  {top}")
    recall = total_hits / total_expected if total_expected else 0.0
    hit_rate = query_hits / len(stats)
    print("-" * (width + query_width + 34))
    print(f"queries={len(stats)} query_hit_rate={hit_rate:.1%} expected_path_recall={recall:.1%} reject_hits={total_rejects}")
    misses = [(row.element, row.query, row.missed[:3]) for row in stats if row.hit_count == 0]
    if misses:
        print("misses:")
        for element, query, missed in misses[:10]:
            print(f"  - {element} / {query}: wanted {', '.join(missed) if missed else 'expected path'}")


if __name__ == "__main__":
    sys.exit(main())
