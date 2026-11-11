#!/usr/bin/env python3
"""Fail closed before upload: python3 scripts/check-ios-product-versions.py path/to/Wafra.app."""
import plistlib
import re
import sys
from pathlib import Path


VERSION_KEYS = ("CFBundleVersion", "CFBundleShortVersionString")


def read_versions(product):
    with (product / "Info.plist").open("rb") as f:
        info = plistlib.load(f)
    services = info.get("NSBonjourServices")
    if isinstance(services, list) and "_expo._tcp" in services:
        raise ValueError(f"{product.name}: Release product contains Expo discovery service _expo._tcp")
    description = info.get("NSLocalNetworkUsageDescription")
    if isinstance(description, str) and "Expo Dev Launcher" in description:
        raise ValueError(f"{product.name}: Release product contains Expo Dev Launcher local-network wording")
    versions = {}
    for key in VERSION_KEYS:
        value = info.get(key)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", value):
            raise ValueError(f"{product.name}: {key} must be a resolved numeric version, got {value!r}")
        versions[key] = value
    return versions


def verify(app):
    app = Path(app)
    host = read_versions(app)
    extensions = sorted((app / "PlugIns").glob("*.appex"))
    if not extensions:
        raise ValueError("No extensions found; widget equality was not verified")
    for extension in extensions:
        versions = read_versions(extension)
        for key in VERSION_KEYS:
            if versions[key] != host[key]:
                raise ValueError(f"{extension.name}: {key} {versions[key]!r} differs from host {host[key]!r}")
    return host, len(extensions)


if __name__ == "__main__":
    host, count = verify(sys.argv[1])
    print(f"Verified host and {count} extension(s): " + ", ".join(f"{key}={host[key]}" for key in VERSION_KEYS))
