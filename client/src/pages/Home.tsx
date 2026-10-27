import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  addMonthsSafe,
  buildWhatsAppMessage,
  calculateRenewalDate,
  createMemberWithInitialPayment,
  deleteMember,
  durationsForPlan,
  findPlan,
  formatDate,
  getBalanceSheet,
  getLiveBalanceSheet,
  upsertMonthlyExpenses,
  getMonthlyRoster,
  getPaymentHistory,
  getDashboardSnapshot,
  getMemberDetail,
  getMembers,
  getMembersWithStatus,
  getNextRegisterNumber,
  getPayments,
  getPlans,
  planNames,
  recordPayment,
  renewMember,
  settlePendingBalance,
  startOfMonth,
  summarizeStatuses,
  toPlanOptions,
  updateMember,
  MEMBER_STATUS_ORDER,
  type AnyRow,
  type MemberStatus,
  type MemberWithStatus,
  type BalanceSheetRow,
  type MonthlyRosterData,
} from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, ArrowUpRight, BarChart3, Bell, CalendarDays, Check,
  ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Clock3, Dumbbell, ExternalLink,
  Filter, Info, LayoutDashboard, Loader2, Menu, MessageCircle, Package, Plus, RefreshCw,
  Search, Settings2, ShieldCheck, Trash2, UserRound, Users, WalletCards, X, Zap, Send,
  Receipt,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { toast } from "sonner";

type PageKey = "dashboard" | "members" | "payments" | "renewals" | "plans" | "balance";

const navItems: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "members", label: "Members", icon: Users },
  { key: "payments", label: "Payments", icon: WalletCards },
  { key: "renewals", label: "Renewals", icon: RefreshCw },
  { key: "plans", label: "Membership plans", icon: Package },
  { key: "balance", label: "Balance sheet", icon: BarChart3 },
];

const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const currentMonthIso = `${todayIso.slice(0, 8)}01`;

function money(value: any) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function date(value: any) {
  return formatDate(value);
}
function shortDate(value: any) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function digits(value: any) { return String(value ?? "").replace(/\D/g, ""); }
function initials(name: any) { return String(name || "Member").split(" ").slice(0, 2).map((part: string) => part[0]).join("").toUpperCase(); }

const CURRENT_STATUS_META: Record<MemberStatus, { label: string; tone: string }> = {
  Paid: { label: "Paid", tone: "green" },
  Due_or_Unpaid: { label: "Due / Unpaid", tone: "amber" },
  Deactive: { label: "Deactive", tone: "red" },
  needs_review: { label: "Needs review", tone: "slate" },
};

