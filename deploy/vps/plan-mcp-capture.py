#!/usr/bin/env python3
"""Validate/print a future capture plan. Never build, deploy, connect or arm it."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import re


def make_plan(commit=None, start=None, end=None, now=None):
    policy = {"max_window_seconds": 600, "max_requests": 1024, "max_records": 2051,
              "max_record_bytes": 512, "max_application_bytes_per_isolate": 1050112}
    if start is None and end is None:
        return {"status": "unarmed", "production_changed": False, "defines": {}, "policy": policy}
    if not start or not end:
        raise ValueError("both_window_endpoints_required")
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("full_source_commit_required")
    try:
        lower, upper = (datetime.fromisoformat(x.replace("Z", "+00:00")) for x in (start, end))
    except (ValueError, TypeError):
        raise ValueError("invalid_window_timestamp") from None
    if lower.tzinfo is None or upper.tzinfo is None:
        raise ValueError("explicit_timezone_required")
    lower, upper = lower.astimezone(timezone.utc), upper.astimezone(timezone.utc)
    if not 0 < (upper - lower).total_seconds() <= 600:
        raise ValueError("window_must_be_positive_and_at_most_ten_minutes")
    if lower < (now or datetime.now(timezone.utc)) + timedelta(minutes=10):
        raise ValueError("at_least_ten_minutes_preparation_required")
    return {"status": "future_plan_only", "production_changed": False, "source_commit": commit,
            "requires_coordinated_deployment_and_probe": True,
            "defines": {"__AGENTPARTY_MCP_DIAGNOSTICS_FROM__": lower.isoformat().replace("+00:00", "Z"),
                        "__AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__": upper.isoformat().replace("+00:00", "Z")},
            "policy": policy}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit")
    parser.add_argument("--from", dest="start")
    parser.add_argument("--until", dest="end")
    args = parser.parse_args()
    try:
        print(json.dumps(make_plan(args.source_commit, args.start, args.end), indent=2))
    except ValueError as error:
        parser.error(str(error))
