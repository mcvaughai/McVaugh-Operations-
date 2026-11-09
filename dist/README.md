# dist/mch-ops-hub.html

This is the old MCH Operations Hub page, regenerated from McVaugh Operations World.
Copy it into the **AI Tools Shared** folder (overwrite the copy that is there) whenever
you pull a new version.

It is generated, not edited. Change things in the world — the Open view, Procedures,
Handover — and the hub is rebuilt from that. Anything typed into this file by hand is
lost the next time it is regenerated.

Three ways to get a current copy:

1. **Easiest — git pull.** This file is refreshed and committed whenever the world's
   data changes. `git pull`, then copy `dist\mch-ops-hub.html` into AI Tools Shared.
2. **From the app.** Run the world, open **Integrations**, and use the hub download.
3. **Automatic.** Point the app at the shared folder and it rewrites the file after every
   change:

   ```powershell
   $env:MOW_OPSHUB_PATH = "<path to AI Tools Shared>\mch-ops-hub.html"
   node server\server.js
   ```

   The app refuses to overwrite a hub file it did not generate, so the first time, copy
   this file into that folder yourself and then point `MOW_OPSHUB_PATH` at it.

What is in this build (9 November 2026): 53 procedures published — 29 current, 4 stale,
9 superseded, 11 legacy. Framed mirrors is retired and no longer published. The change
order log is replaced by "Change order costs on a job" (.2 / .3 extra cost codes).
Nothing is assigned to Maria or to the purchasing list.
