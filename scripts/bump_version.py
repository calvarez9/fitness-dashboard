#!/usr/bin/env python3
"""Bump the cache-busting version across the dashboard.

Why this exists: docs/index.html versions its top-level <link>/<script>
tags with a ?v=... query string, but the ES modules those files import
from each other (app.js -> workouts.js -> exerciseLibrary.js, etc.) are
plain relative specifiers with no version on them. A browser can end up
serving a stale cached copy of one of those nested files even right after
fetching a brand-new, correctly-versioned app.js -- exactly what happened
when loadJointLoad()'s new no-argument signature in a fresh app.js called
into a stale cached workouts.js still expecting (start, end).

This script versions every same-directory ES module import too, so a
version bump invalidates the whole dependency graph at once, not just the
one file index.html happens to link directly. Run it every time you're
about to deploy a JS/CSS change:

    python3 scripts/bump_version.py 20260826a

Pass any string; the convention so far has been YYYYMMDD + a letter
suffix for same-day bumps (a, b, ... z, za, zb, ...).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "docs"

def main():
    if len(sys.argv) != 2:
        print("usage: bump_version.py <new-version>", file=sys.stderr)
        sys.exit(1)
    new_v = sys.argv[1]

    # index.html's own top-level tags
    index = ROOT / "index.html"
    text = index.read_text()
    text, n1 = re.subn(r'\?v=[A-Za-z0-9]+"', f'?v={new_v}"', text)
    index.write_text(text)

    # every relative ES module import/export-from across docs/js/**/*.js
    n2 = 0
    for js_file in ROOT.glob("js/**/*.js"):
        text = js_file.read_text()
        new_text, count = re.subn(
            r'(from\s+["\'])(\.\.?/[^"\']+\.js)(\?v=[A-Za-z0-9]+)?(["\'])',
            lambda m: f"{m.group(1)}{m.group(2)}?v={new_v}{m.group(4)}",
            text,
        )
        if count:
            js_file.write_text(new_text)
            n2 += count

    print(f"index.html: {n1} tag(s) -> v={new_v}")
    print(f"js imports: {n2} import(s) -> v={new_v}")

if __name__ == "__main__":
    main()
