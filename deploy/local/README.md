# Running the worker on this Mac

The server uses systemd (`deploy/cleo-worker.service`) or pm2
(`deploy/ecosystem.config.cjs`). Neither exists on macOS, so development had
the worker started by hand in a terminal — which means it stopped whenever
that terminal closed, and nothing said so. A whole day of calls went missing
that way.

`launchd` is the macOS equivalent. Install:

```
cp deploy/local/com.cleopatra.worker.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cleopatra.worker.plist
```

Check, stop, start:

```
launchctl list | grep cleopatra
launchctl unload ~/Library/LaunchAgents/com.cleopatra.worker.plist
launchctl load   ~/Library/LaunchAgents/com.cleopatra.worker.plist
tail -f /tmp/cleopatra-worker.log
```

Or ask the console: `/admin/health` says when the worker last checked in,
and `npm run health` prints the same thing in a terminal.

Two things the plist hard-codes, so check them if you move the project or
change node version:

- the absolute path to `node` (launchd gets no shell, so no nvm and no PATH)
- the absolute path to the project

It does NOT start Postgres, Redis, the realtime gateway or Next. Those are
still `npm run db:up`, `npm run realtime` and `npm run dev`.
