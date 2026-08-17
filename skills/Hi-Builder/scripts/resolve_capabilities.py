#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from core import (
    build_capability_bundle,
    ContractError,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="输出AI可消费的精简页面能力")
    parser.add_argument("--industry", required=True)
    parser.add_argument("--product", required=True)
    parser.add_argument("--page-type", required=True)
    args = parser.parse_args()

    try:
        result = build_capability_bundle(
            args.industry, args.product, args.page_type
        )
    except ContractError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
