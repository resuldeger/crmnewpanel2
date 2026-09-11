"use client";

import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, EmptyState, I, Pagination, Pill, SearchableSelect, SectionTitle } from "../ui";
import { prettyPhone, studioById, timeAgo, type Customer } from "../data";
import { t, tf, useI18n } from "../i18n";
import { CallHistoryModal, SmsCompose } from "./Leads";

export default function Customers() {
  const { customers, locOk, inRange, toast, navigate, can, guard, logCallback } = useStore();
  useI18n();

  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [smsCust, setSmsCust] = useState<Customer | null>(null);
  const [histCust, setHistCust] = useState<Customer | null>(null);

  const PAGE_SIZE = 20;

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return customers.filter(c => {
      if (!locOk(c.locationId)) return false;
      if (!inRange(c.lastActiveAt)) return false;
      if (stageFilter !== "all" && c.stage !== stageFilter) return false;
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.phone.replace(/[^0-9+]/g, "").includes(query.replace(/[^0-9+]/g, ""))
      );
    });
  }, [customers, locOk, inRange, stageFilter, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Summary KPIs
  const stats = useMemo(() => {
    const scoped = customers.filter(c => locOk(c.locationId));
    return {
      total: scoped.length,
      booked: scoped.filter(c => c.apptCount > 0).length,
      vips: scoped.filter(c => c.stage === "vip" || c.completedApptCount >= 2).length,
      inquiries: scoped.reduce((sum, c) => sum + c.leadCount, 0),
    };
  }, [customers, locOk]);

  const dial = (c: Customer) => {
    if (!guard("calls.manage")) return;
    const res = logCallback({ name: c.name, phone: c.phone, customerId: c.id, locationId: c.locationId });
    toast(res === "Answered" ? tf("Callback to {name} answered", { name: c.name }) : tf("Callback to {name} · no answer", { name: c.name }), res === "Answered" ? "success" : "info");
  };

  const STAGE_OPTIONS = [
    { value: "all", label: t("All Stages") },
    { value: "vip", label: `⭐ ${t("VIP Client")}` },
    { value: "completed", label: `✓ ${t("Completed Tattoo")}` },
    { value: "booked", label: `📅 ${t("Booked Appointment")}` },
    { value: "lead", label: `🎯 ${t("Lead Inquirer")}` },
    { value: "churned", label: `⏸ ${t("Inactive / Churned")}` },
  ];

  return (
    <div className="space-y-4 animate-rise">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: t("Total Unique Clients"), value: stats.total, color: "#fba200", icon: "users" as const },
          { label: t("Booked Clients"), value: stats.booked, color: "#2fbf71", icon: "calendar" as const },
          { label: t("VIP & Repeat Clients"), value: stats.vips, color: "#e1589a", icon: "star" as const },
          { label: t("Total Inquiries & Briefs"), value: stats.inquiries, color: "#4c8dff", icon: "leads" as const },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel transition-all hover:border-gold-500/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">{k.label}</span>
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-700 bg-ink-800" style={{ color: k.color }}>
                <I name={k.icon} size={14} />
              </span>
            </div>
            <div className="num mt-2 text-[24px] font-extrabold text-ink-50">{k.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
              placeholder={t("Search client by name, phone, email, client ID…")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full rounded-xl border border-ink-700 bg-ink-900/80 py-2 pl-9 pr-3 text-[12.5px] font-semibold text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/30"
            />
          </div>

          <div className="w-48">
            <SearchableSelect
              value={stageFilter}
              onChange={v => { setStageFilter(v); setPage(1); }}
              options={STAGE_OPTIONS}
              placeholder={t("Filter stage…")}
            />
          </div>
        </div>

        <div className="num text-[12px] font-bold text-ink-400">
          {tf("Showing {count} clients", { count: filtered.length })}
        </div>
      </div>

      {/* Customers Data Table */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Client")}</th>
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Stage")}</th>
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Studio Branch")}</th>
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Bookings / Leads")}</th>
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Touchpoints")}</th>
                <th className="px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Last Active")}</th>
                <th className="px-4 py-3 text-right text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-400">{t("Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {pageItems.map(c => {
                const studio = studioById(c.locationId);
                return (
                  <tr key={c.id} className="row-live group transition-colors hover:bg-ink-800/60">
                    {/* Client Name & ID */}
                    <td className="px-4 py-3">
                      <button onClick={() => navigate({ view: "customer", id: c.id })} className="flex items-center gap-3 text-left">
                        <Avatar name={c.name} size={36} ring />
                        <div>
                          <div className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink-100 group-hover:text-gold-300 transition-colors">
                            {c.name}
                            {c.stage === "vip" && <span title={t("VIP Repeat Client")} className="text-gold-400">★</span>}
                          </div>
                          <div className="num text-[11px] font-medium text-ink-400">
                            {prettyPhone(c.phone)} · <span className="opacity-80">{c.email}</span>
                          </div>
                        </div>
                      </button>
                    </td>

                    {/* Stage Pill */}
                    <td className="px-4 py-3">
                      {c.stage === "vip" ? <Pill color="#fba200">VIP Client</Pill> :
                       c.stage === "completed" ? <Pill color="#2fbf71">Completed Tattoo</Pill> :
                       c.stage === "booked" ? <Pill color="#4c8dff">Booked</Pill> :
                       <Pill color="#948d7d">Lead</Pill>}
                    </td>

                    {/* Studio */}
                    <td className="px-4 py-3">
                      <Pill color="#948d7d">{studio?.city ?? studio?.name ?? "—"}</Pill>
                    </td>

                    {/* Bookings & Leads Counter */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="num rounded-lg border border-jade-500/40 bg-jade-500/10 px-2 py-0.5 text-[11px] font-extrabold text-jade-300" title={t("Bookings count")}>
                          {c.apptCount} {t("Bookings").toLowerCase()}
                        </span>
                        <span className="num rounded-lg border border-ink-600 bg-ink-800 px-2 py-0.5 text-[11px] font-semibold text-ink-300" title={t("Inquiries count")}>
                          {c.leadCount} {t("Inquiries").toLowerCase()}
                        </span>
                      </div>
                    </td>

                    {/* Touchpoints (Calls & SMS) */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-400">
                        <span className="flex items-center gap-1"><I name="phone" size={11} /> {c.totalCalls}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1"><I name="chat" size={11} /> {c.totalSms}</span>
                      </div>
                    </td>

                    {/* Last Active */}
                    <td className="num px-4 py-3 text-[11.5px] font-medium text-ink-400">
                      {timeAgo(c.lastActiveAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Btn size="sm" variant="ghost" title={t("Call")} locked={!can("calls.manage")} onClick={() => dial(c)}>
                          <I name="phone" size={13} />
                        </Btn>
                        <Btn size="sm" variant="ghost" title={t("Send SMS")} locked={!can("sms.send")} onClick={() => setSmsCust(c)}>
                          <I name="chat" size={13} />
                        </Btn>
                        <Btn size="sm" variant="outline" onClick={() => navigate({ view: "customer", id: c.id })}>
                          <I name="eye" size={13} /> {t("360° Profile")}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12">
            <EmptyState title={t("No customers found")} hint={t("Try clearing your search query or stage filters.")} />
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="border-t border-ink-700 bg-ink-850 p-4">
            <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onPage={setPage} unit={t("clients")} />
          </div>
        )}
      </div>

      {smsCust && (
        <SmsCompose
          leadId={smsCust.leadIds[0]}
          phone={smsCust.phone}
          name={smsCust.name}
          locationId={smsCust.locationId}
          onClose={() => setSmsCust(null)}
          openThread={cid => navigate({ view: "sms", id: cid })}
        />
      )}
    </div>
  );
}
