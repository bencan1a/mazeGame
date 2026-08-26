#!/usr/bin/env bash
# Pulls the corpus the spike measured. Nothing here is vendored: the art is
# third-party and only ever read to produce the numbers in the write-up.
set -euo pipefail
out="${1:-/tmp/line-art-corpus}"
mkdir -p "$out/line" "$out/solid"

line=(apple banana bike bird car carrot cat cherry croissant egg fish ghost grape house leaf rabbit snail turtle)
for name in "${line[@]}"; do
  curl -fsS -o "$out/line/$name.svg" \
    "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/$name.svg"
done
curl -fsS -o "$out/line/LICENSE" https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE

for name in apple bird cat fish rabbit; do
  curl -fsS -o "$out/solid/$name.svg" \
    "https://raw.githubusercontent.com/Templarian/MaterialDesign-SVG/master/svg/$name.svg"
done
curl -fsS -o "$out/solid/LICENSE" https://raw.githubusercontent.com/Templarian/MaterialDesign-SVG/master/LICENSE

echo "corpus in $out"

# Phosphor: the set the spike recommends, plus the metadata its keep-list needs.
mkdir -p "$out/phosphor"
curl -fsS -o "$out/phosphor/index.mjs" \
  "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/dist/index.mjs"
curl -fsS -o "$out/phosphor/LICENSE" \
  "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/LICENSE"
npx tsx spikes/line-art/curate.ts --meta "$out/phosphor/index.mjs" --sample 48 |
  while read -r name; do
    curl -fsS -o "$out/phosphor/$name.svg" \
      "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets/thin/$name-thin.svg"
  done
