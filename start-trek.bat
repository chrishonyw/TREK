@echo off
rem Windows convenience wrapper only; the portable command is `npm run start:local`.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --ignore-scripts
  pushd client
  node scripts/patch-maplibre.mjs
  popd
)
start "" http://localhost:5173
npm run start:local
