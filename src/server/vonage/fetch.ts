import { vonageAccessToken, refreshVonageToken } from "./token";

/* ── One request to VBC, with the token question settled ───────────────
 * VBC tokens do not expire when VBC says they do, and they do not expire at
 * the same time for every API. A token the login call reports as good for
 * 1435 minutes:
 *
 *   Telephony v3     accepted for hours
 *   Provisioning v1  accepted for hours
 *   Reports v1       refused after a few minutes, with
 *                    {"title": "Problem with provided token"}
 *
 * That was measured, not inferred: the same token string, in the same
 * second, answered 200 on Telephony and 401 on Reports; a token minted
 * moments earlier answered 200 on both. Minting a replacement does not
 * invalidate the old one, so there is no cost to other processes in doing
 * it — which was worth checking, because it would otherwise be a way to
 * knock the live board offline every five minutes.
 *
 * The cost of NOT doing it was silent: the call sync would get its 401,
 * report "no calls fetched", and wait another five minutes. A stretch of
 * calls simply never arrived, and the panel showed a healthy integration.
 *
 * So a 401 is treated as "this token is too old for this API" — mint once,
 * retry once. Twice means the credentials really are refused, and that is
 * the caller's to report so the halt machinery can stop the retrying.
 * ────────────────────────────────────────────────────────────────── */

export class VonageAuthError extends Error {
  constructor() {
    super("no access token");
  }
}

/**
 * Fetches from VBC with a valid token, retrying once on 401.
 *
 * Throws VonageAuthError when no token can be had at all — that means the
 * integration is halted or the credentials are missing, and the caller
 * should say so rather than treat it as an empty result.
 */
export async function vonageFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await vonageAccessToken();
  if (!token) throw new VonageAuthError();

  const send = (bearer: string) =>
    fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers, Authorization: `Bearer ${bearer}` },
    });

  const first = await send(token);
  if (first.status !== 401) return first;

  /* Only the body of a 401 distinguishes "too old" from "refused", and the
     two VBC gateways word it differently. Rather than match on either, the
     retry is attempted once for any 401: a fresh token that is still
     refused answers the question definitively. */
  const fresh = await refreshVonageToken();
  if (!fresh || fresh === token) return first;

  return send(fresh);
}
