# Dheeraj Wholesale product foundation

This Node 24 app starts with an empty shop and keeps one shared workspace in SQLite. The existing hosted demo is separate.

## Run locally

From the repository root in PowerShell:

```powershell
$env:SHOP_PASSWORD = Read-Host 'Choose a unique owner password (at least 16 characters)'
$env:SHOP_DB = Join-Path $PWD 'wholesale.sqlite'
node product/server.mjs
```

Open http://localhost:3000 and sign in as `owner`. Keep the database outside version control. For cross-device testing, run the server behind an HTTPS reverse proxy with a persistent disk. The server listens on loopback by design. Back up the database using SQLite's backup API or while the server is stopped.

## Current limits

This is a single-owner pilot foundation. SQLite stores a versioned workspace snapshot and rejects concurrent stale saves. Business rules still run in the browser, and the server checks the snapshot's structure. Before entering live data, move stock and financial posting rules to server-side commands, add an audit trail and tested backups, and confirm the shop's GST invoice requirements. The invoice screen is still marked as a demo.
