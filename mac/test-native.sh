#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p target/swift/tests
xcrun swiftc -swift-version 5 mac/Native/Policy.swift mac/Tests/PolicyTests.swift -o target/swift/tests/policy-tests
target/swift/tests/policy-tests
# Type-check AppKit/WebKit integration against the installed macOS SDK.
xcrun swiftc -swift-version 5 -typecheck -target "$(uname -m)-apple-macosx12.0" \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" mac/Native/Policy.swift mac/Native/Updater.swift mac/Native/main.swift
