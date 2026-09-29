/* Deleting a colleague, and what goes with them.
 *
 * Deleting someone who had invited a colleague answered 500: staff_invites
 * .invited_by had no delete rule, so Postgres refused and the panel showed
 * "the server is down" for an ordinary removal. The route also ran five
 * deletes outside a transaction to clear rows the database already cascades,
 * so a failure partway left an account with no sessions and no scopes that
 * could still be seen, edited and assigned work.
 *
 *   npx tsx scripts/dev/test-staff-delete.ts
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { locationScopes, locations, sessions, staff, staffInvites } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
let bad = 0;
const check = (l: string, ok: boolean, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`); if (!ok) bad++; };

async function main() {
  const [me] = await db.select().from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  const [studio] = await db.select({ id: locations.id }).from(locations).limit(1);
  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({ id: sessionId, staffId: me.id, expiresAt: new Date(Date.now() + 9e5), userAgent: "del-test" });
  const cookie = `cleo_session=${token}`;

  const [victim] = await db.insert(staff).values({
    name: "Delete Me", email: `del-me-${Date.now()}@example.invalid`,
    roleId: "branch_manager", scopeAll: false, active: true,
  }).returning({ id: staff.id });
  const [invitee] = await db.insert(staff).values({
    name: "Invited By Victim", email: `del-inv-${Date.now()}@example.invalid`,
    roleId: "callcenter_agent", scopeAll: true, active: true,
  }).returning({ id: staff.id });

  await db.insert(locationScopes).values({ staffId: victim.id, locationId: studio.id });
  await db.insert(staffInvites).values({
    tokenHash: `del-test-${Date.now()}`, staffId: invitee.id, invitedBy: victim.id,
    expiresAt: new Date(Date.now() + 864e5),
  });
  const vSess = createHash("sha256").update(randomBytes(32)).digest("hex");
  await db.insert(sessions).values({ id: vSess, staffId: victim.id, expiresAt: new Date(Date.now() + 9e5) });

  try {
    console.log("\n1. someone who invited a colleague can be deleted");
    const res = await fetch(`${BASE}/api/crm/staff?id=${victim.id}`, { method: "DELETE", headers: { cookie } });
    check("200", res.status === 200, `${res.status} ${(await res.text()).slice(0, 120)}`);

    console.log("\n2. everything that hangs off them went with them");
    check("staff row gone", (await db.select().from(staff).where(eq(staff.id, victim.id))).length === 0);
    check("scopes cascaded", (await db.select().from(locationScopes).where(eq(locationScopes.staffId, victim.id))).length === 0);
    check("their session cascaded", (await db.select().from(sessions).where(eq(sessions.id, vSess))).length === 0);

    console.log("\n3. the invite survives, minus the sender");
    const inv = await db.select().from(staffInvites).where(eq(staffInvites.staffId, invitee.id));
    check("invite kept", inv.length === 1);
    check("invited_by nulled", inv[0]?.invitedBy === null, String(inv[0]?.invitedBy));

    console.log("\n4. the last super admin is refused");
    const self = await fetch(`${BASE}/api/crm/staff?id=${me.id}`, { method: "DELETE", headers: { cookie } });
    check("409", self.status === 409, String(self.status));

    console.log("\n5. no session, no delete");
    const anon = await fetch(`${BASE}/api/crm/staff?id=${invitee.id}`, { method: "DELETE" });
    check("401/403", anon.status === 401 || anon.status === 403, String(anon.status));
  } finally {
    await db.delete(staff).where(like(staff.email, "del-me-%@example.invalid"));
    await db.delete(staff).where(like(staff.email, "del-inv-%@example.invalid"));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
  console.log(`\n${bad === 0 ? "ALL PASS" : `${bad} FAILED`}\n`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
