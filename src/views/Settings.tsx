import { useCallback, useEffect, useState } from "react";
import { useStore, type DateRange } from "../store";
import { Btn, Drawer, Field, I, Pill, SearchableSelect, SectionTitle, Toggle, inputCls, type IconName } from "../ui";
import { timeAgo } from "../data";
import { t, tf, useI18n } from "../i18n";
import { crmApi, type TimelyMappingAccount, type TimelyMappingsResponse } from "../services/crmApi";

/** Presentation only — the state of each integration comes from the API. */
const PRESENTATION: Record<string, { desc: string; icon: IconName; accent: string }> = {
  vonage: { desc: "Cloud telephony — call routing, recordings & live floor sync.", icon: "phone", accent: "#2fbf71" },
  twilio: { desc: "A2P 10DLC messaging, templates & opt-out compliance.", icon: "chat", accent: "#2f6fe4" },
  timely: { desc: "Two-way calendar sync for appointments & deposits.", icon: "calendar", accent: "#1e9e5c" },
  meta: { desc: "Server-side lead events for Instagram & Facebook pixels.", icon: "spark", accent: "#e1589a" },
  google: { desc: "gclid matching for booked-appointment imports.", icon: "chart", accent: "#e8a33d" },
  tiktok: { desc: "ttclid matching for Spark Ads attribution.", icon: "bolt", accent: "#5fd6c9" },
  turnstile: { desc: "Bot protection on the public booking form.", icon: "shield", accent: "#7c4fe0" },
};

interface ApiIntegration {
  provider: string; name: string; keyLabel: string;
  configured: boolean; enabled: boolean;
  secretPreview: string | null; publicKey: string | null;
  lastCheckedAt: string | null; lastStatus: string | null;
}

interface WebhookDelivery {
  id: number; provider: string; eventType: string;
  signatureValid: boolean; processed: boolean;
  error: string | null; receivedAt: string;
}

interface AccountFormState {
  id: number;
  label: string;
  email: string;
  password?: string;
  active: boolean;
}

