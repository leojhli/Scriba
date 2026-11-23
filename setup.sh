#!/bin/bash
# Scriba setup for this Mac. Run with:  bash ~/Scriba/setup.sh
cd "$HOME/Scriba" || { echo "Can't find ~/Scriba"; exit 1; }

step() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\nCopy the lines above and send them to Claude.\n' "$1"; exit 1; }

step "1/5 Installing Wasp 0.22 (the version Scriba is built for)"
npm i -g --allow-scripts=@wasp.sh/wasp-cli "@wasp.sh/wasp-cli@0.22" || fail "Wasp install failed"
wasp version || fail "wasp command not found after install"

cd wasp-app || fail "No wasp-app folder"
[ -f .env.server ] || fail ".env.server is missing in ~/Scriba/wasp-app"

step "2/5 Installing project dependencies"
wasp install 2>/dev/null || echo "(no separate install step in this Wasp version, continuing)"

step "3/5 Setting up the database"
wasp db migrate-dev || fail "Database setup failed"

step "4/5 Loading the cached demo video"
wasp db seed || echo "(seed skipped or already loaded, continuing)"

step "5/5 Building the Chrome extension"
(cd ../extension && npm i && npm run build) || fail "Extension build failed"

printf '\n\033[1;32m✓ Setup done. Starting the server now. Leave this window open.\033[0m\n'
printf 'Then in Chrome: chrome://extensions → Developer mode → Load unpacked → ~/Scriba/extension\n\n'
wasp start
