/**
 * PM2 process definitions.
 *
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup     # survive a reboot
 *   pm2 logs cleo-worker
 *
 * Three processes, deliberately separate:
 *  · web       — Next, serves the booking flow, console and API
 *  · worker    — background jobs; must not compete with request handling
 *  · realtime  — socket gateway; one long-lived LISTEN connection
 *
 * The worker runs as a SINGLE instance. Its jobs claim rows with
 * FOR UPDATE SKIP LOCKED so a second instance would be safe, but one is
 * enough and keeps the logs readable.
 */
module.exports = {
  apps: [
    {
      name: "cleo-web",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: __dirname + "/..",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
      error_file: "logs/web.err.log",
      out_file: "logs/web.out.log",
      time: true,
    },
    {
      name: "cleo-worker",
      script: "node_modules/.bin/tsx",
      args: "scripts/worker.ts",
      cwd: __dirname + "/..",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      // A job that wedges is worse than one that restarts.
      max_memory_restart: "400M",
      restart_delay: 5000,
      error_file: "logs/worker.err.log",
      out_file: "logs/worker.out.log",
      time: true,
    },
    {
      name: "cleo-realtime",
      script: "node_modules/.bin/tsx",
      args: "scripts/realtime.ts",
      cwd: __dirname + "/..",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      restart_delay: 3000,
      error_file: "logs/realtime.err.log",
      out_file: "logs/realtime.out.log",
      time: true,
    },
  ],
};