function TimelyAccountDrawer({
  initial,
  onClose,
  onSaved,
}: {
  initial: AccountFormState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, guard } = useStore();
  const [f, setF] = useState<AccountFormState>({ ...initial });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  /* Shown in the drawer and left there. A toast is gone by the time anyone
     reads it, and this is the one answer the form exists to get. */
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
  const isNew = initial.id === 0;

  /* Any edit invalidates the last result — a green tick beside a password
     somebody has just changed is worse than no tick. */
  const edit = (patch: Partial<AccountFormState>) => {
    setProbe(null);
    setF((s) => ({ ...s, ...patch }));
  };

  const test = async () => {
    if (!guard("settings.manage")) return;
    if (!f.email.trim() || !f.email.includes("@")) {
      toast(t("Valid email is required"), "error");
      return;
    }
    setTesting(true);
    setProbe(null);
    try {
      const res = await crmApi.testTimelyCredentials({
        id: isNew ? undefined : f.id,
        email: f.email.trim(),
        password: f.password?.trim() || undefined,
      });
      setProbe(res);
    } catch (err) {
      setProbe({ ok: false, detail: err instanceof Error ? err.message : t("Could not reach Timely") });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!guard("settings.manage")) return;
    if (f.label.trim().length < 2) {
      toast(t("Account Label is required"), "error");
      return;
    }
    if (!f.email.trim() || !f.email.includes("@")) {
      toast(t("Valid email is required"), "error");
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        await crmApi.createTimelyAccount({
          label: f.label.trim(),
          email: f.email.trim(),
          password: f.password?.trim() || undefined,
          active: f.active,
        });
        toast(t("Timely account created"), "success");
      } else {
        await crmApi.updateTimelyAccount({
          id: f.id,
          label: f.label.trim(),
          email: f.email.trim(),
          password: f.password?.trim() || undefined,
          active: f.active,
        });
        toast(t("Timely account updated"), "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer onClose={onClose} w={460}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">
            {isNew ? t("Add Timely Account") : t("Edit Timely Account")}
          </h3>
          <div className="mt-0.5 text-[12px] text-ink-400">
            {t("Used to scrape studio locations, staff rosters, and private calendar feeds.")}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t("Close")}
          className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          <I name="x" size={17} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Field label={t("Account Label")}>
          <input
            value={f.label}
            onChange={(e) => edit({ label: e.target.value })}
            placeholder="Cleopatra Ink - US Main"
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
        </Field>

        <Field label={t("Timely Login Email")}>
          <input
            value={f.email}
            onChange={(e) => edit({ email: e.target.value })}
            placeholder="management@cleopatraink.com"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={inputCls}
          />
        </Field>

        <Field
          label={t("Timely Password")}
          hint={
            isNew
              ? t("Stored encrypted. Replayed only for app.gettimely.com session sync.")
              : t("Leave blank to keep existing encrypted password unchanged.")
          }
        >
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={f.password ?? ""}
              onChange={(e) => edit({ password: e.target.value })}
              placeholder={isNew ? t("Timely Password") : "••••••••"}
              autoComplete="new-password"
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-200"
              title={showPassword ? t("Hide password") : t("Show password")}
            >
              <I name={showPassword ? "eyeOff" : "eye"} size={14} />
            </button>
          </div>
        </Field>

        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
            f.active ? "border-jade-500/40 bg-jade-500/6" : "border-ember-500/40 bg-ember-500/6"
          }`}
        >
          <div>
            <div className="flex items-center gap-2 text-[12.5px] font-extrabold text-ink-100">
              {t("Account status")}
              <Pill color={f.active ? "#2fbf71" : "#e5484d"} dot={false} className="!text-[9.5px]">
                {f.active ? t("Active") : t("Inactive")}
              </Pill>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-ink-400">
              {f.active ? t("Included in automated sweeps.") : t("Disabled — sweeps will skip this account.")}
            </div>
          </div>
          <Toggle on={f.active} onChange={() => setF((s) => ({ ...s, active: !s.active }))} />
        </div>
      </div>

      {probe && (
        <div className={`mx-5 mb-1 rounded-xl border px-3.5 py-2.5 text-[12px] font-bold ${
          probe.ok
            ? "border-jade-500/40 bg-jade-500/8 text-jade-400"
            : "border-ember-500/40 bg-ember-500/8 text-ember-400"
        }`}>
          <I name={probe.ok ? "check" : "alert"} size={13} className="mr-1.5 inline" />
          {probe.detail}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
        <Btn variant="outline" disabled={busy} onClick={onClose}>
          {t("Cancel")}
        </Btn>
        <Btn variant="outline" disabled={busy || testing} onClick={() => void test()}>
          <I name="bolt" size={14} /> {testing ? t("Testing…") : t("Test sign-in")}
        </Btn>
        {/* The server checks this too and is the one that decides; the button
            only saves the round trip and says why it is greyed out. */}
        <Btn variant="gold" disabled={busy || testing} onClick={() => void save()}>
          <I name="check" size={14} /> {busy ? t("Saving…") : isNew ? t("Add Timely Account") : t("Save")}
        </Btn>
      </div>
    </Drawer>
  );
}

export default function Settings() {
  const { toast, dateRange, setDateRange, guard, can } = useStore();
  useI18n();
  const [apiInts, setApiInts] = useState<ApiIntegration[]>([]);
  const [events, setEvents] = useState<WebhookDelivery[]>([]);
  const [timelyMappings, setTimelyMappings] = useState<TimelyMappingsResponse>({ accounts: [], locations: [], staff: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ autoAssign: true, smsSound: true, digest: false });
  const [editingAccount, setEditingAccount] = useState<AccountFormState | null>(null);
  const [syncingRosterId, setSyncingRosterId] = useState<number | null>(null);
  const [syncingAppts, setSyncingAppts] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const loadData = useCallback(() => {
    fetch("/api/crm/settings", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (d: {
          integrations: ApiIntegration[];
          webhooks: WebhookDelivery[];
          preferences: { autoAssign?: boolean; smsSound?: boolean; dailyDigest?: boolean } | null;
        }) => {
          setApiInts(d.integrations);
          setEvents(d.webhooks);
          if (d.preferences) {
            setPrefs({
              autoAssign: d.preferences.autoAssign ?? false,
              smsSound: d.preferences.smsSound ?? true,
              digest: d.preferences.dailyDigest ?? false,
            });
          }
        },
      )
      .catch((e: Error) => setLoadError(e.message));

    crmApi
      .getTimelyMappings()
      .then((res) => setTimelyMappings(res))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleAccount = async (id: number, active: boolean) => {
    if (!guard("settings.manage")) return;
    try {
      await crmApi.updateTimelyAccount({ id, active });
      toast(active ? t("Timely account activated") : t("Timely account deactivated"), "success");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not update status"), "error");
    }
  };

  const handleDeleteAccount = async (id: number, label: string) => {
    if (!guard("settings.manage")) return;
    if (!confirm(tf("Are you sure you want to delete {name}?", { name: label }))) return;
    try {
      await crmApi.deleteTimelyAccount(id);
      toast(t("Timely account deleted"), "info");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not delete"), "error");
    }
  };

  /* The sign-in alone, so a wrong password is found in a second rather than
     at the end of a sweep that walked every studio and every member of
     staff. Whatever Timely answered is shown verbatim — "rejected" is not
     an answer anyone can act on. */
  const handleTestAccount = async (accountId: number) => {
    if (!guard("settings.manage")) return;
    setTestingId(accountId);
    try {
      const res = await crmApi.testTimelyAccount(accountId);
      toast(res.detail, res.ok ? "success" : "error");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not reach Timely"), "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncRoster = async (accountId?: number) => {
    if (!guard("settings.manage")) return;
    setSyncingRosterId(accountId ?? -1);
    try {
      await crmApi.syncTimelyRoster(accountId);
      toast(t("Timely roster sync completed"), "success");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Roster sync failed"), "error");
    } finally {
      setSyncingRosterId(null);
    }
  };

  const handleSyncAppointments = async () => {
    if (!guard("settings.manage")) return;
    const hasActive = timelyMappings.accounts.some((a) => a.active);
    if (!hasActive) {
      toast(t("Please add and activate at least one Timely account first"), "info");
      return;
    }
    setSyncingAppts(true);
    try {
      await crmApi.syncTimelyAppointments();
      toast(t("Appointments & availability sync completed"), "success");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Appointment sync failed"), "error");
    } finally {
      setSyncingAppts(false);
    }
  };

  const hasActiveAccounts = timelyMappings.accounts.some((a) => a.active);

  const ints = apiInts.map((i) => ({
    key: i.provider,
    name: i.name,
    keyLabel: i.keyLabel,
    on: i.provider === "timely" ? timelyMappings.accounts.some((a) => a.active) : i.enabled,
    configured: i.provider === "timely" ? timelyMappings.accounts.length > 0 : i.configured,
    secret:
      i.provider === "timely"
        ? tf("{n} account(s)", { n: String(timelyMappings.accounts.length) })
        : i.secretPreview ?? "",
    sync: i.lastCheckedAt ? new Date(i.lastCheckedAt).getTime() : null,
    ...(PRESENTATION[i.provider] ?? { desc: "", icon: "spark" as IconName, accent: "#948d7d" }),
  }));

  return (
    <div className="space-y-6 animate-rise">
      {/* ── Timely Multi-Account Management Section ── */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-jade-500/40 bg-jade-500/10 text-jade-400">
                <I name="calendar" size={16} />
              </span>
              <h2 className="font-display text-[16px] font-bold text-ink-50">
                {t("Timely Accounts (Multi-Account Booking & Availability)")}
              </h2>
            </div>
            <p className="mt-1 text-[12px] text-ink-400">
              {t("Manage Timely logins for automated staff discovery, studio matching, and appointment availability.")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Btn
              size="sm"
              variant="outline"
              disabled={syncingAppts || !hasActiveAccounts || !can("settings.edit")}
              title={!hasActiveAccounts ? t("Add and activate a Timely account first") : undefined}
              onClick={() => void handleSyncAppointments()}
            >
              <I name="refresh" size={13} /> {syncingAppts ? t("Syncing appointments…") : t("Sync Appointments")}
            </Btn>
            <Btn
              size="sm"
              variant="gold"
              onClick={() =>
                setEditingAccount({
                  id: 0,
                  label: "",
                  email: "",
                  active: true,
                  password: "",
                })
              }
            >
              <I name="plus" size={13} /> {t("Add Timely Account")}
            </Btn>
          </div>
        </div>

        <div className="mt-4">
          {timelyMappings.accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-700 py-8 text-center">
              <p className="text-[12.5px] font-semibold text-ink-400">
                {t("No Timely accounts configured yet.")}
              </p>
              <div className="mt-3">
                <Btn
                  size="sm"
                  variant="gold"
                  onClick={() =>
                    setEditingAccount({
                      id: 0,
                      label: "",
                      email: "",
                      active: true,
                      password: "",
                    })
                  }
                >
                  <I name="plus" size={13} /> {t("Add Timely Account")}
                </Btn>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {timelyMappings.accounts.map((acc) => {
                const locCount = timelyMappings.locations.filter((l) => l.accountId === acc.id).length;
                const accStaff = timelyMappings.staff.filter((s) => s.accountId === acc.id);
                const staffCount = accStaff.length;
                /* "126 staff" reads as 126 diaries being read. It is not: a
                   staff member with "Enable calendar sync" unticked in Timely
                   has no feed at all, and nothing here would have said so.
                   The number is only actionable because the fix is theirs —
                   one checkbox each, on Timely's own staff page. */
                const syncOffCount = accStaff.filter((s) => s.calendarSyncEnabled === false).length;
                const isSyncing = syncingRosterId === acc.id;
                /* A sweep is hundreds of requests. It stays locked until a
                   sign-in has actually worked, so a wrong password costs one
                   failed request instead of several hundred. */
                const verified = Boolean(acc.lastLoginAt) && !acc.lastError;

                return (
                  <div
                    key={acc.id}
                    className={`rounded-xl border bg-ink-900/60 p-4 transition-all duration-150 ${
                      acc.active ? "border-ink-700 hover:border-gold-500/40" : "border-ink-750 opacity-75"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-extrabold text-ink-100">{acc.label}</div>
                        <div className="num mt-0.5 truncate text-[11.5px] font-semibold text-ink-400">{acc.email}</div>
                      </div>
                      <Toggle
                        on={acc.active}
                        onChange={() => void handleToggleAccount(acc.id, !acc.active)}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-750 pt-2.5">
                      <Pill color={acc.active ? "#2fbf71" : "#e5484d"} dot={false} className="!text-[9.5px]">
                        {acc.active ? t("Active") : t("Inactive")}
                      </Pill>
                      <span className="num text-[10.5px] font-semibold text-ink-500">
                        {locCount} {t("studios")} · {staffCount} {t("staff")}
                      </span>
                      {syncOffCount > 0 && (
                        <span
                          className="num text-[10.5px] font-semibold text-[#e8a33d]"
                          title={t("Tick \u201cEnable calendar sync\u201d on each of these staff members in Timely")}
                        >
                          {tf("{n} without a calendar feed", { n: String(syncOffCount) })}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10.5px] font-semibold text-ink-500">
                      <span>
                        {/* A sweep writes lastSyncAt when it finishes, so
                            mid-run the counts beside it are already climbing
                            while this still says "never" — true, and read as
                            a contradiction. It says what is happening. */}
                        {isSyncing
                          ? t("syncing now…")
                          : acc.lastSyncAt
                            ? tf("synced {ago}", { ago: timeAgo(acc.lastSyncAt) })
                            : t("never synced")}
                      </span>
                      {/* Said on the card, not only in a toast that has gone
                          by the time anyone looks. */}
                      {acc.lastError ? (
                        <span className="truncate text-ember-400" title={acc.lastError}>
                          {acc.lastError}
                        </span>
                      ) : verified ? (
                        <span className="text-jade-400">
                          {tf("signed in {ago}", { ago: timeAgo(acc.lastLoginAt!) })}
                        </span>
                      ) : (
                        <span className="text-[#e8a33d]">{t("not tested yet")}</span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-1.5 border-t border-ink-750 pt-2.5">
                      {/* Before the sweep, not after it. A roster sync walks
                          every studio and every member of staff; learning at
                          the end that the password was wrong wastes minutes
                          and a lot of requests at a rate-limited site. */}
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={testingId === acc.id}
                        onClick={() => void handleTestAccount(acc.id)}
                        className="!text-[11px]"
                      >
                        <I name="bolt" size={11} /> {testingId === acc.id ? t("Testing…") : t("Test sign-in")}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={isSyncing || !verified}
                        title={verified ? undefined : t("Test the sign-in first")}
                        onClick={() => void handleSyncRoster(acc.id)}
                        className="flex-1 !text-[11px]"
                      >
                        <I name="refresh" size={11} /> {isSyncing ? t("Syncing roster…") : t("Sync Roster")}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditingAccount({
                            id: acc.id,
                            label: acc.label,
                            email: acc.email,
                            active: acc.active,
                            password: "",
                          })
                        }
                        className="!px-2 text-ink-300 hover:text-ink-100"
                        title={t("Edit")}
                      >
                        <I name="edit" size={13} />
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleDeleteAccount(acc.id, acc.label)}
                        className="!px-2 !text-ember-400 hover:!bg-ember-500/10"
                        title={t("Delete")}
                      >
                        <I name="trash" size={13} />
                      </Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <SectionTitle
            right={
              <Pill color="#2fbf71" dot={false}>
                <span className="num">{ints.filter((i) => i.on).length}</span>&nbsp;{t("connected")}
              </Pill>
            }
          >
            {t("Integrations & API Keys")}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {ints.map((it) => (
              <div
                key={it.key}
                className={`rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all duration-200 ${
                  it.on ? "border-ink-700 hover:border-gold-500/40" : "border-ink-700 opacity-75"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800"
                      style={{ color: it.accent }}
                    >
                      <I name={it.icon} size={16} />
                    </span>
                    <div>
                      <div className="text-[13px] font-extrabold text-ink-50">{it.name}</div>
                      <div className="num text-[10px] font-semibold text-ink-500">
                        {it.sync ? `${t("last checked")} · ${timeAgo(new Date(it.sync).toISOString())}` : t("never checked")}
                      </div>
                    </div>
                  </div>
                  <Toggle
                    on={it.on}
                    onChange={() =>
                      toast(
                        it.key === "timely"
                          ? t("Timely accounts are managed in the section above")
                          : t("Credentials are managed on the server"),
                        "info",
                      )
                    }
                  />
                </div>
                <p className="mt-2.5 text-[11.5px] font-medium leading-relaxed text-ink-400">{it.desc}</p>
                <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/70 px-2.5 py-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">{it.keyLabel}</span>
                  <span className="num min-w-0 flex-1 truncate text-[11px] font-bold text-ink-200">
                    {it.configured ? it.secret || "••••••••" : t("not configured")}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span
                    className={`flex items-center gap-1.5 text-[10.5px] font-bold ${
                      it.configured && it.on ? "text-jade-400" : "text-ink-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        it.configured && it.on ? "bg-jade-400" : "bg-ink-500"
                      }`}
                    />
                    {it.configured ? (it.on ? t("connected") : t("disabled")) : t("not configured")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle
              right={
                <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-jade-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-jade-400" /> <span className="num">{events.length}</span>
                </span>
              }
            >
              {t("Webhook Activity")}
            </SectionTitle>
            <div className="space-y-2">
              {events.length === 0 && (
                <p className="rounded-lg border border-dashed border-ink-700 px-3 py-6 text-center text-[11px] font-semibold text-ink-500">
                  {loadError ?? t("No webhooks received yet")}
                </p>
              )}
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2"
                >
                  <Pill color="#7c4fe0" dot={false} className="!text-[9.5px]">
                    {e.provider}
                  </Pill>
                  <span className="num min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink-200">
                    {e.eventType}
                  </span>
                  {!e.signatureValid && (
                    <span className="num rounded-md border border-ember-500/40 bg-ember-500/10 px-1.5 py-0.5 text-[10px] font-bold text-ember-400">
                      {t("unsigned")}
                    </span>
                  )}
                  <span
                    className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      e.error
                        ? "border border-ember-500/40 bg-ember-500/10 text-ember-400"
                        : e.processed
                          ? "border border-jade-500/40 bg-jade-500/10 text-jade-400"
                          : "border border-ink-600 bg-ink-800 text-ink-400"
                    }`}
                  >
                    {e.error ? t("failed") : e.processed ? t("processed") : t("queued")}
                  </span>
                  <span className="num w-14 text-right text-[10px] text-ink-500">{timeAgo(e.receivedAt)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Console Preferences")}</SectionTitle>
            <div className="space-y-4">
              <Field label={t("Default date range")}>
                <SearchableSelect
                  value={dateRange}
                  onChange={(v) => {
                    setDateRange(v as DateRange);
                    toast(t("Console Preferences"), "info");
                  }}
                  options={[
                    { value: "today", label: t("Today"), icon: "clock" },
                    { value: "7", label: t("Last 7 Days"), icon: "clock" },
                    { value: "30", label: t("Last 30 Days"), icon: "clock" },
                    { value: "all", label: t("All Time"), icon: "globe" },
                  ]}
                />
              </Field>
              {[
                { k: "autoAssign" as const, t2: "Auto-assign new leads", d: "Route to the least-busy callcenter line on intake." },
                { k: "smsSound" as const, t2: "Sound on inbound SMS", d: "Play a chime in the messenger when a client replies." },
                { k: "digest" as const, t2: "Daily digest email", d: "KPI summary to super admins every morning at 08:00." },
              ].map((p) => (
                <div
                  key={p.k}
                  className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/70 px-3.5 py-3"
                >
                  <div>
                    <div className="text-[12.5px] font-extrabold text-ink-100">{t(p.t2)}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-ink-400">{p.d}</div>
                  </div>
                  <Toggle
                    on={prefs[p.k]}
                    onChange={() => {
                      setPrefs((s) => ({ ...s, [p.k]: !s[p.k] }));
                      toast(tf2(p.t2, prefs[p.k] ? "disabled" : "enabled"), "info");
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ember-500/40 bg-ember-500/5 p-5">
            <div className="flex items-center gap-2">
              <I name="alert" size={16} className="text-ember-400" />
              <h3 className="font-display text-[15px] font-bold tracking-wide text-ember-400">{t("Danger Zone")}</h3>
            </div>
            <p className="mt-1.5 text-[11.5px] font-semibold leading-relaxed text-ink-400">
              {t(
                "Destructive actions are locked in this environment. Purging leads or call history requires owner approval via Vonage verify.",
              )}
            </p>
            <div className="mt-3 flex gap-2">
              <Btn
                variant="danger"
                size="sm"
                onClick={() => toast(t("Demo dataset is read-only in this sandbox"), "error")}
              >
                <I name="x" size={13} /> {t("Purge leads")}
              </Btn>
              <Btn
                variant="danger"
                size="sm"
                onClick={() => toast(t("Call recordings are retained 90 days by policy"), "error")}
              >
                <I name="x" size={13} /> {t("Wipe recordings")}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {editingAccount && (
        <TimelyAccountDrawer
          initial={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={loadData}
        />
      )}
    </div>
  );
}

function tf2(key: string, action: string) {
  return `${t(key)} ${t(action)}`;
}
