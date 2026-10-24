#!/usr/bin/env bash
# Bundles src/ into dist/:
#   dist/index.html    standalone page for any static host (Netlify etc.). With SUPABASE_URL and
#                      SUPABASE_ANON_KEY set it has sign-in and saves to Supabase; without them it
#                      saves to browser storage only
#   dist/artifact.html body-only page for publishing as a claude.ai Artifact, saves to the artifact database
set -euo pipefail
cd "$(dirname "$0")/.."
cloud_config() {
  # The anon key is designed to be public; row-level security in supabase/migrations protects the data.
  if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
    cp vendor/supabase-js/supabase-*.umd.js dist/supabase.js
    node -e 'process.stdout.write("<script>window.LEDGERLINE_CONFIG = " + JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY }).replace(/</g, "\\u003c") + ";</script>\n<script src=\"supabase.js\"></script>\n")'
    echo "Cloud mode: sign-in and Supabase storage enabled" >&2
  else
    echo "Local mode: set SUPABASE_URL and SUPABASE_ANON_KEY to enable sign-in" >&2
  fi
}
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
rm -rf dist && mkdir -p dist
body > dist/artifact.html
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
  cloud_config
  body
  echo '</body></html>'
} > dist/index.html
echo "Built dist/index.html and dist/artifact.html"
