#!/usr/bin/env bash
# Bundles src/ into two single-file pages:
#   dist/index.html    standalone page for any static host (Netlify etc.), saves to browser storage
#   dist/artifact.html body-only page for publishing as a claude.ai Artifact, saves to the artifact database
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
body() {
  cat <<'H'
<title>Ledgerline</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=IBM+Plex+Mono:wght@400;500&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
H
  cat src/style.css
  echo '</style>'
  echo '<div id="root"></div>'
  echo '<script>'
  cat src/engine.js src/sample.js src/app.js
  echo '</script>'
}
body > dist/artifact.html
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
  body
  echo '</body></html>'
} > dist/index.html
echo "Built dist/index.html and dist/artifact.html"
