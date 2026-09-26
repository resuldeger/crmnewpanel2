/* ── Where Vonage lives ────────────────────────────────────────────────
 * VBC answers on two hosts and they are not interchangeable in the way
 * one might hope:
 *
 *   api.vonage.com                      the public gateway; serves the
 *                                       Reports and VIS APIs
 *   api.auth.prod.vonagenetworks.net    the same tenant path, and the host
 *                                       the working PHP client uses; the
 *                                       only one observed answering
 *                                       Telephony and Provisioning
 *   apimanager.auth.prod…               issues tokens, nothing else
 *
 * Reports answers on both. Rather than leave that to whichever host each
 * module happened to be written against, every path is built here, so a
 * host that stops answering is one edit instead of a search.
 *
 * Overridable for a sandbox tenant, but defaulted, because a missing
 * variable should not silently point production at nothing.
 * ────────────────────────────────────────────────────────────────── */

const API = process.env.VONAGE_API_HOST ?? "https://api.auth.prod.vonagenetworks.net";
const AUTH = process.env.VONAGE_AUTH_HOST ?? "https://apimanager.auth.prod.vonagenetworks.net";

/** The tenant every VBC path is namespaced under. */
const TENANT = "/t/vbc.prod";

export const vonageEndpoints = {
  token: () => `${AUTH}${TENANT}/oauth2/token`,

  /** Calls in progress, account-wide. */
  activeCalls: (accountId: string) =>
    `${API}${TENANT}/telephony/v3/cc/accounts/${accountId}/calls`,

  /* Placing a call. Same path as the list, by POST:
       { from: { type: "extension", destination: "447" },
         to:   { type: "pstn",      destination: "+14045550101" } }
     `type` is one of extension, device, pstn, feature_code. The agent's
     phone rings first; answering it dials the customer. */
  placeCall: (accountId: string) =>
    `${API}${TENANT}/telephony/v3/cc/accounts/${accountId}/calls`,

  /** Acts on one live call — the only endpoint here that is not read-only. */
  callActions: (accountId: string, callId: string) =>
    `${API}${TENANT}/telephony/v3/cc/accounts/${accountId}/calls/${encodeURIComponent(callId)}/actions`,

  /** Extension → user → branch → DID. */
  extensions: (accountId: string) =>
    `${API}${TENANT}/provisioning/v1/api/accounts/${accountId}/extensions`,

  /** The permanent record of calls that have finished. */
  callLogs: (accountId: string) =>
    `${API}${TENANT}/reports/v1/accounts/${accountId}/call-logs`,

  /* ── Call recordings ───────────────────────────────────────────────
   * Reports says `recorded: true` and carries no handle to the audio, so
   * the recordings live behind their own API. Company Call Recording is
   * the rule-based one an administrator configures — which is what these
   * studios run, since every call in the log comes back recorded.
   *
   * The account answers 403 here until the API user is granted the
   * Company Call Recording permission in VBC:
   *   "User is not authorized to search CCR recordings for this account"
   * The path is right; the permission is not ours to grant from code.
   * ────────────────────────────────────────────────────────────── */
  companyRecordings: (accountId: string) =>
    `${API}${TENANT}/call_recording/v1/api/accounts/${accountId}/company_call_recordings`,
  companyRecording: (accountId: string, recordingId: string) =>
    `${API}${TENANT}/call_recording/v1/api/accounts/${accountId}/company_call_recordings/${encodeURIComponent(recordingId)}`,
  /** The employee-initiated kind, per user. */
  userRecordings: (accountId: string, userId: string) =>
    `${API}${TENANT}/call_recording/v1/api/accounts/${accountId}/users/${encodeURIComponent(userId)}/call_recordings`,

  /** VIS webhook subscriptions — scoped to the authenticated user. */
  visWebhooks: () => `${API}${TENANT}/vis/v1/self/webhooks`,
  visWebhook: (id: string) => `${API}${TENANT}/vis/v1/self/webhooks/${encodeURIComponent(id)}`,
  visWebhookRenew: (id: string) =>
    `${API}${TENANT}/vis/v1/self/webhooks/${encodeURIComponent(id)}/renew`,
} as const;
