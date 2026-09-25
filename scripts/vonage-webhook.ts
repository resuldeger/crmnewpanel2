/* ── VIS webhook subscription, from the command line ───────────────────
 * The registration call existed but nothing ever invoked it, so the
 * webhook could only have been created by hand. This is the way in.
 *
 *   npm run vonage:webhook list
 *   npm run vonage:webhook register https://<host>/api/webhooks/vonage/call
 *   npm run vonage:webhook renew <id>
 *   npm run vonage:webhook delete <id>
 *
 * A subscription expires, so `renew` is the one to keep in mind — see the
 * note in visWebhook.ts about why a lapsed one is invisible.
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import {
  registerVisWebhook,
  listVisWebhooks,
  renewVisWebhook,
  deleteVisWebhook,
} from "../src/server/vonage/visWebhook";

const [command, argument] = process.argv.slice(2);

function usage(): never {
  console.log(`
  list                     show the account's current subscriptions
  register <url>           create one pointing at <url>
  renew <id>               extend one before it lapses
  delete <id>              remove one
`);
  process.exit(1);
}

async function main() {
  switch (command) {
    case "list": {
      const hooks = await listVisWebhooks();
      console.log(JSON.stringify(hooks, null, 2));
      break;
    }

    case "register": {
      if (!argument) {
        console.error("A public URL is required — Vonage has to be able to reach it.");
        usage();
      }
      if (argument.startsWith("http://localhost") || argument.includes("127.0.0.1")) {
        console.error("Vonage cannot reach localhost. Use the tunnel or the stage domain.");
        process.exit(1);
      }
      if (!process.env.VONAGE_SIGNATURE_SECRET) {
        console.error("VONAGE_SIGNATURE_SECRET is not set. Registering without it would");
        console.error("stand up a signature check that verifies nothing — refusing.");
        process.exit(1);
      }
      console.log(`Registering ${argument} …`);
      console.log(JSON.stringify(await registerVisWebhook(argument), null, 2));
      break;
    }

    case "renew": {
      if (!argument) usage();
      console.log(JSON.stringify(await renewVisWebhook(argument), null, 2));
      break;
    }

    case "delete": {
      if (!argument) usage();
      console.log(JSON.stringify(await deleteVisWebhook(argument), null, 2));
      break;
    }

    default:
      usage();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
