/* Handing a task to someone, and telling them.
 *
 * Assigning work silently is the same as not assigning it: the person is
 * on a call or on another screen, so the queue grows and everyone assumes
 * somebody else has it.
 *
 *   npx tsx scripts/dev/test-task-assignment.ts
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, like, ne } from "drizzle-orm";
import { db } from "../../src/db/client";
import { locationScopes, locations, notifications, realtimeEvents, sessions, staff, staffPresence, tasks } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  /* Explicitly a super admin: the endpoint needs calls.manage, and
     picking whoever came back first gave a role without it. */
  const [me] = await db.select({ id: staff.id, name: staff.name })
    .from(staff).where(and(eq(staff.active, true), eq(staff.roleId, "super_admin"))).limit(1);
  const people = await db.select({ id: staff.id, name: staff.name })
    .from(staff).where(eq(staff.active, true)).orderBy(desc(staff.id)).limit(5);
  const mate = people.find((p) => p.id !== me?.id);
  const [studio] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (!me || !mate || !studio) throw new Error("need two staff and a studio");

  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id: sessionId, staffId: me.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "assign-test",
  });
  const cookie = `cleo_session=${token}`;

  const [task] = await db.insert(tasks).values({
    title: "Callback · Assign Test", phoneE164: "+12125550155",
    locationId: studio.id, dueAt: new Date(Date.now() + 3_600_000), source: "callback",
  }).returning({ id: tasks.id });

  try {
    console.log("\n1. kimse cevrimici degilken herkes listeleniyor");
    await db.delete(staffPresence);
    let res = await fetch(`${BASE}/api/crm/staff/assignable`, { headers: { cookie } });
    let body = (await res.json()) as { anyoneOnline: boolean; staff: { id: number; online: boolean }[] };
    check("200", res.status === 200, String(res.status));
    check("kimse cevrimici degil", body.anyoneOnline === false);
    check("yine de liste dolu", body.staff.length > 1, `${body.staff.length} kisi`);

    console.log("\n2. biri cevrimici olunca sadece o listeleniyor");
    await db.insert(staffPresence).values({ staffId: mate.id, status: "online", lastHeartbeatAt: new Date() });
    res = await fetch(`${BASE}/api/crm/staff/assignable`, { headers: { cookie } });
    body = (await res.json()) as typeof body;
    check("cevrimici var", body.anyoneOnline === true);
    check("sadece o kisi", body.staff.length === 1 && body.staff[0].id === mate.id, JSON.stringify(body.staff));

    console.log("\n3. eski kalp atisi cevrimici sayilmiyor");
    await db.update(staffPresence).set({ lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) }).where(eq(staffPresence.staffId, mate.id));
    res = await fetch(`${BASE}/api/crm/staff/assignable`, { headers: { cookie } });
    body = (await res.json()) as typeof body;
    check("cevrimici degil", body.anyoneOnline === false);

    console.log("\n4. sube kapsamina gore daraliyor");
    await db.delete(staffPresence);
    /* Someone scoped to nothing but one other studio must not be offered
       for work that belongs to this one. */
    /* A colleague invented for this, rather than borrowing a real one.
       An earlier version of this test cleared a live branch manager's
       scopes to make the point and never put them back — the studios they
       actually manage were gone until someone noticed. */
    const [elsewhere] = await db.select({ id: locations.id }).from(locations)
      .where(ne(locations.id, studio.id)).limit(1);
    const [outsider] = await db.insert(staff).values({
      name: "Scope Test", email: `scope-test-${Date.now()}@example.invalid`,
      roleId: "branch_manager", scopeAll: false, active: true,
    }).returning({ id: staff.id, name: staff.name });
    await db.insert(locationScopes).values({ staffId: outsider.id, locationId: elsewhere.id });
    {

      res = await fetch(`${BASE}/api/crm/staff/assignable?location=${studio.id}`, { headers: { cookie } });
      body = (await res.json()) as typeof body;
      check("baska subedeki kisi listede yok",
        !body.staff.some((p) => p.id === outsider.id), `${outsider.name}`);

      res = await fetch(`${BASE}/api/crm/staff/assignable?location=${elsewhere.id}`, { headers: { cookie } });
      body = (await res.json()) as typeof body;
      check("kendi subesinde listede var",
        body.staff.some((p) => p.id === outsider.id), `${outsider.name}`);
    }

    console.log("\n5. atama yapiliyor ve haber veriliyor");
    const patch = await fetch(`${BASE}/api/crm/tasks/${task.id}`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignee_staff_id: mate.id }),
    });
    check("200", patch.status === 200, String(patch.status));
    const [row] = await db.select({ a: tasks.assigneeStaffId }).from(tasks).where(eq(tasks.id, task.id));
    check("gorev atandi", row.a === mate.id, String(row.a));

    const notes = await db.select({ id: notifications.id, kind: notifications.kind, body: notifications.body })
      .from(notifications).where(and(eq(notifications.staffId, mate.id), eq(notifications.kind, "task_assigned")));
    check("bildirim yazildi", notes.length >= 1, `${notes.length} bildirim`);
    check("kim atadigi yaziyor", notes[0]?.body?.includes(me.name) === true, String(notes[0]?.body));

    const pushed = await db.select({ id: realtimeEvents.id, staffId: realtimeEvents.staffId })
      .from(realtimeEvents).where(and(eq(realtimeEvents.topic, "task.assigned"), eq(realtimeEvents.staffId, mate.id)));
    check("kendi soketine gonderildi", pushed.length >= 1, `${pushed.length} olay`);

    console.log("\n6. kendine atayinca bildirim yok");
    await db.delete(notifications).where(eq(notifications.staffId, me.id));
    await fetch(`${BASE}/api/crm/tasks/${task.id}`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignee_staff_id: me.id }),
    });
    const mine = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.staffId, me.id), eq(notifications.kind, "task_assigned")));
    check("kendine bildirim gitmedi", mine.length === 0, `${mine.length}`);

    console.log("\n7. olmayan kisiye atanamaz");
    const bad = await fetch(`${BASE}/api/crm/tasks/${task.id}`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignee_staff_id: 99999999 }),
    });
    check("422", bad.status === 422, String(bad.status));

    console.log("\n8. havuza geri konabiliyor");
    const clear = await fetch(`${BASE}/api/crm/tasks/${task.id}`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignee_staff_id: null }),
    });
    const [after] = await db.select({ a: tasks.assigneeStaffId }).from(tasks).where(eq(tasks.id, task.id));
    check("200 ve bos", clear.status === 200 && after.a === null, String(after.a));
  } finally {
    await db.delete(realtimeEvents).where(eq(realtimeEvents.topic, "task.assigned"));
    await db.delete(notifications).where(eq(notifications.kind, "task_assigned"));
    await db.delete(tasks).where(eq(tasks.id, task.id));
    await db.delete(staffPresence);
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    /* The invented colleague, and their scope row with them. */
    await db.delete(staff).where(like(staff.email, "scope-test-%@example.invalid"));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
