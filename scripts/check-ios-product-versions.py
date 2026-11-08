#!/usr/bin/env python3
"""Fail closed before signing: python3 scripts/check-ios-product-versions.py path/to/Wafra.app."""
import plistlib
import sys
from pathlib import Path


def verify(app):
    app = Path(app)
    with (app / "Info.plist").open("rb") as f:
        host = plistlib.load(f)["CFBundleVersion"]
    if not isinstance(host, str) or not host:
        raise ValueError("Host CFBundleVersion is missing")
    extensions = sorted((app / "PlugIns").glob("*.appex"))
    if not extensions:
        raise ValueError("No extensions found; widget equality was not verified")
    for extension in extensions:
        with (extension / "Info.plist").open("rb") as f:
            version = plistlib.load(f).get("CFBundleVersion")
        if version != host:
            raise ValueError(f"{extension.name}: CFBundleVersion {version!r} differs from host {host!r}")
    return host, len(extensions)


if __name__ == "__main__":
    host, count = verify(sys.argv[1])
    print(f"Verified host and {count} extension(s): CFBundleVersion={host}")
