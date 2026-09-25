/**
 * Vonage Integration Suite (VIS) Webhook Manager
 *
 * Official VBC VIS Webhooks API:
 *   - Create: POST https://api.vonage.com/t/vbc.prod/vis/v1/self/webhooks
 *   - List:   GET  https://api.vonage.com/t/vbc.prod/vis/v1/self/webhooks
 *   - Renew:  PUT  https://api.vonage.com/t/vbc.prod/vis/v1/self/webhooks/{id}/renew
 *   - Delete: DELETE https://api.vonage.com/t/vbc.prod/vis/v1/self/webhooks/{id}
 */

import { vonageAccessToken } from "./token";
import { vonageEndpoints } from "./endpoints";

export interface VisWebhook {
  id: string;
  url: string;
  events: string[];
  signingAlgo?: string;
  signingKey?: string;
  metadataPolicy?: string;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
}


export async function registerVisWebhook(targetUrl: string, signingSecret?: string) {
  const token = await vonageAccessToken();
  if (!token) throw new Error("Could not obtain Vonage access token.");

  /* Registering with a known constant would mean every webhook we later
     "verify" is signed with a secret anyone reading this file already has.
     Refuse to register rather than stand up a check that proves nothing. */
  const signingKey = signingSecret || process.env.VONAGE_SIGNATURE_SECRET;
  if (!signingKey) {
    throw new Error("VONAGE_SIGNATURE_SECRET is not set — refusing to register an unverifiable webhook.");
  }

  const payload = {
    url: targetUrl,
    events: ["CALL"],
    signingAlgo: "HMAC_SHA256",
    signingKey,
    metadataPolicy: "BODY",
  };

  const hosts = [vonageEndpoints.visWebhooks()];

  let lastError = "";
  for (const host of hosts) {
    try {
      const res = await fetch(host, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (res.ok) {
        return JSON.parse(text);
      } else {
        lastError = `[${res.status}] ${text}`;
      }
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  throw new Error(`Failed to register VIS webhook: ${lastError}`);
}

/* A VIS subscription expires — Vonage stops delivering and nothing in our
   logs would say why, because a webhook that is never sent looks exactly
   like a quiet phone. Renewing is a documented call, so it is here rather
   than a diary note. */
export async function renewVisWebhook(id: string) {
  const token = await vonageAccessToken();
  if (!token) throw new Error("Could not obtain Vonage access token.");

  const res = await fetch(
    vonageEndpoints.visWebhookRenew(id),
    { method: "PUT", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );

  const text = await res.text();
  if (!res.ok) throw new Error(`Failed to renew webhook ${id}: [${res.status}] ${text}`);
  return text ? JSON.parse(text) : { id, renewed: true };
}

export async function deleteVisWebhook(id: string) {
  const token = await vonageAccessToken();
  if (!token) throw new Error("Could not obtain Vonage access token.");

  const res = await fetch(
    vonageEndpoints.visWebhook(id),
    { method: "DELETE", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );

  if (!res.ok) throw new Error(`Failed to delete webhook ${id}: [${res.status}] ${await res.text()}`);
  return { id, deleted: true };
}

export async function listVisWebhooks() {
  const token = await vonageAccessToken();
  if (!token) throw new Error("Could not obtain Vonage access token.");

  const res = await fetch(vonageEndpoints.visWebhooks(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list webhooks: [${res.status}] ${text}`);
  }

  return res.json();
}