function statusForMember(member: AnyRow) {
  const current = member?.current_status as MemberStatus | undefined;
  if (current && CURRENT_STATUS_META[current]) return CURRENT_STATUS_META[current];
  const renew = String(member.renewal_date ?? "").slice(0, 10);
  if (renew && renew < todayIso) return { label: "Expired", tone: "red" };
  if (renew === todayIso) return { label: "Due today", tone: "amber" };
  if (Number(member.pending_amount ?? 0) > 0) return { label: "Pending", tone: "amber" };
  return { label: "Active", tone: "green" };
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Avatar({ name, small = false }: { name: any; small?: boolean }) {
  return (
    <div className={`${small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"} shrink-0 rounded-full bg-[#e0f2e9] text-[#237457] flex items-center justify-center font-bold`}>
      {initials(name)}
    </div>
  );
}

function WhatsAppButton({ member, onOpen }: { member: AnyRow; onOpen: (member: AnyRow) => void }) {
  return (
    <button
      className="btn btn-whatsapp"
      onClick={() => onOpen(member)}
      aria-label={`WhatsApp ${member.name || "member"}`}
    >
      <MessageCircle size={15} /> <span className="hidden sm:inline">WhatsApp</span>
    </button>
  );
}

function WhatsAppModal({ member, onClose }: { member: AnyRow; onClose: () => void }) {
  const [message, setMessage] = useState(() =>
    buildWhatsAppMessage(member, (member.current_status as any) || "general")
  );
  const statusMeta = statusForMember(member);
  const phone = digits(member.mobile_no);

  const handleSend = () => {
    if (!phone) {
      toast.error("No valid mobile number available for this member.");
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success(`WhatsApp opened for ${member.name}`);
    onClose();
  };

  return (
    <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer !max-w-lg" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#25d366]/15 text-[#128c7e] flex items-center justify-center">
              <MessageCircle size={22} />
            </div>
            <div>
              <div className="font-display font-bold text-xl">WhatsApp Safety Preview</div>
              <div className="text-xs text-muted-foreground">Recipient details & message confirmation</div>
            </div>
          </div>
          <button className="h-9 w-9 flex items-center justify-center rounded-lg border border-border" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-[#f7faf8] p-4 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipient Name:</span>
            <span className="font-bold">{member.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Register No:</span>
            <span className="font-mono">#{member.register_no}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mobile:</span>
            <span className="font-mono">{member.mobile_no || "No mobile"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Current Status:</span>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </div>
        </div>

        {member.current_status === "needs_review" && (
          <div className="data-alert mt-4 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#b03842]" />
            <div>
              <div className="font-bold">Needs Review Member</div>
              <div>This member has an unresolved payment issue. Regular renewal reminders are suppressed until resolved.</div>
            </div>
          </div>
        )}

        <div className="mt-5">
          <label className="block text-xs font-bold mb-2">Message Content (Editable):</label>
          <textarea
            className="input py-3 min-h-36 text-xs leading-relaxed font-sans"
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-whatsapp gap-2" onClick={handleSend}>
            <Send size={15} /> Send via WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

function RenewMemberModal({
  member,
  plans,
  onClose,
  onDone,
}: {
  member: AnyRow;
  plans?: AnyRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const planOptions = useMemo(() => toPlanOptions(plans), [plans]);
  const packageNames = useMemo(() => planNames(planOptions), [planOptions]);

  const [selectedPackage, setSelectedPackage] = useState(member.package_name || packageNames[0] || "General Fitness");
  const availableDurations = useMemo(() => durationsForPlan(planOptions, selectedPackage), [planOptions, selectedPackage]);
  const [selectedDuration, setSelectedDuration] = useState<number>(availableDurations[0] || 1);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "due_or_unpaid" | "needs_review">("paid");

  useEffect(() => {
    if (availableDurations.length && !availableDurations.includes(selectedDuration)) {
      setSelectedDuration(availableDurations[0]);
    }
  }, [selectedPackage, availableDurations, selectedDuration]);

  const selectedPlan = useMemo(
    () => findPlan(planOptions, selectedPackage, selectedDuration),
    [planOptions, selectedPackage, selectedDuration]
  );

  const initialFromDate = useMemo(() => {
    const curStr = member.renewal_date ? String(member.renewal_date).slice(0, 10) : "";
    return curStr && curStr >= todayIso ? curStr : todayIso;
  }, [member.renewal_date]);

  const [fromDate, setFromDate] = useState<string>(initialFromDate);

  useEffect(() => {
    setFromDate(initialFromDate);
  }, [initialFromDate]);

  const planAmount = selectedPlan?.price ?? Number(member.amount || 0);
  const newRenewalDate = useMemo(
    () => (fromDate && selectedDuration ? addMonthsSafe(fromDate, selectedDuration) : ""),
    [fromDate, selectedDuration]
  );

  const mutation = useMutation({
    mutationFn: () =>
      renewMember({
        register_no: Number(member.register_no),
        package_code: selectedPlan?.plan_code || member.package_code || "G/F",
        package_name: selectedPackage,
        duration_months: selectedDuration,
        amount: planAmount,
        renewal_date: newRenewalDate,
        billing_month: fromDate ? `${fromDate.slice(0, 7)}-01` : undefined,
        payment_status: paymentStatus,
      }),
    onSuccess: () => {
      toast.success(`Membership for ${member.name} updated successfully.`);
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const statusMeta = statusForMember(member);
  const ro = "input mt-1 bg-[#f2f6f4] text-muted-foreground cursor-not-allowed font-medium";

  return (
    <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer !max-w-xl" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[.12em] text-[#13795b] font-bold">Membership Workflow</div>
            <h2 className="font-display font-bold text-2xl mt-1">Renew / Update Membership</h2>
            <p className="text-xs text-muted-foreground mt-1">Calculates pricing & renewal date automatically while preserving past payment history.</p>
          </div>
          <button className="h-9 w-9 flex items-center justify-center rounded-lg border border-border" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-[#f7faf8] p-4 text-xs">
          <div className="font-bold text-sm mb-3">Current Profile</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><span className="text-muted-foreground block text-[10px]">Register No</span><span className="font-mono font-bold">#{member.register_no}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Name</span><span className="font-bold">{member.name}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Current Package</span><span>{member.package_name || "—"}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Current Status</span><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge></div>
            <div><span className="text-muted-foreground block text-[10px]">Current Amount</span><span className="font-semibold">{money(member.amount)}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Current Renewal</span><span>{date(member.renewal_date)}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Pending Amount</span><span className="font-bold text-[#b07818]">{money(member.pending_amount)}</span></div>
            <div><span className="text-muted-foreground block text-[10px]">Mobile</span><span>{member.mobile_no || "—"}</span></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <label className="block text-xs font-bold col-span-2 sm:col-span-1">
            New Package *
            <select
              className="select mt-1"
              value={selectedPackage}
              onChange={e => setSelectedPackage(e.target.value)}
            >
              {packageNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className="block text-xs font-bold col-span-2 sm:col-span-1">
            New Duration *
            <select
              className="select mt-1"
              value={selectedDuration}
              onChange={e => setSelectedDuration(Number(e.target.value))}
            >
              {availableDurations.map(d => (
                <option key={d} value={d}>{d} Month{d === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold">
            Plan Amount (Source of Truth)
            <input className={ro} readOnly value={money(planAmount)} />
          </label>

          <label className="block text-xs font-bold">
            Registration Fee
            <input className={ro} readOnly value="₹0 (Renewal)" title="Registration fee applies only to new members on first registration" />
          </label>

          <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-border bg-[#f7faf8]">
            <label className="block text-xs font-bold">
              Renewal Start Date (From) *
              <input
                className="input mt-1 bg-white font-medium"
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold">
              New Renewal Date (Valid Until)
              <input
                className={ro}
                readOnly
                value={newRenewalDate ? date(newRenewalDate) : "—"}
              />
            </label>
            <div className="col-span-full text-[11px] text-[#13795b] font-medium flex items-center gap-1.5 mt-0.5">
              <CalendarDays size={14} className="shrink-0" />
              <span>
                Coverage: <strong>{formatDate(fromDate)}</strong> → <strong>{formatDate(newRenewalDate)}</strong> ({selectedDuration} Month{selectedDuration === 1 ? "" : "s"})
              </span>
            </div>
          </div>

          <label className="block text-xs font-bold col-span-2">
            Payment Status for Renewal *
            <select
              className="select mt-1"
              value={paymentStatus}
              onChange={e => setPaymentStatus(e.target.value as any)}
            >
              <option value="paid">Paid (Fully Settled)</option>
              <option value="due_or_unpaid">Due / Unpaid (Record Pending Balance)</option>
              <option value="needs_review">Needs Review (Payment Exception)</option>
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Updating…" : "Confirm Renewal / Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppSidebar({ page, setPage, user, logout }: { page: PageKey; setPage: (page: PageKey) => void; user: AnyRow | null; logout: () => void }) {
  return <aside className="sidebar">
    <div className="flex items-start gap-3 px-2 mb-9">
      <div className="h-10 w-10 shrink-0 rounded-xl bg-[#c9f0dc] text-[#145b43] flex items-center justify-center shadow-lg shadow-black/10"><Dumbbell size={20} /></div>
      <div className="min-w-0"><div className="font-display font-bold tracking-tight text-white leading-tight">Dream Big</div><div className="text-[11px] text-[#8faea1] mt-1">Fitness Studio</div></div>
    </div>
    <div className="text-[10px] uppercase tracking-[.16em] text-[#6e8f83] font-bold px-3 mb-3">Workspace</div>
    <nav className="space-y-1">
      {navItems.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-link w-full text-left ${page === key ? "active" : ""}`} onClick={() => setPage(key)}><Icon size={17} strokeWidth={page === key ? 2.3 : 1.8} /><span>{label}</span>{key === "renewals" && <span className="ml-auto text-[10px] text-[#a7e2c9]">Live</span>}</button>)}
    </nav>
    <div className="mt-auto">
      <div className="rounded-xl border border-white/10 bg-white/[.04] p-3 mb-4"><div className="flex items-center gap-2 text-[#bde6d4] text-xs font-semibold"><ShieldCheck size={14} /> Owner workspace</div><p className="text-[11px] leading-relaxed text-[#8faea1] mt-2">Single studio view. Historical records stay protected.</p></div>
      <div className="flex items-center gap-3 px-2"><div className="h-8 w-8 rounded-full bg-[#c9f0dc] text-[#145b43] flex items-center justify-center text-xs font-bold">{initials(user?.name)}</div><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-white truncate">{user?.name || "Owner"}</div><div className="text-[10px] text-[#8faea1] truncate">{user?.email || "Owner access"}</div></div><button aria-label="Sign out" className="text-[#86a69a] hover:text-white" onClick={logout}><ExternalLink size={14} /></button></div>
    </div>
  </aside>;
}

function Header({ page, setPage, onAdd }: { page: PageKey; setPage: (page: PageKey) => void; onAdd: () => void }) {
  const label = navItems.find(item => item.key === page)?.label || "Dashboard";
  return <>
    <div className="mobile-topbar"><div className="flex items-center gap-2"><div className="h-9 w-9 rounded-lg bg-[#10251f] text-[#c9f0dc] flex items-center justify-center"><Dumbbell size={18} /></div><div><div className="font-display font-bold text-sm">Dream Big</div><div className="text-[10px] text-muted-foreground">Fitness Studio</div></div></div><button className="btn btn-ghost !min-h-9 !px-3" onClick={() => { const next = page === "dashboard" ? "members" : "dashboard"; setPage(next); }}><Menu size={16} /> <span>{label}</span></button></div>
    <div className="mobile-menu">{navItems.map(({ key, label: itemLabel, icon: Icon }) => <button key={key} className={`nav-link ${page === key ? "active" : ""}`} onClick={() => setPage(key)}><Icon size={15} />{itemLabel}</button>)}</div>
    <header className="flex items-center justify-between gap-3 mb-7"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Owner workspace</span><ChevronRight size={13} /><span className="text-foreground font-semibold">{label}</span></div><div className="flex items-center gap-2"><div className="hidden md:flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground"><Search size={14} /> Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘ K</kbd> to search</div>{page === "members" && <button className="btn btn-primary" onClick={onAdd}><Plus size={16} /> Add member</button>}<button aria-label="Notifications" className="h-10 w-10 rounded-lg border border-border bg-white flex items-center justify-center text-muted-foreground hover:text-primary transition-smooth"><Bell size={17} /></button></div></header>
  </>;
}

function DataAccessNotice({ status, error }: { status?: string; error?: any }) {
  if (!error && status !== "empty_or_blocked") return null;
  return (
    <div className="data-alert flex gap-3 items-start mb-5">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <div>
        <div className="font-semibold">{error ? "Database error" : "Supabase data notice"}</div>
        <div className="mt-1">
          {error
            ? (error.message || "The live query could not complete. Check the Supabase authenticated session and RLS policies.")
            : "No records found in this view. If you just connected a new project, verify that records exist and your account has access."}
        </div>
      </div>
    </div>
  );
}

function DashboardPage({
  data,
  error,
  onOpenMember,
  onRenewMember,
  onOpenWhatsApp,
  onViewAllStatus,
}: {
  data?: AnyRow;
  error?: any;
  onOpenMember: (member: AnyRow) => void;
  onRenewMember: (member: AnyRow) => void;
  onOpenWhatsApp: (member: AnyRow) => void;
  onViewAllStatus: (status: string) => void;
}) {
  const statusColors: Record<string, string> = {
    Paid: "#10b981",
    "Due / Unpaid": "#f59e0b",
    Deactive: "#ef4444",
    "Needs review": "#64748b",
  };

  const statusDist = data?.statusDistribution || [];
  const pkgDist = data?.packageDistribution || [];
  const renewalTL = data?.renewalTimeline || [];
  const monthlyTrend = data?.monthlyPaymentTrend || [];
  const newMembersTrend = data?.newMembersTrend || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#13795b] mb-3">
            <span className="h-2 w-2 rounded-full bg-[#41b77c] shadow-[0_0_0_4px_rgba(65,183,124,.13)]" /> Live studio overview
          </div>
          <h1 className="page-title">Good morning, Owner</h1>
          <p className="text-sm text-muted-foreground mt-2">Real-time studio statistics based on member status logic.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <CalendarDays size={14} /> {today.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <button className="btn btn-ghost hidden sm:inline-flex" onClick={() => window.location.reload()}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <DataAccessNotice status={data?.sourceStatus} error={error} />

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="card p-4 flex flex-col justify-between">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">Total Members</div>
          <div className="font-display font-bold text-2xl mt-1">{data ? data.totalMembers : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("all")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="card p-4 flex flex-col justify-between border-l-4 border-l-[#10b981]">
          <div className="text-[10px] uppercase font-bold text-[#10b981]">Paid</div>
          <div className="font-display font-bold text-2xl mt-1">{data ? data.paidCount : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("Paid")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="card p-4 flex flex-col justify-between border-l-4 border-l-[#f59e0b]">
          <div className="text-[10px] uppercase font-bold text-[#b07818]">Due / Unpaid</div>
          <div className="font-display font-bold text-2xl mt-1">{data ? data.dueUnpaidCount : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("Due_or_Unpaid")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="card p-4 flex flex-col justify-between border-l-4 border-l-[#ef4444]">
          <div className="text-[10px] uppercase font-bold text-[#b03842]">Deactive</div>
          <div className="font-display font-bold text-2xl mt-1">{data ? data.deactiveCount : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("Deactive")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="card p-4 flex flex-col justify-between border-l-4 border-l-[#64748b]">
          <div className="text-[10px] uppercase font-bold text-[#475569]">Needs Review</div>
          <div className="font-display font-bold text-2xl mt-1">{data ? data.needsReviewCount : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("needs_review")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="card p-4 flex flex-col justify-between bg-[#fff9ed]">
          <div className="text-[10px] uppercase font-bold text-[#b07818]">Total Pending</div>
          <div className="font-display font-bold text-xl mt-1 text-[#b07818]">{data ? money(data.totalPendingAmount) : "—"}</div>
          <button className="text-[11px] font-bold text-primary hover:underline mt-2 text-left flex items-center gap-1" onClick={() => onViewAllStatus("Due_or_Unpaid")}>
            View All <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Recharts Section — 5 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Chart 1: Member Status Distribution */}
        <div className="card p-5">
          <h3 className="section-title">Member Status Distribution</h3>
          <p className="text-xs text-muted-foreground mb-4">Breakdown by current single-source-of-truth status</p>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusDist} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusDist.map((entry: any) => (
                    <Cell key={entry.name} fill={statusColors[entry.name] || "#8884d8"} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, "Members"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Package Distribution */}
        <div className="card p-5">
          <h3 className="section-title">Package Distribution</h3>
          <p className="text-xs text-muted-foreground mb-4">Active member enrollment by membership package</p>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pkgDist}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#145b43" radius={[4, 4, 0, 0]} name="Members" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Renewal Timeline */}
        <div className="card p-5">
          <h3 className="section-title">Renewal Timeline</h3>
          <p className="text-xs text-muted-foreground mb-4">Upcoming and recent expiration windows</p>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={renewalTL}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Members" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Monthly Payment Trend */}
        <div className="card p-5">
          <h3 className="section-title">Monthly Payment Trend</h3>
          <p className="text-xs text-muted-foreground mb-4">Collected vs Due amounts by billing month</p>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
                <Bar dataKey="paid" fill="#10b981" name="Paid Amount" stackId="a" />
                <Bar dataKey="due" fill="#f59e0b" name="Due Amount" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 5: New Members Trend */}
        <div className="card p-5 col-span-1 lg:col-span-2">
          <h3 className="section-title">New Members Trend</h3>
          <p className="text-xs text-muted-foreground mb-4">Monthly joiners based on member joining dates</p>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={newMembersTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#145b43" strokeWidth={3} dot={{ r: 5 }} name="New Members" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Actionable Sections */}
      <div className="space-y-6">
        {/* Renewals Due Soon */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="section-title">Renewals Due Soon (Next 30 Days)</h2>
              <p className="text-xs text-muted-foreground mt-1">Active members approaching renewal date</p>
            </div>
            <button className="text-xs font-bold text-primary hover:underline" onClick={() => onViewAllStatus("Paid")}>View All Paid</button>
          </div>
          {data?.renewalsDueSoon?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Member</th><th>Register No</th><th>Package</th><th>Renewal Date</th><th>Days Remaining</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {data.renewalsDueSoon.slice(0, 5).map((m: AnyRow) => (
                    <tr key={m.register_no}>
                      <td><button className="font-semibold text-left" onClick={() => onOpenMember(m)}>{m.name}</button></td>
                      <td className="font-mono text-xs">#{m.register_no}</td>
                      <td>{m.package_name || "—"}</td>
                      <td>{date(m.renewal_date)}</td>
                      <td><span className="font-bold text-[#10b981]">{m.daysRemaining} days remaining</span></td>
                      <td><Badge tone="green">Paid</Badge></td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => onRenewMember(m)}>Renew</button>
                          <WhatsAppButton member={m} onOpen={onOpenWhatsApp} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={RefreshCw} title="No renewals due soon" copy="All active members have plenty of coverage remaining." />
          )}
        </section>

        {/* Recently Expired (Due / Unpaid) */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="section-title">Recently Expired (Due / Unpaid)</h2>
              <p className="text-xs text-muted-foreground mt-1">Expired within the last 2 completed calendar months window</p>
            </div>
            <button className="text-xs font-bold text-primary hover:underline" onClick={() => onViewAllStatus("Due_or_Unpaid")}>View All Due / Unpaid</button>
          </div>
          {data?.recentlyExpiredList?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Member</th><th>Register No</th><th>Package</th><th>Expired Date</th><th>Pending</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {data.recentlyExpiredList.slice(0, 5).map((m: AnyRow) => (
                    <tr key={m.register_no}>
                      <td><button className="font-semibold text-left" onClick={() => onOpenMember(m)}>{m.name}</button></td>
                      <td className="font-mono text-xs">#{m.register_no}</td>
                      <td>{m.package_name || "—"}</td>
                      <td className="font-bold text-[#b07818]">{date(m.renewal_date)}</td>
                      <td>{money(m.pending_amount)}</td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-primary !py-1 !px-2 text-xs" onClick={() => onRenewMember(m)}>Renew Now</button>
                          <WhatsAppButton member={m} onOpen={onOpenWhatsApp} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Check} title="No recently expired members" copy="No members are currently due for renewal." />
          )}
        </section>

        {/* Deactive Members */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="section-title">Deactive Members</h2>
              <p className="text-xs text-muted-foreground mt-1">Expired prior to the two-month window (long lapsed)</p>
            </div>
            <button className="text-xs font-bold text-primary hover:underline" onClick={() => onViewAllStatus("Deactive")}>View All Deactive</button>
          </div>
          {data?.deactiveList?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Member</th><th>Register No</th><th>Package</th><th>Expired Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {data.deactiveList.slice(0, 5).map((m: AnyRow) => (
                    <tr key={m.register_no}>
                      <td><button className="font-semibold text-left" onClick={() => onOpenMember(m)}>{m.name}</button></td>
                      <td className="font-mono text-xs">#{m.register_no}</td>
                      <td>{m.package_name || "—"}</td>
                      <td className="text-[#b03842]">{date(m.renewal_date)}</td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => onRenewMember(m)}>Reactivate</button>
                          <WhatsAppButton member={m} onOpen={onOpenWhatsApp} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="No deactive members" copy="All historical members are currently active or due." />
          )}
        </section>

        {/* Needs Review */}
        {Boolean(data?.needsReviewList?.length) && (
          <section className="card p-5 border-l-4 border-l-[#64748b] bg-[#f8fafc]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="section-title text-[#334155]">Needs Review (Payment Exception)</h2>
                <p className="text-xs text-muted-foreground mt-1">Members with unresolved needs_review payment records</p>
              </div>
              <button className="text-xs font-bold text-primary hover:underline" onClick={() => onViewAllStatus("needs_review")}>View All Needs Review</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Member</th><th>Register No</th><th>Package</th><th>Issue Reason</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {data?.needsReviewList?.slice(0, 5).map((m: AnyRow) => (
                    <tr key={m.register_no}>
                      <td><button className="font-semibold text-left" onClick={() => onOpenMember(m)}>{m.name}</button></td>
                      <td className="font-mono text-xs">#{m.register_no}</td>
                      <td>{m.package_name || "—"}</td>
                      <td className="text-xs text-[#64748b]">Unresolved needs_review payment record</td>
                      <td>
                        <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => onOpenMember(m)}>Inspect Record</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ListHeader({ title, subtitle, action }: { title: string; subtitle: string; action: string }) { return <div className="flex items-start justify-between mb-4"><div><h2 className="section-title">{title}</h2><p className="text-xs text-muted-foreground mt-1">{subtitle}</p></div><button className="text-xs font-bold text-primary hover:underline" onClick={() => toast.info(`${action} from the sidebar.`)}>{action}</button></div>; }
function EmptyState({ icon: Icon, title, copy }: { icon: typeof Users; title: string; copy: string }) { return <div className="empty-state"><Icon size={22} className="mx-auto text-[#6e9d8b]" /><div className="text-sm font-semibold mt-3">{title}</div><div className="text-xs text-muted-foreground mt-1">{copy}</div></div>; }

function StatusSummaryBar({ members, active, onPick }: { members: MemberWithStatus[]; active: string; onPick: (status: string) => void }) {
  const summary = useMemo(() => summarizeStatuses(members), [members]);
  const cards: { key: string; label: string; value: number; tone: string }[] = [
    { key: "all", label: "Total members", value: summary.totalMembers, tone: "green" },
    { key: "Paid", label: "Paid", value: summary.Paid, tone: "green" },
    { key: "Due_or_Unpaid", label: "Due / Unpaid", value: summary.Due_or_Unpaid, tone: "amber" },
    { key: "Deactive", label: "Deactive", value: summary.Deactive, tone: "red" },
    { key: "needs_review", label: "Needs review", value: summary.needs_review, tone: "slate" },
  ];
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
    {cards.map(card => <button key={card.key} onClick={() => onPick(card.key)} className={`card px-4 py-3 text-left transition-smooth ${active === card.key ? "ring-2 ring-[#41b77c]" : ""}`}>
      <div className="flex items-center gap-2"><span className={`badge badge-${card.tone}`}>{card.label}</span></div>
      <div className="font-display font-bold text-[22px] mt-2 tracking-tight">{card.value}</div>
    </button>)}
  </div>;
}

function getMemberSearchRelevance(member: AnyRow, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const regStr = String(member.register_no ?? "").trim();
  const nameStr = String(member.name ?? "").trim().toLowerCase();
  const mobileStr = String(member.mobile_no ?? "").trim();

  // 1. Exact match on register number (e.g. searching "385" matches #385)
  if (regStr === q || Number(regStr) === Number(q)) {
    return 10000;
  }

  // 2. Exact match on member name
  if (nameStr === q) {
    return 9000;
  }

  // 3. Register number starts with query (e.g. searching "38" matches #38, #385 before mobile numbers)
  if (regStr.startsWith(q)) {
    return 8000 - regStr.length;
  }

  // 4. Name starts with query (e.g. "dilip" matches "Dilip Kumar")
  if (nameStr.startsWith(q)) {
    return 7000;
  }

  // 5. Any word in the name starts with query (e.g. "kumar" matches "Dilip Kumar")
  const words = nameStr.split(/\s+/);
  if (words.some(w => w.startsWith(q))) {
    return 6000;
  }

  // 6. Name contains query
  if (nameStr.includes(q)) {
    return 5000;
  }

  // 7. Exact mobile number match
  if (mobileStr === q) {
    return 4000;
  }

  // 8. Mobile number starts with query
  if (mobileStr.startsWith(q)) {
    return 3000;
  }

  // 9. Register number contains query
  if (regStr.includes(q)) {
    return 2000;
  }

  // 10. Mobile number contains query (random substring in 10 digits)
  if (mobileStr.includes(q)) {
    return 1000;
  }

  return 0;
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  pageSize,
  pageSizeOptions = [15, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  itemName = "records",
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  itemName?: string;
}) {
  if (totalItems === 0) return null;

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3.5 border-t border-border bg-[#fafcfb] text-xs text-muted-foreground">
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          Showing <span className="font-bold text-foreground">{totalItems > 0 ? startIndex + 1 : 0}</span> to{" "}
          <span className="font-bold text-foreground">{endIndex}</span> of{" "}
          <span className="font-bold text-foreground">{totalItems}</span> {itemName}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-2">
            <span>Per page:</span>
            <select
              className="select !min-h-[30px] !h-[30px] !py-0 !px-2 text-xs font-semibold bg-white border-border rounded-lg"
              value={pageSize}
              onChange={e => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          className="btn btn-ghost !min-h-[32px] !h-[32px] !px-2.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} /> Prev
        </button>

        <div className="flex items-center gap-1">
          {getPageNumbers().map((p, idx) =>
            p === "..." ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground font-bold">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`min-w-[32px] h-[32px] px-2 rounded-lg font-bold text-xs transition-colors ${
                  currentPage === p
                    ? "bg-[#145b43] text-white shadow-sm"
                    : "border border-transparent hover:border-border hover:bg-white text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onPageChange(p as number)}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          className="btn btn-ghost !min-h-[32px] !h-[32px] !px-2.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          Next <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function MembersPage({
  members,
  loading,
  error,
  initialStatusFilter = "all",
  onOpenMember,
  onOpenPaymentHistory,
  onSettlePending,
  onRenewMember,
  onOpenWhatsApp,
  onAdd,
}: {
  members?: MemberWithStatus[];
  loading: boolean;
  error?: any;
  initialStatusFilter?: string;
  onOpenMember: (member: AnyRow) => void;
  onOpenPaymentHistory: (member: AnyRow) => void;
  onSettlePending: (member: AnyRow) => void;
  onRenewMember: (member: AnyRow) => void;
  onOpenWhatsApp: (member: AnyRow) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatusFilter);
  const [payment, setPayment] = useState("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    setStatus(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    setPageNumber(1);
  }, [search, status, payment, packageFilter]);

  const rows = members || [];
  const packages = useMemo(() => Array.from(new Set(rows.map(m => m.package_name).filter(Boolean))), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = rows.filter(member => {
      const matchesSearch =
        !needle ||
        [member.name, member.register_no, member.mobile_no].some(value =>
          String(value ?? "").toLowerCase().includes(needle)
        );
      const matchesStatus = status === "all" || member.current_status === status;
      const pending = Number(member.pending_amount || 0);
      const matchesPayment =
        payment === "all" ||
        (payment === "pending" && pending > 0) ||
        (payment === "settled" && pending <= 0);
      return (
        matchesSearch &&
        matchesStatus &&
        matchesPayment &&
        (packageFilter === "all" || member.package_name === packageFilter)
      );
    });

    if (needle) {
      result.sort((a, b) => {
        const scoreA = getMemberSearchRelevance(a, needle);
        const scoreB = getMemberSearchRelevance(b, needle);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return Number(b.register_no) - Number(a.register_no);
      });
    }

    return result;
  }, [rows, search, status, payment, packageFilter]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(pageNumber, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedRows = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.12em] text-[#13795b] mb-3">
            Member directory
          </div>
          <h1 className="page-title">Members</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Current status is calculated automatically from live payment data — it is never edited by hand.
          </p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} /> Add member
        </button>
      </div>
      <DataAccessNotice error={error} status={!loading && !rows.length ? "empty_or_blocked" : undefined} />
      <StatusSummaryBar members={rows} active={status} onPick={setStatus} />
      <div className="card p-4 mb-4">
        <div className="filter-row">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="input input-with-icon"
              placeholder="Search name, register no, mobile"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All current status</option>
            <option value="Paid">Paid</option>
            <option value="Due_or_Unpaid">Due / Unpaid</option>
            <option value="Deactive">Deactive</option>
            <option value="needs_review">Needs review</option>
          </select>
          <select className="select" value={payment} onChange={e => setPayment(e.target.value)}>
            <option value="all">All payment balance</option>
            <option value="pending">Has pending amount</option>
            <option value="settled">Fully paid</option>
          </select>
          <select className="select" value={packageFilter} onChange={e => setPackageFilter(e.target.value)}>
            <option value="all">All packages</option>
            {packages.map((item: string) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mt-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={13} /> Showing{" "}
            <span className="font-bold text-foreground">
              {totalItems > 0 ? startIndex + 1 : 0}-{endIndex}
            </span>{" "}
            of <span className="font-bold text-foreground">{totalItems}</span>{" "}
            {totalItems === rows.length ? "records" : `filtered records (${rows.length} total)`}
          </div>
          {(search || status !== "all" || payment !== "all" || packageFilter !== "all") && (
            <button
              className="text-primary font-bold hover:underline"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setPayment("all");
                setPackageFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Register no</th>
                <th>Package</th>
                <th>Renewal</th>
                <th>Pending</th>
                <th>Current status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={7} />
              ) : paginatedRows.length ? (
                paginatedRows.map(member => {
                  const badge = statusForMember(member);
                  const hasPending = Number(member.pending_amount) > 0;
                  return (
                    <tr key={member.register_no}>
                      <td>
                        <button className="flex items-center gap-3 text-left" onClick={() => onOpenMember(member)}>
                          <Avatar name={member.name} small />
                          <span>
                            <span className="block font-semibold">{member.name}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {member.mobile_no || "No mobile"}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">#{member.register_no}</td>
                      <td>
                        <div className="font-medium">{member.package_name || "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{member.package_code || "No code"}</div>
                      </td>
                      <td>{date(member.effective_renewal_date ?? member.renewal_date)}</td>
                      <td>
                        {hasPending ? (
                          <button
                            className="font-bold text-[#b07818] hover:underline cursor-pointer flex items-center gap-1"
                            title="Click to collect pending balance"
                            onClick={() => onSettlePending(member)}
                          >
                            {money(member.pending_amount)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{money(member.pending_amount)}</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td>
                        <div className="flex justify-end gap-2 items-center">
                          <button
                            className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-[#13795b] hover:border-[#13795b] hover:bg-[#e7f4ed] transition-colors"
                            title={`View entire payment history for ${member.name}`}
                            onClick={() => onOpenPaymentHistory(member)}
                            aria-label={`View payment history for ${member.name}`}
                          >
                            <Info size={16} />
                          </button>
                          {hasPending && (
                            <button
                              className="btn btn-ghost !py-1 !px-2.5 text-xs font-semibold text-[#b07818] border border-amber-200 bg-amber-50 hover:bg-amber-100 flex items-center gap-1"
                              title="Collect pending balance"
                              onClick={() => onSettlePending(member)}
                            >
                              <CircleDollarSign size={13} /> Settle
                            </button>
                          )}
                          <button
                            className="btn btn-ghost !py-1 !px-2 text-xs"
                            onClick={() => onRenewMember(member)}
                          >
                            Renew
                          </button>
                          <WhatsAppButton member={member} onOpen={onOpenWhatsApp} />
                          <button
                            className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-primary"
                            onClick={() => onOpenMember(member)}
                            aria-label={`View ${member.name}`}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={Users}
                      title="No members match these filters"
                      copy="Try clearing a filter or searching a different identifier."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={safePage}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50, 100]}
          onPageChange={setPageNumber}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageNumber(1);
          }}
          itemName="members"
        />
      </div>
    </div>
  );
}
function PaymentsPage({
  payments,
  members,
  loading,
  error,
  onOpenMember,
  onOpenWhatsApp,
  monthValue,
  onMonthChange,
}: {
  payments?: AnyRow[];
  members?: AnyRow[];
  loading: boolean;
  error?: any;
  onOpenMember: (member: AnyRow) => void;
  onOpenWhatsApp: (member: AnyRow) => void;
  monthValue: string;
  onMonthChange: (month: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    setPageNumber(1);
  }, [search, status, monthValue]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = (payments || []).filter(row => {
      const isPending =
        Number(row.pending_amount || 0) > 0 ||
        ["due_or_unpaid", "partial"].includes(String(row.payment_status));
      const matchesSearch =
        !needle ||
        [row.name, row.register_no, row.package_name].some(v =>
          String(v ?? "").toLowerCase().includes(needle)
        );
      const matchesStatus =
        status === "all" ||
        (status === "pending" && isPending) ||
        (status === "paid" && !isPending);
      return matchesSearch && matchesStatus;
    });

    if (needle) {
      result.sort((a, b) => {
        const scoreA = getMemberSearchRelevance(a, needle);
        const scoreB = getMemberSearchRelevance(b, needle);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return Number(b.register_no) - Number(a.register_no);
      });
    }

    return result;
  }, [payments, search, status]);

  const memberFor = (row: AnyRow) =>
    (members || []).find(member => Number(member.register_no) === Number(row.register_no)) || row;

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(pageNumber, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedRows = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.12em] text-[#13795b] mb-3">Collections</div>
          <h1 className="page-title">Payments</h1>
          <p className="text-sm text-muted-foreground mt-2">Historical monthly payment records, kept separate from member profiles.</p>
        </div>
        <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <WalletCards size={14} /> {money(filtered.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0))} collected
        </div>
      </div>
      <DataAccessNotice error={error} />
      <div className="card p-4 mb-4">
        <div className="filter-row">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className="input input-with-icon"
              placeholder="Search member, register no, package"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <input
            className="input"
            type="month"
            value={monthValue.slice(0, 7)}
            onChange={e => onMonthChange(`${e.target.value}-01`)}
          />
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All payment status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending / partial</option>
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => toast.info("Payment records are read-only history. Create a renewal from the member workflow.")}
          >
            <Settings2 size={15} /> View rules
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mt-3 flex-wrap">
          <div>
            Showing <span className="font-bold text-foreground">{totalItems > 0 ? startIndex + 1 : 0}-{endIndex}</span> of{" "}
            <span className="font-bold text-foreground">{totalItems}</span> visible records for{" "}
            <span className="font-semibold text-foreground">{date(monthValue).slice(4)}</span>
          </div>
          {(search || status !== "all") && (
            <button
              className="text-primary font-bold hover:underline"
              onClick={() => {
                setSearch("");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Billing month</th>
                <th>Member</th>
                <th>Package</th>
                <th>Renewal</th>
                <th>Due</th>
                <th>Paid</th>
                <th>Pending</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={9} />
              ) : paginatedRows.length ? (
                paginatedRows.map(row => {
                  const member = memberFor(row);
                  const isPending = Number(row.pending_amount || 0) > 0;
                  return (
                    <tr key={row.id}>
                      <td>{shortDate(row.billing_month)}</td>
                      <td>
                        <button className="flex items-center gap-2 text-left" onClick={() => onOpenMember(member)}>
                          <Avatar name={row.name || member.name} small />
                          <span>
                            <span className="block font-semibold">{row.name || member.name || "—"}</span>
                            <span className="text-[11px] text-muted-foreground">#{row.register_no}</span>
                          </span>
                        </button>
                      </td>
                      <td>{row.package_name || "—"}</td>
                      <td>{date(row.renewal_date)}</td>
                      <td>{money(row.amount_due)}</td>
                      <td className="font-semibold text-[#257651]">{money(row.paid_amount)}</td>
                      <td className={isPending ? "font-bold text-[#b07818]" : "text-muted-foreground"}>
                        {money(row.pending_amount)}
                      </td>
                      <td>
                        <Badge tone={isPending ? "amber" : "green"}>
                          {isPending ? (row.paid_amount ? "Partial" : "Due") : "Paid"}
                        </Badge>
                      </td>
                      <td>
                        <WhatsAppButton member={member} onOpen={onOpenWhatsApp} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={WalletCards}
                      title="No payment records for this view"
                      copy="Try another month or clear your filters."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={safePage}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50, 100]}
          onPageChange={setPageNumber}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageNumber(1);
          }}
          itemName="records"
        />
      </div>
    </div>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <>
      {[1, 2, 3, 4].map(row => (
        <tr key={row}>
          {Array.from({ length: columns }).map((_, column) => (
            <td key={column}>
              <div className="h-4 rounded bg-[#eef2f1] animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RenewalsPage({
  members,
  loading,
  error,
  onOpenMember,
  onOpenPaymentHistory,
  onRenewMember,
  onOpenWhatsApp,
}: {
  members?: AnyRow[];
  loading: boolean;
  error?: any;
  onOpenMember: (member: AnyRow) => void;
  onOpenPaymentHistory?: (member: AnyRow) => void;
  onRenewMember: (member: AnyRow) => void;
  onOpenWhatsApp: (member: AnyRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    setPageNumber(1);
  }, [bucket, search]);

  const rows = useMemo(() => {
    const raw = (members || []).filter(member => {
      const renewal = String(member.effective_renewal_date ?? member.renewal_date ?? "").slice(0, 10);
      const diff = Math.round(
        (new Date(`${renewal}T00:00:00Z`).getTime() - new Date(`${todayIso}T00:00:00Z`).getTime()) /
          86400000
      );
      return (
        bucket === "all" ||
        (bucket === "expired" && diff < 0) ||
        (bucket === "today" && diff === 0) ||
        (bucket === "week" && diff >= 0 && diff <= 7) ||
        (bucket === "month" && diff >= 0 && diff <= 30)
      );
    });

    const needle = search.trim().toLowerCase();
    const result = raw.filter(member => {
      return (
        !needle ||
        [member.name, member.register_no, member.mobile_no, member.package_name].some(v =>
          String(v ?? "").toLowerCase().includes(needle)
        )
      );
    });

    if (needle) {
      result.sort((a, b) => {
        const scoreA = getMemberSearchRelevance(a, needle);
        const scoreB = getMemberSearchRelevance(b, needle);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return Number(b.register_no) - Number(a.register_no);
      });
    } else {
      result.sort((a, b) =>
        String(a.effective_renewal_date ?? a.renewal_date).localeCompare(
          String(b.effective_renewal_date ?? b.renewal_date)
        )
      );
    }

    return result;
  }, [members, bucket, search]);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(pageNumber, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.12em] text-[#13795b] mb-3">
            Retention queue
          </div>
          <h1 className="page-title">Renewals</h1>
          <p className="text-sm text-muted-foreground mt-2">
            A focused follow-up list for members who are due or overdue.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw size={15} /> {rows.length} to follow up
        </div>
      </div>
      <DataAccessNotice error={error} status={!loading && !members?.length ? "empty_or_blocked" : undefined} />
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All renewals"],
            ["expired", "Expired"],
            ["today", "Due today"],
            ["week", "Next 7 days"],
            ["month", "Next 30 days"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`btn ${bucket === key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setBucket(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            className="input input-with-icon"
            placeholder="Search member, mobile, package"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Mobile</th>
                <th>Package</th>
                <th>Renewal date</th>
                <th>Amount</th>
                <th>Pending</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={8} />
              ) : paginatedRows.length ? (
                paginatedRows.map(member => {
                  const status = statusForMember(member);
                  return (
                    <tr key={member.register_no}>
                      <td>
                        <button className="flex items-center gap-3 text-left" onClick={() => onOpenMember(member)}>
                          <Avatar name={member.name} small />
                          <span>
                            <span className="block font-semibold">{member.name}</span>
                            <span className="text-[11px] text-muted-foreground">#{member.register_no}</span>
                          </span>
                        </button>
                      </td>
                      <td>{member.mobile_no || "—"}</td>
                      <td>{member.package_name || "—"}</td>
                      <td className="font-semibold">{date(member.effective_renewal_date ?? member.renewal_date)}</td>
                      <td>{money(member.amount)}</td>
                      <td
                        className={
                          Number(member.pending_amount) > 0 ? "font-bold text-[#b07818]" : "text-muted-foreground"
                        }
                      >
                        {money(member.pending_amount)}
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td>
                        <div className="flex gap-2 items-center">
                          {onOpenPaymentHistory && (
                            <button
                              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-[#13795b] hover:border-[#13795b] hover:bg-[#e7f4ed] transition-colors"
                              title={`View complete payment history for ${member.name}`}
                              onClick={() => onOpenPaymentHistory(member)}
                              aria-label={`View payment history for ${member.name}`}
                            >
                              <Info size={16} />
                            </button>
                          )}
                          <button
                            className="btn btn-ghost !py-1 !px-2 text-xs"
                            onClick={() => onRenewMember(member)}
                          >
                            Renew
                          </button>
                          <WhatsAppButton member={member} onOpen={onOpenWhatsApp} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={RefreshCw}
                      title="No renewals in this window"
                      copy="Try a wider date range or clear search query."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={safePage}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50, 100]}
          onPageChange={setPageNumber}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageNumber(1);
          }}
          itemName="renewals"
        />
      </div>
    </div>
  );
}

function PlansPage({ plans, loading, error }: { plans?: AnyRow[]; loading: boolean; error?: any }) {
  const grouped = useMemo(() => Object.values((plans || []).reduce((acc: Record<string, AnyRow[]>, plan: AnyRow) => { const key = plan.plan_name || "Other"; (acc[key] ||= []).push(plan); return acc; }, {})), [plans]);
  return <div><div className="page-header"><div><div className="text-xs font-bold uppercase tracking-[.12em] text-[#13795b] mb-3">Official pricing</div><h1 className="page-title">Membership plans</h1><p className="text-sm text-muted-foreground mt-2">Pricing is read from Supabase. Historical member amounts are never overwritten.</p></div><div className="badge badge-green"><ShieldCheck size={13} /> Source of truth</div></div><DataAccessNotice error={error} status={!loading && !plans?.length ? "empty_or_blocked" : undefined} /><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{loading ? [1, 2, 3].map(item => <div className="card p-5 h-52 animate-pulse bg-[#f0f3f2]" key={item} />) : grouped.length ? grouped.map((group: AnyRow[]) => <div className="card p-5" key={group[0]?.plan_name}><div className="flex items-start justify-between gap-3"><div className="h-10 w-10 rounded-xl bg-[#e7f4ed] text-[#1b7555] flex items-center justify-center"><Dumbbell size={18} /></div><span className="badge badge-slate">{group[0]?.plan_code || "Plan"}</span></div><h2 className="font-display font-bold text-xl mt-5">{group[0]?.plan_name}</h2><p className="text-xs text-muted-foreground min-h-9 mt-2">{group[0]?.description || "Flexible training membership for the studio."}</p><div className="space-y-2 mt-5">{group.sort((a, b) => Number(a.duration_months) - Number(b.duration_months)).map(plan => <div key={plan.id} className="flex items-center justify-between border-t border-[#edf1f2] pt-3"><div className="text-sm font-semibold">{plan.duration_months} month{Number(plan.duration_months) === 1 ? "" : "s"}</div><div className="text-right"><div className="font-display font-bold text-lg">{money(plan.price)}</div><div className="text-[10px] text-muted-foreground">+ {money(Number.isFinite(Number(plan.registration_fee)) ? Number(plan.registration_fee) : 0)} registration</div></div></div>)}</div></div>) : <div className="col-span-full"><EmptyState icon={Package} title="No membership plans visible" copy="Check Supabase read policies for membership_plans." /></div>}</div></div>;
}

function BalancePage({
  rows,
  loading,
  error,
  onManageRoster,
  onRecordExpenses,
}: {
  rows?: BalanceSheetRow[];
  loading: boolean;
  error?: any;
  onManageRoster: (monthIso: string) => void;
  onRecordExpenses: (monthIso?: string) => void;
}) {
  const sorted = rows || [];
  return (
    <div>
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.12em] text-[#13795b] mb-3">
            Monthly finance
          </div>
          <h1 className="page-title">Balance sheet</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Live dynamic monthly summaries with operating expense management.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary"
            onClick={() => onRecordExpenses()}
          >
            <Plus size={16} /> Record Gym Expenses
          </button>
        </div>
      </div>

      <DataAccessNotice error={error} status={!loading && !rows?.length ? "empty_or_blocked" : undefined} />

      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>New join</th>
                <th>Renewal</th>
                <th>Gym expenses</th>
                <th>Collections (Amount)</th>
                <th>Net Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton columns={7} />
              ) : sorted.length ? (
                sorted.map(row => (
                  <tr key={row.month} className="hover:bg-muted/40 transition-colors">
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{date(row.month)}</span>
                        {row.is_live && (
                          <span className="badge badge-green text-[10px] !py-0.5 !px-1.5 font-bold">
                            Live
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button
                        className="font-semibold text-foreground hover:text-[#13795b] hover:underline cursor-pointer"
                        title="Click to view new joins for this month"
                        onClick={() => onManageRoster(row.month)}
                      >
                        {row.new_join}
                      </button>
                    </td>
                    <td>
                      <button
                        className="font-semibold text-foreground hover:text-[#13795b] hover:underline cursor-pointer"
                        title="Click to view renewals for this month"
                        onClick={() => onManageRoster(row.month)}
                      >
                        {row.renewal}
                      </button>
                    </td>
                    <td>
                      {row.gym_expenses > 0 || row.expenses_entered ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[#b03842] font-semibold">
                            {money(row.gym_expenses)}
                          </span>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Edit expenses"
                            onClick={() => onRecordExpenses(row.month)}
                          >
                            <Settings2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-ghost !py-1 !px-2 text-xs text-[#b07818] font-semibold flex items-center gap-1 border border-amber-200 bg-amber-50 hover:bg-amber-100"
                          onClick={() => onRecordExpenses(row.month)}
                        >
                          <Plus size={12} /> Add expense
                        </button>
                      )}
                    </td>
                    <td className="text-[#257651] font-semibold">
                      {money(row.amount)}
                    </td>
                    <td className="font-display font-bold">
                      {money(row.total)}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-ghost !py-1 !px-2.5 text-xs flex items-center gap-1.5"
                          onClick={() => onManageRoster(row.month)}
                          title="View all members who joined or renewed this month"
                        >
                          <Users size={13} /> View roster
                        </button>
                        <button
                          className="btn btn-ghost !py-1 !px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => onRecordExpenses(row.month)}
                          title="Edit operating expenses for this month"
                        >
                          <Receipt size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={BarChart3}
                      title="No balance-sheet rows visible"
                      copy="Add an owner-authenticated SELECT policy to balance_sheet."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RecordExpensesModal({
  initialMonth,
  balanceRows,
  onClose,
  onDone,
}: {
  initialMonth?: string;
  balanceRows?: BalanceSheetRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const currentMonth = startOfMonth();
  const [selectedMonth, setSelectedMonth] = useState(
    initialMonth ? initialMonth.slice(0, 7) : currentMonth.slice(0, 7)
  );

  const matchedRow = useMemo(() => {
    const fullIso = `${selectedMonth}-01`;
    return (balanceRows || []).find(r => r.month === fullIso);
  }, [balanceRows, selectedMonth]);

  const [expenseAmount, setExpenseAmount] = useState<string>(
    matchedRow && matchedRow.gym_expenses > 0 ? String(matchedRow.gym_expenses) : ""
  );

  useEffect(() => {
    if (matchedRow && matchedRow.gym_expenses > 0) {
      setExpenseAmount(String(matchedRow.gym_expenses));
    }
  }, [matchedRow]);

  const grossCollections = matchedRow ? Number(matchedRow.amount || 0) : 0;
  const parsedExpenses = Number(expenseAmount) || 0;
  const netTotal = grossCollections - parsedExpenses;

  const mutation = useMutation({
    mutationFn: () =>
      upsertMonthlyExpenses({
        month: `${selectedMonth}-01`,
        gym_expenses: parsedExpenses,
      }),
    onSuccess: () => {
      toast.success(`Expenses updated for ${date(`${selectedMonth}-01`)}.`);
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer !max-w-md" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[.12em] text-[#13795b] font-bold">
              Studio Operating Expenses
            </div>
            <h2 className="font-display font-bold text-2xl mt-1">
              Record Gym Expenses
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Enter monthly operating expenses (rent, power, maintenance, trainer payouts) to compute net studio profit.
            </p>
          </div>
          <button
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block text-xs font-bold">
            Select Month *
            <input
              className="input mt-1"
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
            />
          </label>

          <div className="rounded-xl border border-border bg-[#f7faf8] p-4 text-xs space-y-2">
            <div className="font-bold text-sm text-foreground mb-2">
              Live Month Summary ({date(`${selectedMonth}-01`)})
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">New admissions:</span>
              <span className="font-bold">{matchedRow ? matchedRow.new_join : 0} members</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Renewals:</span>
              <span className="font-bold">{matchedRow ? matchedRow.renewal : 0} members</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Total Collections (Gross):</span>
              <span className="font-bold text-[#257651]">{money(grossCollections)}</span>
            </div>
          </div>

          <label className="block text-xs font-bold">
            Gym Operating Expenses (₹) *
            <input
              className="input mt-1 font-semibold text-[#b03842]"
              type="number"
              min="0"
              placeholder="e.g. 25000"
              value={expenseAmount}
              onChange={e => setExpenseAmount(e.target.value)}
            />
          </label>

          <div className="rounded-xl border border-[#c9f0dc] bg-[#e7f4ed] p-3 text-xs flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-bold text-[#145b43]">
                Calculated Net Profit
              </div>
              <div className="text-lg font-display font-bold text-[#145b43] mt-0.5">
                {money(netTotal)}
              </div>
            </div>
            <div className="text-right text-[11px] text-[#145b43]/80">
              Gross ({money(grossCollections)}) - Expenses ({money(parsedExpenses)})
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.isPending || expenseAmount === ""}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save Monthly Balance"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthlyRosterModal({
  monthIso,
  onClose,
  onOpenMember,
  onRecordExpenses,
}: {
  monthIso: string;
  onClose: () => void;
  onOpenMember: (member: AnyRow) => void;
  onRecordExpenses: (monthIso: string) => void;
}) {
  const [tab, setTab] = useState<"newJoins" | "renewals">("newJoins");
  const [search, setSearch] = useState("");

  const rosterQuery = useQuery({
    queryKey: ["monthlyRoster", monthIso],
    queryFn: () => getMonthlyRoster(monthIso),
  });

  const data = rosterQuery.data;
  const loading = rosterQuery.isLoading;

  const filteredNewJoins = useMemo(() => {
    const needle = search.toLowerCase();
    return (data?.newJoins || []).filter(m =>
      !needle || [m.name, m.register_no, m.mobile_no, m.package_name].some(v =>
        String(v ?? "").toLowerCase().includes(needle)
      )
    );
  }, [data?.newJoins, search]);

  const filteredRenewals = useMemo(() => {
    const needle = search.toLowerCase();
    return (data?.renewals || []).filter(m =>
      !needle || [m.name, m.register_no, m.package_name].some(v =>
        String(v ?? "").toLowerCase().includes(needle)
      )
    );
  }, [data?.renewals, search]);

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer !max-w-3xl" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[.12em] text-[#13795b] font-bold">
              Member Activity Breakdown
            </div>
            <h2 className="font-display font-bold text-2xl mt-1">
              {date(monthIso)} Activity Roster
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Manage all individuals who joined or renewed during this billing month.
            </p>
          </div>
          <button
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>

        {/* Metrics summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">New Joins</span>
            <span className="text-lg font-bold text-foreground mt-1 block">
              {loading ? "…" : data?.newJoins.length || 0}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">Renewals</span>
            <span className="text-lg font-bold text-foreground mt-1 block">
              {loading ? "…" : data?.renewals.length || 0}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">Collected</span>
            <span className="text-lg font-bold text-[#257651] mt-1 block">
              {loading ? "…" : money(data?.totalCollected)}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">Pending</span>
            <span className="text-lg font-bold text-[#b07818] mt-1 block">
              {loading ? "…" : money(data?.totalPending)}
            </span>
          </div>
        </div>

        {/* Tabs & Search */}
        <div className="flex items-center justify-between gap-3 mt-5 flex-wrap">
          <div className="flex items-center gap-1 bg-[#f0f3f2] p-1 rounded-xl">
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === "newJoins" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("newJoins")}
            >
              New Joins ({data?.newJoins.length || 0})
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === "renewals" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("renewals")}
            >
              Renewals ({data?.renewals.length || 0})
            </button>
          </div>

          <div className="relative min-w-56">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className="input input-with-icon text-xs py-1.5"
              placeholder="Search name, register no…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Member Table */}
        <div className="card overflow-hidden mt-4">
          <div className="table-wrap max-h-96 overflow-y-auto">
            {tab === "newJoins" ? (
              <table className="table text-xs">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Mobile</th>
                    <th>Package</th>
                    <th>Joining</th>
                    <th>Paid</th>
                    <th>Pending</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeleton columns={7} />
                  ) : filteredNewJoins.length ? (
                    filteredNewJoins.map(m => (
                      <tr key={m.register_no} className="hover:bg-muted/30">
                        <td>
                          <button
                            className="flex items-center gap-2 text-left hover:text-[#13795b]"
                            onClick={() => onOpenMember(m)}
                          >
                            <Avatar name={m.name} small />
                            <div>
                              <span className="block font-semibold">{m.name}</span>
                              <span className="text-[10px] text-muted-foreground">#{m.register_no}</span>
                            </div>
                          </button>
                        </td>
                        <td>{m.mobile_no || "—"}</td>
                        <td>{m.package_name || "—"}</td>
                        <td>{date(m.date_of_joining)}</td>
                        <td className="font-semibold text-[#257651]">{money(m.paid_amount)}</td>
                        <td className={Number(m.pending_amount) > 0 ? "font-bold text-[#b07818]" : "text-muted-foreground"}>
                          {money(m.pending_amount)}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost !py-1 !px-2.5 text-xs text-[#13795b] hover:bg-[#e7f4ed]"
                            onClick={() => onOpenMember(m)}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          icon={Users}
                          title="No new joins found"
                          copy={search ? "No members match your search." : "No new admissions recorded in this month."}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="table text-xs">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Package</th>
                    <th>Renewal Date</th>
                    <th>Paid</th>
                    <th>Pending</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeleton columns={7} />
                  ) : filteredRenewals.length ? (
                    filteredRenewals.map(m => (
                      <tr key={m.id || m.register_no} className="hover:bg-muted/30">
                        <td>
                          <button
                            className="flex items-center gap-2 text-left hover:text-[#13795b]"
                            onClick={() => onOpenMember(m)}
                          >
                            <Avatar name={m.name} small />
                            <div>
                              <span className="block font-semibold">{m.name}</span>
                              <span className="text-[10px] text-muted-foreground">#{m.register_no}</span>
                            </div>
                          </button>
                        </td>
                        <td>{m.package_name || "—"}</td>
                        <td>{date(m.renewal_date)}</td>
                        <td className="font-semibold text-[#257651]">{money(m.paid_amount)}</td>
                        <td className={Number(m.pending_amount) > 0 ? "font-bold text-[#b07818]" : "text-muted-foreground"}>
                          {money(m.pending_amount)}
                        </td>
                        <td>
                          <Badge tone={Number(m.pending_amount) > 0 ? "amber" : "green"}>
                            {m.payment_status || (Number(m.pending_amount) > 0 ? "Pending" : "Paid")}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost !py-1 !px-2.5 text-xs text-[#13795b] hover:bg-[#e7f4ed]"
                            onClick={() => onOpenMember(m)}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          icon={Users}
                          title="No renewals found"
                          copy={search ? "No renewals match your search." : "No renewals recorded in this month."}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            className="btn btn-ghost text-xs flex items-center gap-1.5"
            onClick={() => onRecordExpenses(monthIso)}
          >
            <Receipt size={14} /> Update Gym Expenses for {date(monthIso)}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberPaymentHistoryModal({
  member,
  onClose,
  onRenewMember,
  onSettlePending,
  onOpenWhatsApp,
  onManageMember,
}: {
  member: AnyRow;
  onClose: () => void;
  onRenewMember?: (member: AnyRow) => void;
  onSettlePending?: (member: AnyRow) => void;
  onOpenWhatsApp?: (member: AnyRow) => void;
  onManageMember?: (member: AnyRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "pending">("all");

  const registerNo = Number(member.register_no);
  const historyQuery = useQuery({
    queryKey: ["memberPayments", registerNo],
    queryFn: () => getPaymentHistory(registerNo),
  });

  const payments = historyQuery.data || [];
  const loading = historyQuery.isLoading;

  const totalPaid = useMemo(
    () => payments.reduce((acc, p) => acc + Number(p.paid_amount || 0), 0),
    [payments]
  );
  const totalDue = useMemo(
    () => payments.reduce((acc, p) => acc + Number(p.amount_due || 0), 0),
    [payments]
  );
  const totalPendingInRecords = useMemo(
    () => payments.reduce((acc, p) => acc + Number(p.pending_amount || 0), 0),
    [payments]
  );

  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return payments.filter(p => {
      const isPending =
        Number(p.pending_amount || 0) > 0 ||
        ["due_or_unpaid", "partial"].includes(String(p.payment_status));
      const matchesFilter =
        filter === "all" ||
        (filter === "paid" && !isPending) ||
        (filter === "pending" && isPending);
      const matchesSearch =
        !needle ||
        [p.billing_month, p.package_name, p.payment_status, p.amount_due, p.paid_amount]
          .some(v => String(v ?? "").toLowerCase().includes(needle));
      return matchesFilter && matchesSearch;
    });
  }, [payments, search, filter]);

  const badge = statusForMember(member);

  return (
    <div
      className="drawer-backdrop !z-[65]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer !max-w-3xl" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={member.name} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-2xl">{member.name}</h2>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold">#{member.register_no}</span>
                <span>•</span>
                <span>{member.mobile_no || "No mobile"}</span>
                <span>•</span>
                <span>{member.package_name || "Plan"}</span>
                <span>•</span>
                <span>Joined: {date(member.date_of_joining)}</span>
              </div>
            </div>
          </div>
          <button
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>

        {/* Financial Summary Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">
              Total Records
            </span>
            <span className="text-lg font-bold text-foreground mt-1 block">
              {loading ? "…" : `${payments.length} cycles`}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">
              Total Lifetime Paid
            </span>
            <span className="text-lg font-bold text-[#257651] mt-1 block">
              {loading ? "…" : money(totalPaid)}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">
              Total Billed Due
            </span>
            <span className="text-lg font-bold text-foreground mt-1 block">
              {loading ? "…" : money(totalDue)}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs">
            <span className="text-muted-foreground block text-[10px] uppercase font-bold">
              Pending Balance
            </span>
            <div className="flex items-center justify-between gap-1 mt-1">
              <span
                className={`text-lg font-bold ${
                  Number(member.pending_amount || 0) > 0 || totalPendingInRecords > 0
                    ? "text-[#b07818]"
                    : "text-[#257651]"
                }`}
              >
                {loading ? "…" : money(member.pending_amount ?? totalPendingInRecords)}
              </span>
              {onSettlePending && (Number(member.pending_amount || 0) > 0 || totalPendingInRecords > 0) && (
                <button
                  className="text-[11px] font-bold text-[#b07818] hover:underline"
                  onClick={() => onSettlePending(member)}
                >
                  Settle
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex items-center justify-between gap-3 mt-5 flex-wrap">
          <div className="flex items-center gap-1 bg-[#f0f3f2] p-1 rounded-xl">
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === "all"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter("all")}
            >
              All Records ({payments.length})
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === "paid"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter("paid")}
            >
              Paid
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === "pending"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter("pending")}
            >
              Pending / Due
            </button>
          </div>

          <div className="relative min-w-56">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className="input input-with-icon text-xs py-1.5"
              placeholder="Search billing month, plan…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Payment History Table */}
        <div className="card overflow-hidden mt-4">
          <div className="table-wrap max-h-96 overflow-y-auto">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>Billing Month</th>
                  <th>Package / Tag</th>
                  <th>Amount Due</th>
                  <th>Paid Amount</th>
                  <th>Pending Balance</th>
                  <th>Payment Status</th>
                  <th>Next Renewal</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton columns={7} />
                ) : filtered.length ? (
                  filtered.map(p => {
                    const isPending =
                      Number(p.pending_amount || 0) > 0 ||
                      ["due_or_unpaid", "partial"].includes(String(p.payment_status));
                    return (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <td className="font-semibold text-foreground">
                          {date(p.billing_month)}
                        </td>
                        <td>
                          <div>{p.package_name || member.package_name || "—"}</div>
                          {p.source_sheet && (
                            <span className="text-[10px] text-muted-foreground">
                              {p.source_sheet}
                            </span>
                          )}
                        </td>
                        <td className="font-semibold">{money(p.amount_due)}</td>
                        <td className="font-semibold text-[#257651]">
                          {money(p.paid_amount)}
                        </td>
                        <td
                          className={
                            isPending ? "font-bold text-[#b07818]" : "text-muted-foreground"
                          }
                        >
                          {money(p.pending_amount)}
                        </td>
                        <td>
                          <Badge tone={isPending ? "amber" : "green"}>
                            {p.payment_status || (isPending ? "Pending" : "Paid")}
                          </Badge>
                        </td>
                        <td className="text-muted-foreground">
                          {p.renewal_date ? date(p.renewal_date) : "—"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon={WalletCards}
                        title="No payment history records found"
                        copy={
                          search
                            ? "No payment records match your search filter."
                            : "No payment history found for this member."
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {onManageMember && (
              <button
                className="btn btn-ghost text-xs flex items-center gap-1.5"
                onClick={() => onManageMember(member)}
              >
                <UserRound size={14} /> Full Member Profile
              </button>
            )}
            {onOpenWhatsApp && (
              <WhatsAppButton member={member} onOpen={onOpenWhatsApp} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {onRenewMember && (
              <button
                className="btn btn-primary text-xs flex items-center gap-1.5"
                onClick={() => onRenewMember(member)}
              >
                <RefreshCw size={14} /> Renew Membership
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettlePendingModal({
  member,
  onClose,
  onDone,
}: {
  member: AnyRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const currentPending = Number(member.pending_amount || 0);
  const [collectAmount, setCollectAmount] = useState(
    String(currentPending > 0 ? currentPending : "")
  );

  const parsedAmount = Number(collectAmount) || 0;
  const remainingAfter = Math.max(0, currentPending - parsedAmount);

  const mutation = useMutation({
    mutationFn: () =>
      settlePendingBalance({
        register_no: Number(member.register_no),
        collect_amount: parsedAmount,
      }),
    onSuccess: () => {
      if (remainingAfter === 0) {
        toast.success(
          `Collected ${money(parsedAmount)}. Outstanding balance is fully settled! 🎉`
        );
      } else {
        toast.success(
          `Collected ${money(parsedAmount)}. Remaining pending balance: ${money(remainingAfter)}`
        );
      }
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div
      className="drawer-backdrop !z-[70]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer !max-w-md" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={member.name} />
            <div>
              <div className="text-xs uppercase tracking-[.12em] text-[#b07818] font-bold">
                Pending Balance Settlement
              </div>
              <h2 className="font-display font-bold text-2xl mt-0.5">{member.name}</h2>
              <div className="text-xs text-muted-foreground mt-0.5">
                Register #{member.register_no} • {member.mobile_no || "No mobile"}
              </div>
            </div>
          </div>
          <button
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>

        {/* Current Pending Banner */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mt-5 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold text-[#b07818]">
              Current Outstanding Balance
            </div>
            <div className="text-2xl font-display font-bold text-[#b07818] mt-0.5">
              {money(currentPending)}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            Package: <span className="font-semibold text-foreground">{member.package_name || "Plan"}</span>
          </div>
        </div>

        {/* Form Inputs */}
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-bold">
            Amount Collecting Now (₹) *
            <input
              className="input mt-1 text-lg font-bold text-[#145b43]"
              type="number"
              min="1"
              max={currentPending > 0 ? currentPending : undefined}
              placeholder="e.g. 500"
              value={collectAmount}
              onChange={e => setCollectAmount(e.target.value)}
            />
          </label>

          {/* Quick Pay Shortcut Pills */}
          {currentPending > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-semibold">Quick pick:</span>
              <button
                type="button"
                className="btn btn-ghost !py-1 !px-2.5 text-xs border border-border hover:bg-[#e7f4ed]"
                onClick={() => setCollectAmount(String(currentPending))}
              >
                Full Balance ({money(currentPending)})
              </button>
              {currentPending > 200 && (
                <button
                  type="button"
                  className="btn btn-ghost !py-1 !px-2.5 text-xs border border-border hover:bg-[#e7f4ed]"
                  onClick={() => setCollectAmount(String(Math.floor(currentPending / 2)))}
                >
                  Half ({money(Math.floor(currentPending / 2))})
                </button>
              )}
            </div>
          )}

          {/* Live Outcome Card */}
          <div className="rounded-xl border border-border bg-[#f7faf8] p-3 text-xs space-y-2">
            <div className="font-bold text-foreground text-xs">Summary after this payment:</div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Amount collected:</span>
              <span className="font-bold text-[#257651]">{money(parsedAmount)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Remaining pending balance:</span>
              <span
                className={`font-bold ${
                  remainingAfter === 0 ? "text-[#257651]" : "text-[#b07818]"
                }`}
              >
                {remainingAfter === 0 ? "₹0 (Fully Cleared! 🎉)" : money(remainingAfter)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.isPending || parsedAmount <= 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? "Recording…"
              : remainingAfter === 0
              ? "Settle Full Balance"
              : "Collect Partial Balance"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberDrawer({
  member,
  onClose,
  onRefresh,
  onRenewMember,
  onSettlePending,
  onOpenWhatsApp,
}: {
  member: AnyRow;
  onClose: () => void;
  onRefresh: () => void;
  onRenewMember: (member: AnyRow) => void;
  onSettlePending: (member: AnyRow) => void;
  onOpenWhatsApp: (member: AnyRow) => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["member", Number(member.register_no)], queryFn: () => getMemberDetail(Number(member.register_no)) });
  const [editing, setEditing] = useState(false);
  const [payingOpen, setPayingOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const status = statusForMember(member);
  const reason = (member.status_detail as any)?.reason as string | undefined;

  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><Avatar name={member.name} /><div><div className="font-display font-bold text-xl">{member.name}</div><div className="text-xs text-muted-foreground mt-1">Register #{member.register_no} · {member.mobile_no || "No mobile"}</div></div></div><button className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close member detail"><X size={17} /></button></div><div className="flex items-center gap-2 mt-5 flex-wrap"><Badge tone={status.tone}>{status.label}</Badge><button className="btn btn-primary" onClick={() => onRenewMember(member)}><RefreshCw size={14} /> Renew / Update Membership</button>{Number(member.pending_amount) > 0 && <button className="btn btn-ghost text-[#b07818] border border-amber-200 bg-amber-50 hover:bg-amber-100 font-semibold" onClick={() => onSettlePending(member)}><CircleDollarSign size={14} /> Settle pending</button>}<button className="btn btn-ghost" onClick={() => setPayingOpen(v => !v)}><WalletCards size={14} /> Record payment</button><WhatsAppButton member={member} onOpen={onOpenWhatsApp} /><button className="btn btn-ghost" onClick={() => setEditing(!editing)}><Settings2 size={14} /> {editing ? "Cancel edit" : "Edit"}</button><button className="btn btn-ghost text-[#b03842] hover:bg-[#fbe9ea]" onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> Delete member</button></div>{Number(member.pending_amount) > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase font-bold text-[#b07818]">Outstanding Pending Balance</div><div className="text-xl font-display font-bold text-[#b07818] mt-0.5">{money(member.pending_amount)} remaining</div></div><button className="btn btn-primary !bg-[#b07818] hover:!bg-[#946210] !text-white text-xs flex items-center gap-1.5" onClick={() => onSettlePending(member)}><CircleDollarSign size={14} /> Collect & Settle</button></div>}{reason && <p className="text-[11px] text-muted-foreground mt-2">Current status is calculated automatically — {reason}</p>}{payingOpen && <RecordPaymentForm member={member} onDone={() => { setPayingOpen(false); detail.refetch(); onRefresh(); queryClient.invalidateQueries({ queryKey: ["membersWithStatus"] }); }} />}{editing ? <EditMemberForm member={member} onDone={() => { setEditing(false); detail.refetch(); onRefresh(); }} /> : <><div className="grid grid-cols-2 gap-3 mt-7"><DetailItem label="Package" value={member.package_name} /><DetailItem label="Package code" value={member.package_code} /><DetailItem label="Amount" value={money(member.amount)} /><DetailItem label="Renewal date" value={date(member.effective_renewal_date ?? member.renewal_date)} /><DetailItem label="Pending" value={money(member.pending_amount)} tone={Number(member.pending_amount) > 0 ? "amber" : "default"} /><DetailItem label="Personal training" value={member.personal_training || "—"} /></div><div className="mt-7"><h3 className="section-title">Personal information</h3><div className="mt-3 space-y-3 rounded-xl bg-[#f7faf8] p-4"><DetailLine label="Date of birth" value={date(member.date_of_birth)} /><DetailLine label="Date of joining" value={date(member.date_of_joining)} /><DetailLine label="Mobile" value={member.mobile_no || "—"} /><DetailLine label="Address" value={member.address || "—"} /></div></div><div className="mt-7"><div className="flex items-center justify-between"><div><h3 className="section-title">Payment history</h3><p className="text-xs text-muted-foreground mt-1">Every record is a separate billing history row.</p></div><span className="badge badge-slate">{detail.data?.payments?.length || 0} rows</span></div><div className="mt-3 space-y-2">{detail.isLoading ? <div className="text-xs text-muted-foreground">Loading payment history…</div> : detail.data?.payments?.length ? detail.data.payments.slice(0, 12).map((payment: AnyRow) => <div key={payment.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between"><div className="text-sm font-semibold">{date(payment.billing_month)}</div><Badge tone={Number(payment.pending_amount) > 0 ? "amber" : "green"}>{Number(payment.pending_amount) > 0 ? "Pending" : "Paid"}</Badge></div><div className="grid grid-cols-3 gap-2 text-xs mt-3"><div><div className="text-muted-foreground">Due</div><div className="font-semibold mt-1">{money(payment.amount_due)}</div></div><div><div className="text-muted-foreground">Paid</div><div className="font-semibold text-[#257651] mt-1">{money(payment.paid_amount)}</div></div><div><div className="text-muted-foreground">Pending</div><div className="font-semibold text-[#b07818] mt-1">{money(payment.pending_amount)}</div></div></div></div>) : <EmptyState icon={WalletCards} title="No payment history visible" copy="This may be an RLS access issue or a new member." />}</div></div></>}</aside>{deleteOpen && <DeleteMemberDialog member={member} paymentCount={detail.data?.payments?.length || 0} onClose={() => setDeleteOpen(false)} onDeleted={() => { setDeleteOpen(false); onClose(); onRefresh(); queryClient.invalidateQueries({ queryKey: ["membersWithStatus"] }); }} />}</div>;
}

/**
 * Confirms a permanent, irreversible delete of one member and all of their
 * payment history. The owner must re-enter their account password; the
 * delete RPC is only called after Supabase Auth accepts that password for
 * the currently signed-in account.
 */
function DeleteMemberDialog({
  member,
  paymentCount,
  onClose,
  onDeleted,
}: {
  member: AnyRow;
  paymentCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => deleteMember(Number(member.register_no)),
    onSuccess: () => { toast.success(`Member #${member.register_no} and all payment history deleted.`); onDeleted(); },
    onError: (error: any) => { setFormError(error.message); setVerifying(false); },
  });

  const confirmAndDelete = async () => {
    setFormError(null);
    if (!password) { setFormError("Enter your password to confirm."); return; }
    if (!user?.email) { setFormError("Could not determine the signed-in account. Please sign in again."); return; }
    setVerifying(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (authError) { setFormError("Incorrect password."); setVerifying(false); return; }
    mutation.mutate();
  };

  const busy = verifying || mutation.isPending;

  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="drawer max-w-md" role="alertdialog" aria-modal="true" aria-label="Confirm delete member"><div className="flex items-start justify-between"><div><div className="text-xs uppercase tracking-[.12em] text-[#b03842] font-bold">Permanent action</div><h2 className="font-display font-bold text-2xl mt-2">Delete this member?</h2></div><button className="h-9 w-9 flex items-center justify-center rounded-lg border border-border" onClick={onClose} disabled={busy} aria-label="Cancel delete"><X size={17} /></button></div>

    <div className="mt-4 rounded-xl bg-[#fbe9ea] border border-[#f0c6c9] p-4 text-sm">
      <p className="font-semibold text-[#b03842]">This cannot be undone.</p>
      <p className="text-[#8a3d41] mt-1">
        Deleting <span className="font-semibold">{member.name}</span> (Register #{member.register_no}) will permanently remove this member and all {paymentCount} associated payment history {paymentCount === 1 ? "row" : "rows"}. There is no recovery once this completes.
      </p>
    </div>

    <label className="block text-xs font-bold mt-5">Confirm your password
      <input
        className="input mt-1"
        type="password"
        autoFocus
        value={password}
        disabled={busy}
        onChange={e => { setPassword(e.target.value); setFormError(null); }}
        onKeyDown={e => { if (e.key === "Enter" && !busy) confirmAndDelete(); }}
        placeholder="Your account password"
      />
    </label>
    {formError && <div className="text-[11px] text-[#b03842] mt-1">{formError}</div>}

    <div className="flex gap-2 mt-5">
      <button className="btn btn-ghost flex-1" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn flex-1 bg-[#b03842] text-white hover:bg-[#8a2b33]" onClick={confirmAndDelete} disabled={busy || !password}>
        {busy ? "Deleting…" : "Permanently delete"}
      </button>
    </div>
  </div></div>;
}

function DetailItem({ label, value, tone = "default" }: { label: string; value: any; tone?: string }) { return <div className="rounded-xl border border-border p-3"><div className="text-[10px] uppercase tracking-[.08em] text-muted-foreground font-bold">{label}</div><div className={`text-sm font-semibold mt-1 ${tone === "amber" ? "text-[#b07818]" : ""}`}>{value || "—"}</div></div>; }

function RecordPaymentForm({ member, onDone }: { member: AnyRow; onDone: () => void }) {
  const [amount, setAmount] = useState(String(member.amount || member.pending_amount || ""));
  const [month, setMonth] = useState(currentMonthIso.slice(0, 7));
  const mutation = useMutation({
    mutationFn: () => recordPayment({ register_no: Number(member.register_no), billing_month: `${month}-01`, paid_amount: Number(amount) }),
    onSuccess: () => { toast.success("Payment recorded. Current status will recalculate automatically."); onDone(); },
    onError: (error: any) => toast.error(error.message),
  });
  return <div className="mt-4 rounded-xl bg-[#f7faf8] p-4"><div className="text-sm font-bold mb-1">Record a payment</div><p className="text-[11px] text-muted-foreground mb-3">This confirms a payment for the selected month. Historical paid records are never changed, and the current status recalculates on its own.</p><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">Billing month<input className="input mt-1" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label><label className="block text-xs font-bold">Paid amount (₹)<input className="input mt-1" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></label></div><button className="btn btn-primary w-full mt-4" disabled={mutation.isPending || !Number(amount)} onClick={() => mutation.mutate()}>{mutation.isPending ? "Recording…" : "Confirm payment"}</button></div>;
}

function DetailLine({ label, value }: { label: string; value: any }) { return <div className="flex gap-4 text-sm"><div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div><div className="font-medium break-words">{value}</div></div>; }

function EditMemberForm({ member, onDone }: { member: AnyRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateMember>[1]) => updateMember(Number(member.register_no), patch),
    onSuccess: () => {
      toast.success("Member profile updated.");
      queryClient.invalidateQueries({ queryKey: ["member", Number(member.register_no)] });
      queryClient.invalidateQueries({ queryKey: ["membersWithStatus"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["balanceSheet"] });
      onDone();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const initialJoining = String(member.date_of_joining || "").slice(0, 10);
  const [name, setName] = useState(member.name || "");
  const [mobile, setMobile] = useState(member.mobile_no || "");
  const [dob, setDob] = useState(String(member.date_of_birth || "").slice(0, 10));
  const [joining, setJoining] = useState(initialJoining);
  const [address, setAddress] = useState(member.address || "");
  const [renewal, setRenewal] = useState(String(member.renewal_date || "").slice(0, 10));
  const [showCautionModal, setShowCautionModal] = useState(false);

  const isJoiningChanged = Boolean(joining && initialJoining && joining !== initialJoining);

  const performSave = () => {
    mutation.mutate({
      name: name.trim(),
      mobile_no: mobile.trim(),
      date_of_birth: dob || null,
      date_of_joining: joining,
      address: address.trim(),
      renewal_date: renewal,
    });
  };

  const handleSaveClick = () => {
    if (!name.trim()) {
      toast.error("Member name is required.");
      return;
    }
    if (!joining) {
      toast.error("Joining date cannot be empty.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joining)) {
      toast.error("Please enter a valid joining date.");
      return;
    }

    // Only prompt with caution if the joining date is being updated
    if (isJoiningChanged) {
      setShowCautionModal(true);
      return;
    }

    performSave();
  };

  return (
    <>
      <div className="mt-6 rounded-xl bg-[#f7faf8] p-4">
        <div className="text-sm font-bold mb-4">Edit current member information</div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">
            Name
            <input className="input mt-1" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="block text-xs font-bold">
            Mobile
            <input className="input mt-1" value={mobile} onChange={e => setMobile(e.target.value)} />
          </label>
          <label className="block text-xs font-bold">
            Date of birth
            <input className="input mt-1" type="date" value={dob} onChange={e => setDob(e.target.value)} />
          </label>

          {/* Joining date with special caution styling & notice */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center justify-between">
              <label htmlFor="edit-joining-date" className="block text-xs font-bold text-amber-950">
                Date of joining
              </label>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                <AlertTriangle size={11} className="text-amber-600" /> Caution
              </span>
            </div>
            <input
              id="edit-joining-date"
              className="input mt-1.5 bg-white border-amber-300 focus:border-amber-500 focus:ring-amber-500 text-foreground"
              type="date"
              value={joining}
              onChange={e => setJoining(e.target.value)}
            />
            <div className="mt-2 text-[11px] text-amber-800 flex items-start gap-1.5 leading-relaxed">
              <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              <span>
                <strong>Caution:</strong> Modifying the joining date alters the member's registration record, tenure, and monthly joiner metrics. Change only if correcting an enrollment mistake.
              </span>
            </div>
            {isJoiningChanged && (
              <div className="mt-2 text-[11px] font-medium text-amber-950 bg-amber-100/90 border border-amber-300 rounded-lg p-2 flex items-center justify-between">
                <span>
                  Original: <strong>{date(initialJoining)}</strong> → New: <strong>{date(joining)}</strong>
                </span>
                <button
                  type="button"
                  className="text-[10px] uppercase font-bold text-amber-800 hover:text-amber-950 underline ml-2"
                  onClick={() => setJoining(initialJoining)}
                >
                  Revert
                </button>
              </div>
            )}
          </div>

          <label className="block text-xs font-bold">
            Renewal date
            <input className="input mt-1" type="date" value={renewal} onChange={e => setRenewal(e.target.value)} />
          </label>
          <label className="block text-xs font-bold">
            Address
            <textarea className="input mt-1 py-2 min-h-20" value={address} onChange={e => setAddress(e.target.value)} />
          </label>
          <button className="btn btn-primary w-full" disabled={mutation.isPending} onClick={handleSaveClick}>
            {mutation.isPending ? "Saving…" : "Save current profile"}
          </button>
        </div>
      </div>

      {/* Caution Dialog: Displays ONLY for Joining Date Updates */}
      {showCautionModal && (
        <div
          className="drawer-backdrop !z-[60] !justify-center !items-center p-4"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !mutation.isPending) {
              setShowCautionModal(false);
            }
          }}
        >
          <div
            className="card !max-w-md w-full !h-auto max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 border border-amber-300 bg-white"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="caution-dialog-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-[.1em] text-amber-700">Caution Required</div>
                  <h3 id="caution-dialog-title" className="font-display font-bold text-lg text-foreground">
                    Confirm Joining Date Change
                  </h3>
                </div>
              </div>
              <button
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                onClick={() => setShowCautionModal(false)}
                disabled={mutation.isPending}
                aria-label="Cancel"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 space-y-2.5">
              <p className="font-semibold text-amber-950">
                You are updating the official registration / joining date for {member.name} (Register #{member.register_no}).
              </p>
              <div className="grid grid-cols-2 gap-2 bg-white/90 p-2.5 rounded-lg border border-amber-200">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground font-bold">Current Joining Date</div>
                  <div className="font-semibold text-foreground text-sm mt-0.5">{date(initialJoining)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-amber-700 font-bold">New Joining Date</div>
                  <div className="font-bold text-amber-900 text-sm mt-0.5">{date(joining)}</div>
                </div>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-800 pt-1 leading-relaxed">
                <li>This alters the member's permanent registration record.</li>
                <li>Historical monthly joiner metrics, rosters, and cohorts will recalculate using the new date.</li>
                <li>Proceed only if you are correcting an inaccurate joining date.</li>
              </ul>
            </div>

            <div className="flex gap-2.5 mt-5">
              <button
                className="btn btn-ghost flex-1"
                onClick={() => setShowCautionModal(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button
                className="btn flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md shadow-amber-600/20"
                onClick={() => {
                  setShowCautionModal(false);
                  performSave();
                }}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Saving…" : "Confirm & Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const DURATION_LABEL: Record<number, string> = { 1: "1 Month", 3: "3 Months", 6: "6 Months", 12: "12 Months" };

function AddMemberModal({ onClose, onDone, plans }: { onClose: () => void; onDone: () => void; plans?: AnyRow[] }) {
  const planOptions = useMemo(() => toPlanOptions(plans), [plans]);
  const packageNames = useMemo(() => planNames(planOptions), [planOptions]);

  const [autoAllocate, setAutoAllocate] = useState(true);
  const [registerNo, setRegisterNo] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [dob, setDob] = useState("");
  const [packageName, setPackageName] = useState("");
  const [duration, setDuration] = useState<number | "">("");
  const [joining, setJoining] = useState(todayIso);
  const [address, setAddress] = useState("");
  const [touched, setTouched] = useState(false);

  const nextNo = useQuery({ queryKey: ["nextRegisterNumber"], queryFn: getNextRegisterNumber, enabled: autoAllocate });
  useEffect(() => {
    if (autoAllocate && nextNo.data != null) setRegisterNo(String(nextNo.data));
  }, [autoAllocate, nextNo.data]);

  const durations = useMemo(() => (packageName ? durationsForPlan(planOptions, packageName) : []), [planOptions, packageName]);
  const selectedPlan = useMemo(
    () => (packageName && duration ? findPlan(planOptions, packageName, Number(duration)) : undefined),
    [planOptions, packageName, duration]
  );

  const [hasPartialPayment, setHasPartialPayment] = useState(false);
  const [paidInput, setPaidInput] = useState("");
  const [pendingInput, setPendingInput] = useState("");

  const planAmount = selectedPlan?.price ?? 0;
  const registrationFee = selectedPlan?.registration_fee ?? 0;
  const firstPayment = planAmount + registrationFee;
  const renewalDate = duration ? addMonthsSafe(joining, Number(duration)) : "";

  const handlePaidChange = (val: string) => {
    const clean = val.replace(/[^\d]/g, "");
    setPaidInput(clean);
    if (clean === "") {
      setPendingInput("");
    } else {
      const num = Number(clean);
      const pend = Math.max(0, firstPayment - num);
      setPendingInput(String(pend));
    }
  };

  const handlePendingChange = (val: string) => {
    const clean = val.replace(/[^\d]/g, "");
    setPendingInput(clean);
    if (clean === "") {
      setPaidInput("");
    } else {
      const num = Number(clean);
      const pd = Math.max(0, firstPayment - num);
      setPaidInput(String(pd));
    }
  };

  const effectivePaid = useMemo(() => {
    if (!hasPartialPayment) return firstPayment;
    if (paidInput !== "") return Math.min(firstPayment, Number(paidInput) || 0);
    if (pendingInput !== "") return Math.max(0, firstPayment - (Number(pendingInput) || 0));
    return firstPayment;
  }, [hasPartialPayment, firstPayment, paidInput, pendingInput]);

  const effectivePending = useMemo(() => {
    if (!hasPartialPayment) return 0;
    if (pendingInput !== "") return Math.min(firstPayment, Number(pendingInput) || 0);
    if (paidInput !== "") return Math.max(0, firstPayment - (Number(paidInput) || 0));
    return 0;
  }, [hasPartialPayment, firstPayment, pendingInput, paidInput]);

  const regValid = /^[0-9]+$/.test(registerNo) && Number(registerNo) > 0;
  const nameValid = name.trim().length > 0 && !/^\d+$/.test(name.trim());
  const mobileValid = /^[6-9]\d{9}$/.test(mobile);
  const addressValid = address.trim().length > 0;
  const durationValid = duration !== "" && !!selectedPlan;
  const packageValid = !!packageName;
  const joiningValid = /^\d{4}-\d{2}-\d{2}$/.test(joining);
  const formValid = regValid && nameValid && mobileValid && addressValid && durationValid && packageValid && joiningValid;

  const err = (show: boolean, msg: string) => (touched && show ? <div className="text-[11px] text-[#b03842] mt-1">{msg}</div> : null);

  const mutation = useMutation({
    mutationFn: () => createMemberWithInitialPayment({
      register_no: Number(registerNo),
      name: name.trim(),
      mobile_no: mobile.trim(),
      address: address.trim(),
      date_of_birth: dob || null,
      date_of_joining: joining,
      renewal_date: renewalDate,
      package_code: selectedPlan!.plan_code,
      package_name: selectedPlan!.plan_name,
      plan_amount: planAmount,
      billing_month: `${joining.slice(0, 7)}-01`,
      amount_due: firstPayment,
      paid_amount: effectivePaid,
      pending_amount: effectivePending,
      payment_status: effectivePending > 0 ? "due_or_unpaid" : "paid",
      personal_training: packageName === "Personal Training" ? "Y" : null,
    }),
    onSuccess: (createdNo) => { toast.success(`Member #${createdNo} created with initial payment.`); onDone(); },
    onError: (error: any) => toast.error(error.message),
  });

  const submit = () => {
    setTouched(true);
    if (!formValid) { toast.error("Please fix the highlighted fields."); return; }
    if (mutation.isPending) return;
    mutation.mutate();
  };

  const ro = "input mt-1 bg-[#f2f6f4] text-muted-foreground cursor-not-allowed";

  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="drawer" role="dialog" aria-modal="true"><div className="flex items-start justify-between"><div><div className="text-xs uppercase tracking-[.12em] text-[#13795b] font-bold">Permanent member record</div><h2 className="font-display font-bold text-2xl mt-2">Add new member</h2><p className="text-xs text-muted-foreground mt-2">Register numbers are never recycled or reassigned.</p></div><button className="h-9 w-9 flex items-center justify-center rounded-lg border border-border" onClick={onClose} aria-label="Close add member"><X size={17} /></button></div>

    <label className="flex items-center gap-2 mt-6 text-xs font-bold cursor-pointer"><input type="checkbox" checked={autoAllocate} onChange={e => { setAutoAllocate(e.target.checked); if (!e.target.checked) setRegisterNo(""); }} /> Auto allocate register number</label>

    <div className="grid grid-cols-2 gap-3 mt-4">
      <label className="block text-xs font-bold">Register no *<input className={autoAllocate ? ro : "input mt-1"} data-testid="register-no" type="text" inputMode="numeric" readOnly={autoAllocate} value={registerNo} onChange={e => update(e.target.value)} placeholder="e.g. 502" />{err(!regValid, "Register number must be a positive whole number.")}</label>
      <label className="block text-xs font-bold">Full name *<input className="input mt-1" data-testid="name" value={name} onChange={e => setName(e.target.value)} />{err(!nameValid, "Full name is required.")}</label>
      <label className="block text-xs font-bold">Mobile no *<input className="input mt-1" data-testid="mobile" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="10-digit number" />{err(!mobileValid, "Enter a valid 10-digit Indian mobile number.")}</label>
      <label className="block text-xs font-bold">Date of birth<input className="input mt-1" data-testid="dob" type="date" value={dob} onChange={e => setDob(e.target.value)} /></label>
      <label className="block text-xs font-bold">Package *<select className="select mt-1" data-testid="package" value={packageName} onChange={e => { setPackageName(e.target.value); setDuration(""); }}><option value="">Select package</option>{packageNames.map(p => <option key={p}>{p}</option>)}</select>{err(!packageValid, "Please select a package.")}</label>
      <label className="block text-xs font-bold">Membership duration *<select className="select mt-1" data-testid="duration" value={duration} onChange={e => setDuration(e.target.value ? Number(e.target.value) : "")} disabled={!packageName}><option value="">Select duration</option>{durations.map(d => <option key={d} value={d}>{DURATION_LABEL[d] || `${d} Months`}</option>)}</select>{err(!durationValid, "Please select membership duration.")}</label>
      <label className="block text-xs font-bold">Plan amount<input className={ro} data-testid="plan-amount" readOnly value={selectedPlan ? money(planAmount) : "—"} /></label>
      <label className="block text-xs font-bold">Registration fee<input className={ro} data-testid="registration-fee" readOnly value={selectedPlan ? money(registrationFee) : "—"} /></label>
      <label className="block text-xs font-bold col-span-2">First payment total<input className={ro} data-testid="first-payment" readOnly value={selectedPlan ? money(firstPayment) : "—"} /></label>

      <div className="col-span-2 rounded-xl border border-border bg-[#f7faf8] p-3 my-1">
        <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
          <input
            type="checkbox"
            checked={hasPartialPayment}
            onChange={e => {
              const checked = e.target.checked;
              setHasPartialPayment(checked);
              if (!checked) {
                setPaidInput("");
                setPendingInput("");
              }
            }}
          />
          <span>Allow partial payment (unlock pending balance)</span>
        </label>
        {hasPartialPayment && (
          <p className="text-[11px] text-muted-foreground mt-1 ml-5">
            Member is paying partially now. Enter either the amount paid now or the pending balance.
          </p>
        )}
      </div>

      <label className="block text-xs font-bold">
        Amount paid now (₹)
        {hasPartialPayment ? (
          <input
            className="input mt-1 bg-white font-semibold"
            data-testid="paid-amount"
            type="text"
            inputMode="numeric"
            placeholder={String(firstPayment)}
            value={paidInput}
            onChange={e => handlePaidChange(e.target.value)}
          />
        ) : (
          <input className={ro} readOnly value={selectedPlan ? money(firstPayment) : "—"} />
        )}
      </label>

      <label className="block text-xs font-bold">
        Pending amount (₹)
        {hasPartialPayment ? (
          <input
            className="input mt-1 bg-white font-semibold text-[#b07818]"
            data-testid="pending-amount"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={pendingInput}
            onChange={e => handlePendingChange(e.target.value)}
          />
        ) : (
          <input className={ro} data-testid="pending" readOnly value={money(0)} />
        )}
      </label>

      <label className="block text-xs font-bold">Joining date *<input className="input mt-1" data-testid="joining" type="date" value={joining} onChange={e => setJoining(e.target.value)} />{err(!joiningValid, "Joining date is required.")}</label>
      <label className="block text-xs font-bold">Renewal date<input className={ro} data-testid="renewal" readOnly value={renewalDate ? date(renewalDate) : "—"} /></label>
      <label className="block text-xs font-bold col-span-2">Address *<textarea className="input mt-1 py-2 min-h-20" data-testid="address" value={address} onChange={e => setAddress(e.target.value)} />{err(!addressValid, "Address is required.")}</label>
    </div>

    <button className="btn btn-primary w-full mt-6" data-testid="submit" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? "Creating…" : "Create permanent member record"}</button>
  </div></div>;

  function update(value: string) { if (!autoAllocate) setRegisterNo(value.replace(/[^\d]/g, "")); }
}

function LoginScreen({ authError }: { authError?: any }) {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password) { setFormError("Enter your owner email and password."); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
    } catch (err: any) {
      setFormError(err?.message || "Sign in failed. Check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="min-h-screen flex items-center justify-center p-6 bg-[#10251f]"><div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"><div className="h-12 w-12 rounded-xl bg-[#e6f5ed] text-[#13795b] flex items-center justify-center"><Dumbbell size={24} /></div><h1 className="font-display font-bold text-2xl mt-6">Dream Big Fitness Studio</h1><p className="text-sm text-muted-foreground mt-2 leading-relaxed">Sign in to access the owner-only dashboard for your Chennai studio.</p><div className="mt-6 space-y-3"><label className="block text-xs font-bold">Email<input className="input mt-1" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@dreambig.fit" onKeyDown={e => { if (e.key === "Enter") submit(); }} /></label><label className="block text-xs font-bold">Password<input className="input mt-1" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} /></label></div>{(formError || authError) && <div className="data-alert mt-4">{formError || "Authentication could not be confirmed. Please try again."}</div>}<button className="btn btn-primary w-full mt-6" disabled={submitting} onClick={submit}>{submitting ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <>Continue to owner dashboard <ArrowUpRight size={16} /></>}</button></div></div>;
}

export default function Home() {
  const { user, loading: authLoading, isAuthenticated, logout, error: authError } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState<PageKey>("dashboard");
  const [membersFilterStatus, setMembersFilterStatus] = useState<string>("all");
  const [selectedMember, setSelectedMember] = useState<AnyRow | null>(null);
  const [renewingMember, setRenewingMember] = useState<AnyRow | null>(null);
  const [whatsAppMember, setWhatsAppMember] = useState<AnyRow | null>(null);
  const [historyMember, setHistoryMember] = useState<AnyRow | null>(null);
  const [settlingMember, setSettlingMember] = useState<AnyRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paymentsMonth, setPaymentsMonth] = useState(currentMonthIso);
  const [rosterMonth, setRosterMonth] = useState<string | null>(null);
  const [expenseMonth, setExpenseMonth] = useState<string | null>(null);

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: getDashboardSnapshot, enabled: isAuthenticated });
  const members = useQuery({ queryKey: ["members"], queryFn: getMembers, enabled: isAuthenticated });
  const payments = useQuery({ queryKey: ["payments", paymentsMonth], queryFn: () => getPayments(paymentsMonth), enabled: isAuthenticated });
  const plans = useQuery({ queryKey: ["plans"], queryFn: getPlans, enabled: isAuthenticated });
  const balance = useQuery({ queryKey: ["balance"], queryFn: getLiveBalanceSheet, enabled: isAuthenticated });
  const membersWithStatus = useQuery({ queryKey: ["membersWithStatus"], queryFn: () => getMembersWithStatus(), enabled: isAuthenticated });

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="h-10 w-10 rounded-xl bg-[#10251f] text-[#c9f0dc] flex items-center justify-center mx-auto animate-pulse"><Dumbbell size={20} /></div><p className="text-sm text-muted-foreground mt-4">Preparing owner workspace…</p></div></div>;
  if (!isAuthenticated) return <LoginScreen authError={authError} />;

  const commonRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["membersWithStatus"] });
    queryClient.invalidateQueries({ queryKey: ["member"] });
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: ["balance"] });
    queryClient.invalidateQueries({ queryKey: ["monthlyRoster"] });
    queryClient.invalidateQueries({ queryKey: ["memberPayments"] });
  };

  const memberRows = (membersWithStatus.data ?? members.data) as AnyRow[] | undefined;
  const membersLoading = membersWithStatus.isLoading || members.isLoading;

  const handleViewAllStatus = (statusKey: string) => {
    setMembersFilterStatus(statusKey);
    setPage("members");
  };

  return (
    <div className="app-shell">
      <AppSidebar page={page} setPage={setPage} user={user} logout={logout} />
      <main className="main-content">
        <Header page={page} setPage={setPage} onAdd={() => setAddOpen(true)} />

        {page === "dashboard" && (
          <DashboardPage
            data={dashboard.data}
            error={dashboard.error}
            onOpenMember={setSelectedMember}
            onRenewMember={setRenewingMember}
            onOpenWhatsApp={setWhatsAppMember}
            onViewAllStatus={handleViewAllStatus}
          />
        )}

        {page === "members" && (
          <MembersPage
            members={membersWithStatus.data as MemberWithStatus[] | undefined}
            loading={membersLoading}
            error={membersWithStatus.error || members.error}
            initialStatusFilter={membersFilterStatus}
            onOpenMember={setSelectedMember}
            onOpenPaymentHistory={setHistoryMember}
            onSettlePending={setSettlingMember}
            onRenewMember={setRenewingMember}
            onOpenWhatsApp={setWhatsAppMember}
            onAdd={() => setAddOpen(true)}
          />
        )}

        {page === "payments" && (
          <PaymentsPage
            payments={payments.data as AnyRow[] | undefined}
            members={memberRows}
            loading={payments.isLoading}
            error={payments.error}
            onOpenMember={setSelectedMember}
            onOpenWhatsApp={setWhatsAppMember}
            monthValue={paymentsMonth}
            onMonthChange={setPaymentsMonth}
          />
        )}

        {page === "renewals" && (
          <RenewalsPage
            members={memberRows}
            loading={membersLoading}
            error={members.error}
            onOpenMember={setSelectedMember}
            onOpenPaymentHistory={setHistoryMember}
            onRenewMember={setRenewingMember}
            onOpenWhatsApp={setWhatsAppMember}
          />
        )}

        {page === "plans" && <PlansPage plans={plans.data as AnyRow[] | undefined} loading={plans.isLoading} error={plans.error} />}

        {page === "balance" && (
          <BalancePage
            rows={balance.data}
            loading={balance.isLoading}
            error={balance.error}
            onManageRoster={setRosterMonth}
            onRecordExpenses={m => setExpenseMonth(m || currentMonthIso)}
          />
        )}
      </main>

      {selectedMember && (
        <MemberDrawer
          member={memberRows?.find(m => Number(m.register_no) === Number(selectedMember.register_no)) ?? selectedMember}
          onClose={() => setSelectedMember(null)}
          onRefresh={commonRefresh}
          onRenewMember={m => { setSelectedMember(null); setRenewingMember(m); }}
          onSettlePending={m => setSettlingMember(m)}
          onOpenWhatsApp={setWhatsAppMember}
        />
      )}

      {renewingMember && (
        <RenewMemberModal
          member={renewingMember}
          plans={plans.data as AnyRow[] | undefined}
          onClose={() => setRenewingMember(null)}
          onDone={() => {
            setRenewingMember(null);
            commonRefresh();
          }}
        />
      )}

      {whatsAppMember && (
        <WhatsAppModal
          member={whatsAppMember}
          onClose={() => setWhatsAppMember(null)}
        />
      )}

      {addOpen && (
        <AddMemberModal
          plans={plans.data as AnyRow[] | undefined}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            commonRefresh();
          }}
        />
      )}

      {rosterMonth && (
        <MonthlyRosterModal
          monthIso={rosterMonth}
          onClose={() => setRosterMonth(null)}
          onOpenMember={m => {
            const fullMember = memberRows?.find(
              existing => Number(existing.register_no) === Number(m.register_no)
            ) ?? m;
            setRosterMonth(null);
            setSelectedMember(fullMember);
          }}
          onRecordExpenses={m => {
            setExpenseMonth(m);
          }}
        />
      )}

      {expenseMonth && (
        <RecordExpensesModal
          initialMonth={expenseMonth}
          balanceRows={balance.data}
          onClose={() => setExpenseMonth(null)}
          onDone={() => {
            setExpenseMonth(null);
            commonRefresh();
          }}
        />
      )}

      {historyMember && (
        <MemberPaymentHistoryModal
          member={historyMember}
          onClose={() => setHistoryMember(null)}
          onRenewMember={m => {
            setHistoryMember(null);
            setRenewingMember(m);
          }}
          onSettlePending={m => {
            setHistoryMember(null);
            setSettlingMember(m);
          }}
          onOpenWhatsApp={setWhatsAppMember}
          onManageMember={m => {
            const fullMember = memberRows?.find(
              existing => Number(existing.register_no) === Number(m.register_no)
            ) ?? m;
            setHistoryMember(null);
            setSelectedMember(fullMember);
          }}
        />
      )}

      {settlingMember && (
        <SettlePendingModal
          member={settlingMember}
          onClose={() => setSettlingMember(null)}
          onDone={() => {
            setSettlingMember(null);
            commonRefresh();
          }}
        />
      )}
    </div>
  );
}
