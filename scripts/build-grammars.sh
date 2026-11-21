#!/usr/bin/env bash
# Rebuild the WebAssembly parsers in grammars/ from their sources.
#
# Dart, Kotlin and Swift have no prebuilt native tree-sitter binding: installing
# one compiles C on the user's machine, which fails without a compiler. Their
# WebAssembly builds load in any Node through web-tree-sitter, so they are built
# here once and shipped in the package.
#
# Sources are pinned GitHub commits, not npm: the npm packages lag years behind
# (tree-sitter-dart on npm predates Dart 3 and fails on 7% of real Dart files).
# The tree-sitter CLI version must match the web-tree-sitter dependency, or the
# files will not load. To update a grammar, change its commit and re-run.
#
# Needs curl, and emcc (Emscripten) or Docker. Usage: bash scripts/build-grammars.sh
set -euo pipefail

CLI_VERSION=0.27.2 # keep equal to web-tree-sitter in package.json
# name repository commit. Swift commits its generated parser only on its
# *-with-generated-files tags; it stays on 0.7.3 because 0.7.4's scanner calls
# fwrite, stderr and exit, which WebAssembly parsers do not have.
GRAMMARS=(
  "dart UserNobody14/tree-sitter-dart 0038280b774b65c1b89ba7fec50624d8baed9fe1"
  "kotlin fwcd/tree-sitter-kotlin d6af96d2e23ef0a8ff5ab512864378cf08fba311"
  "swift alex-pinkus/tree-sitter-swift 31d17fe7e818a2048c808b5c6fdc2dc792f4f5b5"
)

OUT="$(cd "$(dirname "$0")/.." && pwd)/grammars"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
cat > package.json <<JSON
{ "private": true, "allowScripts": { "tree-sitter-cli": true } }
JSON
npm install --no-audit --no-fund "tree-sitter-cli@$CLI_VERSION" >/dev/null

for entry in "${GRAMMARS[@]}"; do
  read -r name repo commit <<<"$entry"
  mkdir "$name"
  curl -fsSL "https://codeload.github.com/$repo/tar.gz/$commit" | tar xz -C "$name" --strip-components 1
  (cd "$name" && "$WORK/node_modules/.bin/tree-sitter" build --wasm -o "$OUT/tree-sitter-$name.wasm" .)
  cp "$name/LICENSE" "$OUT/LICENSE-$name"
  echo "built tree-sitter-$name.wasm from $repo@${commit:0:12}"
done
