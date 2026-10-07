import { supabase } from "./supabase";

// =============================================================================
// Data access layer for Dream Big Fitness Studio
//
// This module talks directly to the existing Supabase project via the Supabase
// JS client (PostgREST + Auth). It replaces the old Manus/Express/tRPC server
// layer. All reads/writes run as the authenticated owner, so Supabase RLS
// policies remain the single source of access control.
//
// Existing tables (never modified structurally here):
//   - members          (register_no is the permanent identifier — never recycled)
//   - payments         (historical billing rows, kept separate from members)
//   - membership_plans (official pricing)
//   - balance_sheet    (monthly financial summaries)
// =============================================================================

export type AnyRow = Record<string, any>;

const MEMBER_LIMIT = 1000;

function dateOnly(value: unknown) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export function startOfMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function throwIf(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

// -- Reads ---------------------------------------------------------------------

export async function getMembers(): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("register_no", { ascending: false })
    .limit(MEMBER_LIMIT);
  throwIf(error, "Failed to load members");
  return data ?? [];
}

export async function getPayments(month = startOfMonth()): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("billing_month", month)
    .order("id", { ascending: false })
    .limit(MEMBER_LIMIT);
  throwIf(error, "Failed to load payments");
  return data ?? [];
}

export async function getMemberDetail(registerNo: number): Promise<{ member: AnyRow | null; payments: AnyRow[] }> {
  const [memberRes, paymentsRes] = await Promise.all([
    supabase.from("members").select("*").eq("register_no", registerNo).limit(1),
    supabase
      .from("payments")
      .select("*")
      .eq("register_no", registerNo)
      .order("billing_month", { ascending: false })
      .order("id", { ascending: false })
      .limit(120),
  ]);
  throwIf(memberRes.error, "Failed to load member");
  throwIf(paymentsRes.error, "Failed to load payment history");
  return { member: memberRes.data?.[0] ?? null, payments: paymentsRes.data ?? [] };
}

export async function getPaymentHistory(registerNo: number): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("register_no", registerNo)
    .order("billing_month", { ascending: false })
    .order("id", { ascending: false })
    .limit(120);
  throwIf(error, "Failed to load payment history");
  return data ?? [];
}

export async function getPlans(): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("membership_plans")
    .select("*")
    .order("plan_name", { ascending: true })
    .order("duration_months", { ascending: true })
    .limit(100);
  throwIf(error, "Failed to load membership plans");
  return (data ?? []).map(p => ({
    ...p,
    registration_fee: Number(p.registration_fee) > 0 ? Number(p.registration_fee) : 200,
  }));
}

export async function getBalanceSheet(limit = 100): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("balance_sheet")
    .select("*")
    .order("month", { ascending: false })
    .limit(limit);
  throwIf(error, "Failed to load balance sheet");
  return data ?? [];
}

export async function getRenewals(): Promise<AnyRow[]> {
  const rows = await getMembers();
  return rows
    .filter(row => row.renewal_date)
    .sort((a, b) => dateOnly(a.renewal_date).localeCompare(dateOnly(b.renewal_date)))
    .slice(0, MEMBER_LIMIT);
}

// -- Dashboard aggregation -----------------------------------------------------
// Mirrors the previous server-side dashboard.snapshot computation.

// -- Formatting Helpers --------------------------------------------------------
export function formatDate(value: unknown): string {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// -- WhatsApp Message Builder --------------------------------------------------
export function buildWhatsAppMessage(
  member: AnyRow,
  kind: "Paid" | "Due_or_Unpaid" | "Deactive" | "general" = "general"
): string {
  const name = member.name || "Member";
  const renewalDateStr = dateOnly(member.effective_renewal_date ?? member.renewal_date);
  const formattedDate = formatDate(renewalDateStr);

  const todayMs = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const renewalMs = renewalDateStr ? new Date(`${renewalDateStr}T00:00:00Z`).getTime() : 0;
  const daysDiff = Math.ceil((renewalMs - todayMs) / 86400000);

  if (kind === "Paid") {
    const daysRemainingText = daysDiff > 0 ? `, with ${daysDiff} days remaining` : "";
    return `Hi ${name}, your Dream Big Fitness membership is active. Your membership is valid until ${formattedDate}${daysRemainingText}. Keep training consistently! 💪`;
  }

  if (kind === "Due_or_Unpaid") {
    return `Hi ${name}, your Dream Big Fitness membership renewal is due. Your current renewal date is ${formattedDate}. Please renew your membership to continue your training without interruption.`;
  }

  if (kind === "Deactive") {
    return `Hi ${name}, we noticed that your Dream Big Fitness membership has expired. If you would like to continue your fitness journey, please contact us to reactivate your membership.`;
  }

  return `Hi ${name}, this is Dream Big Fitness Studio. How can we help you today?`;
}

// -- Dashboard aggregation -----------------------------------------------------

export async function getDashboardSnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const month = startOfMonth();

  const [membersWithStatus, allPayments, balance] = await Promise.all([
    getMembersWithStatus(),
    getAllPayments(),
    getBalanceSheet(12),
  ]);

  const totalMembers = membersWithStatus.length;
  const summary = summarizeStatuses(membersWithStatus);
  const totalPendingAmount = membersWithStatus.reduce(
    (sum, m) => sum + Number(m.pending_amount ?? 0),
    0
  );

  // Package Distribution
  const packageCounts: Record<string, number> = {};
  for (const m of membersWithStatus) {
    const pkg = m.package_name || "Unassigned";
    packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
  }
  const packageDistribution = Object.entries(packageCounts).map(([name, count]) => ({
    name,
    count,
  }));

  // Status Distribution
  const statusDistribution = [
    { name: "Paid", count: summary.Paid },
    { name: "Due / Unpaid", count: summary.Due_or_Unpaid },
    { name: "Deactive", count: summary.Deactive },
    { name: "Needs review", count: summary.needs_review },
  ];

  // Renewal Timeline Breakdown
  let recentlyExpired = 0;
  let dueWithin7 = 0;
  let dueWithin30 = 0;
  let laterRenewals = 0;

  for (const m of membersWithStatus) {
    const renewStr = dateOnly(m.effective_renewal_date ?? m.renewal_date);
    if (!renewStr) continue;
    const renewMs = new Date(`${renewStr}T00:00:00Z`).getTime();
    const diffDays = Math.ceil((renewMs - todayMs) / 86400000);

    if (diffDays < 0) {
      if (m.current_status === "Due_or_Unpaid") recentlyExpired++;
    } else if (diffDays <= 7) {
      dueWithin7++;
    } else if (diffDays <= 30) {
      dueWithin30++;
    } else {
      laterRenewals++;
    }
  }

  const renewalTimeline = [
    { name: "Recently Expired", count: recentlyExpired },
    { name: "Due in 7 Days", count: dueWithin7 },
    { name: "Due in 30 Days", count: dueWithin30 },
    { name: "Later Renewals", count: laterRenewals },
  ];

  // Monthly Payment Trend from payments table
  const monthlyTrendMap: Record<string, { paid: number; due: number }> = {};
  for (const p of allPayments) {
    const mKey = dateOnly(p.billing_month).slice(0, 7);
    if (!mKey) continue;
    if (!monthlyTrendMap[mKey]) monthlyTrendMap[mKey] = { paid: 0, due: 0 };
    monthlyTrendMap[mKey].paid += Number(p.paid_amount ?? 0);
    monthlyTrendMap[mKey].due += Number(p.pending_amount ?? 0);
  }
  const sortedMonthKeys = Object.keys(monthlyTrendMap).sort().slice(-6);
  const monthlyPaymentTrend = sortedMonthKeys.map(k => ({
    month: k,
    paid: monthlyTrendMap[k].paid,
    due: monthlyTrendMap[k].due,
  }));

  // New Members Trend from members.date_of_joining
  const newMembersMap: Record<string, number> = {};
  for (const m of membersWithStatus) {
    const mKey = dateOnly(m.date_of_joining).slice(0, 7);
    if (!mKey) continue;
    newMembersMap[mKey] = (newMembersMap[mKey] || 0) + 1;
  }
  const sortedNewMemberKeys = Object.keys(newMembersMap).sort().slice(-6);
  const newMembersTrend = sortedNewMemberKeys.map(k => ({
    month: k,
    count: newMembersMap[k],
  }));

  // Actionable Lists
  const renewalsDueSoon = membersWithStatus
    .filter(m => {
      if (m.current_status === "Deactive" || m.current_status === "needs_review") return false;
      const renewStr = dateOnly(m.effective_renewal_date ?? m.renewal_date);
      if (!renewStr) return false;
      const renewMs = new Date(`${renewStr}T00:00:00Z`).getTime();
      const diffDays = Math.ceil((renewMs - todayMs) / 86400000);
      return diffDays >= 0 && diffDays <= 30;
    })
    .map(m => {
      const renewStr = dateOnly(m.effective_renewal_date ?? m.renewal_date);
      const renewMs = new Date(`${renewStr}T00:00:00Z`).getTime();
      const daysRemaining = Math.ceil((renewMs - todayMs) / 86400000);
      return { ...m, daysRemaining };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const recentlyExpiredList = membersWithStatus.filter(
    m => m.current_status === "Due_or_Unpaid"
  );
  const deactiveList = membersWithStatus.filter(m => m.current_status === "Deactive");
  const needsReviewList = membersWithStatus.filter(m => m.current_status === "needs_review");

  return {
    sourceStatus: membersWithStatus.length ? "connected" : "empty_or_blocked",
    generatedAt: new Date().toISOString(),
    month,
    totalMembers,
    paidCount: summary.Paid,
    dueUnpaidCount: summary.Due_or_Unpaid,
    deactiveCount: summary.Deactive,
    needsReviewCount: summary.needs_review,
    totalPendingAmount,
    statusDistribution,
    packageDistribution,
    renewalTimeline,
    monthlyPaymentTrend,
    newMembersTrend,
    renewalsDueSoon,
    recentlyExpiredList,
    deactiveList,
    needsReviewList,
    members: membersWithStatus,
  };
}

export type DashboardSnapshot = Awaited<ReturnType<typeof getDashboardSnapshot>>;

// -- Writes --------------------------------------------------------------------
// Register numbers are permanent. Creating a member is an INSERT with a caller-
// provided register_no; reactivating a returning member is an UPDATE of the
// existing row. Never delete or recycle historical member/payment records.

export type NewMemberInput = {
  register_no: number;
  name: string;
  mobile_no: string;
  date_of_joining: string;
  renewal_date: string;
  amount: number;
  pending_amount?: number;
  package_code?: string | null;
  package_name?: string | null;
  address?: string | null;
  date_of_birth?: string | null;
  personal_training?: string | null;
};

export async function createMember(input: NewMemberInput): Promise<AnyRow> {
  const { data, error } = await supabase
    .from("members")
    .insert({ pending_amount: 0, ...input })
    .select("*")
    .single();
  throwIf(error, "Failed to create member");
  return data as AnyRow;
}

export type MemberPatch = Partial<{
  name: string;
  date_of_birth: string | null;
  mobile_no: string;
  address: string | null;
  date_of_joining: string;
  renewal_date: string;
  package_code: string | null;
  package_name: string | null;
  amount: number;
  pending_amount: number;
  personal_training: string | null;
}>;

export async function updateMember(registerNo: number, patch: MemberPatch): Promise<AnyRow> {
  const { data, error } = await supabase
    .from("members")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("register_no", registerNo)
    .select("*")
    .single();
  throwIf(error, "Failed to update member");
  return data as AnyRow;
}

// =============================================================================
// CURRENT MEMBER STATUS — single source of truth
// =============================================================================
// Automatic, calculated current-member status. This is the ONE place the four
// statuses are computed. Every page (Dashboard, Members, Member detail,
// Payments, Renewals) must call these helpers rather than re-deriving status.
//
// Statuses (calculated, never stored on the member row):
//   - needs_review   : has an unresolved needs_review payment record
//   - Deactive       : coverage expired AND no successful payment in the two
//                       previous COMPLETED calendar months
//   - Due_or_Unpaid  : has a current due/unpaid condition, or recently expired
//                       but with recent successful payment activity
//   - Paid           : valid current coverage with no outstanding issue
//
// Priority (highest first): needs_review > Deactive > Due_or_Unpaid > Paid
//
// IMPORTANT: This calculation NEVER mutates payment rows. A member becoming
// "Deactive" does not change any historical payment_status; those remain as-is.
// Dates are always derived dynamically from the current date — nothing is
// hardcoded to a specific month or year.
// =============================================================================

export type MemberStatus = "Paid" | "Due_or_Unpaid" | "Deactive" | "needs_review";

export const MEMBER_STATUS_ORDER: MemberStatus[] = [
  "needs_review",
  "Deactive",
  "Due_or_Unpaid",
  "Paid",
];

/** First day (YYYY-MM-DD) of the month that is `monthsAgo` months before `from`. */
function firstOfMonthOffset(from: Date, monthsAgo: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - monthsAgo, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The two previous COMPLETED calendar months as YYYY-MM-01 strings.
 * The current (in-progress) month is intentionally excluded.
 * e.g. on 2026-09-10 => ["2026-08-01", "2026-07-01"].
 */
export function completedMonthsWindow(now = new Date()): { start: string; monthKeys: string[] } {
  const prev1 = firstOfMonthOffset(now, 1); // last completed month
  const prev2 = firstOfMonthOffset(now, 2); // month before that
  return { start: prev2, monthKeys: [prev2, prev1] };
}

function isPaidStatus(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "paid";
}

function isNeedsReviewStatus(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "needs_review";
}

export type StatusInputs = {
  member: AnyRow;
  payments: AnyRow[]; // ALL payment rows for this member
  now?: Date;
};

export type StatusResult = {
  status: MemberStatus;
  /** Reliable coverage end date (YYYY-MM-DD) derived from paid history, else member renewal. */
  coverageEnd: string;
  /**
   * Renewal date to DISPLAY. Now simply the member's own renewal_date, since
   * status is based on that field alone. Display-only — never written to the DB.
   */
  effectiveRenewalDate: string;
  lastPaidMonth: string | null;
  hasNeedsReview: boolean;
  paidInLastTwoCompletedMonths: boolean;
  paymentRows: number;
  reason: string;
};

/**
 * THE status calculation. Single source of truth.
 *
 * Status is based ENTIRELY on the member's own renewal_date. Payment history is
 * intentionally NOT used for the status decision, because the payments data is
 * inconsistent (e.g. rows marked `paid` with zero paid_amount, and stale/copied
 * renewal_date values). The ONLY thing we still read from payments is whether an
 * unresolved `needs_review` record exists, since that overrides everything.
 *
 * Rules (priority order):
 *   1. needs_review  — an unresolved needs_review payment record exists.
 *   2. Paid          — renewal_date is today or in the future (coverage valid).
 *   3. Due_or_Unpaid — renewal_date has passed but only recently: still within
 *                      the two previous completed calendar months (current month
 *                      excluded). Recently expired -> needs renewal, not dead.
 *   4. Deactive      — renewal_date expired before that window (long lapsed).
 *
 * A member with no renewal_date on record is treated as Due_or_Unpaid (needs a
 * renewal date recorded) rather than silently Deactive. Nothing here is written
 * back to the database.
 */
export function calculateMemberStatus({ member, payments, now = new Date() }: StatusInputs): StatusResult {
  const todayStr = now.toISOString().slice(0, 10);
  const { start: twoCompletedStart, monthKeys } = completedMonthsWindow(now);

  const hasNeedsReview = payments.some(p => isNeedsReviewStatus(p.payment_status));

  // The member's own renewal_date is the sole coverage signal. We display it
  // as-is (no derivation from payment rows).
  const memberRenewal = dateOnly(member.renewal_date);
  const coverageEnd = memberRenewal;
  const effectiveRenewalDate = memberRenewal;

  const paymentRows = payments.length;
  const coverageActive = Boolean(memberRenewal) && memberRenewal >= todayStr;

  // Priority 1: needs_review overrides everything.
  if (hasNeedsReview) {
    return build("needs_review", "Unresolved needs_review payment record on file.");
  }

  // No renewal date recorded: can't confirm coverage, so treat as needing a
  // renewal rather than automatically Deactive.
  if (!memberRenewal) {
    return build("Due_or_Unpaid", "No renewal date on record — needs a renewal.");
  }

  // Priority 2: Paid — renewal date is current or in the future.
  if (coverageActive) {
    return build("Paid", `Membership valid — renews on ${memberRenewal}.`);
  }

  // Priority 3: Due_or_Unpaid — expired, but only within the last two completed
  // calendar months (recently lapsed).
  if (memberRenewal >= twoCompletedStart) {
    return build("Due_or_Unpaid", `Renewal date (${memberRenewal}) recently passed — due for renewal.`);
  }

  // Priority 4: Deactive — renewal date expired before the two completed months.
  return build("Deactive", `Renewal date (${memberRenewal}) expired before ${monthKeys[0]} — long lapsed.`);

  function build(status: MemberStatus, reason: string): StatusResult {
    return {
      status,
      coverageEnd,
      effectiveRenewalDate,
      lastPaidMonth: null,
      hasNeedsReview,
      paidInLastTwoCompletedMonths: false,
      paymentRows,
      reason,
    };
  }
}

export type MemberWithStatus = AnyRow & {
  current_status: MemberStatus;
  status_detail: StatusResult;
};

/**
 * Fetch every member plus every payment row once, then annotate each member
 * with its calculated current status. This is the data source the Members page,
 * dashboard summary, and validation report all consume, guaranteeing one shared
 * result set.
 */
export async function getMembersWithStatus(now = new Date()): Promise<MemberWithStatus[]> {
  const [members, payments] = await Promise.all([getMembers(), getAllPayments()]);

  const byMember = new Map<number, AnyRow[]>();
  for (const p of payments) {
    const key = Number(p.register_no);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key)!.push(p);
  }

  return members.map(member => {
    const memberPayments = byMember.get(Number(member.register_no)) ?? [];
    const status_detail = calculateMemberStatus({ member, payments: memberPayments, now });
    return {
      ...member,
      current_status: status_detail.status,
      // Display-only calculated renewal date (never persisted to the DB).
      effective_renewal_date: status_detail.effectiveRenewalDate,
      status_detail,
    };
  });
}

/** All payment rows across all members (paged to stay within PostgREST limits). */
export async function getAllPayments(): Promise<AnyRow[]> {
  const pageSize = 1000;
  let from = 0;
  const all: AnyRow[] = [];
  // Loop until a short page is returned.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    throwIf(error, "Failed to load payments");
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export type StatusSummary = {
  totalMembers: number;
  Paid: number;
  Due_or_Unpaid: number;
  Deactive: number;
  needs_review: number;
  reconciles: boolean;
};

/** Live status counts computed from the annotated member set. Never hardcoded. */
export function summarizeStatuses(members: MemberWithStatus[]): StatusSummary {
  const summary: StatusSummary = {
    totalMembers: members.length,
    Paid: 0,
    Due_or_Unpaid: 0,
    Deactive: 0,
    needs_review: 0,
    reconciles: false,
  };
  for (const m of members) summary[m.current_status] += 1;
  summary.reconciles =
    summary.Paid + summary.Due_or_Unpaid + summary.Deactive + summary.needs_review ===
    summary.totalMembers;
  return summary;
}

// -- Payment recording ---------------------------------------------------------
// The admin's ONLY status-related action: record/confirm a payment. This flips a
// single month's payment row to `paid` (or inserts one for the current month if
// none exists). It NEVER edits historical paid rows and NEVER stores a status on
// the member. After the write, the caller re-runs getMembersWithStatus so the
// current status recalculates automatically.
export type RecordPaymentInput = {
  register_no: number;
  billing_month?: string; // YYYY-MM-01; defaults to current month
  paid_amount: number;
};

export async function recordPayment(input: RecordPaymentInput): Promise<AnyRow> {
  const billingMonth = input.billing_month ?? startOfMonth();

  // Find an existing payment row for this member + billing month.
  const existing = await supabase
    .from("payments")
    .select("*")
    .eq("register_no", input.register_no)
    .eq("billing_month", billingMonth)
    .limit(1);
  throwIf(existing.error, "Failed to look up payment record");
  const row = existing.data?.[0];

  if (row) {
    // Never overwrite an already-paid historical record.
    if (isPaidStatus(row.payment_status)) return row;
    const amountDue = Number(row.amount_due ?? input.paid_amount);
    const pending = Math.max(0, amountDue - Number(input.paid_amount));
    const { data, error } = await supabase
      .from("payments")
      .update({
        paid_amount: input.paid_amount,
        pending_amount: pending,
        payment_status: "paid",
      })
      .eq("id", row.id)
      .select("*")
      .single();
    throwIf(error, "Failed to record payment");
    return data as AnyRow;
  }

  // No row for this month yet — insert one as paid.
  const member = await supabase
    .from("members")
    .select("*")
    .eq("register_no", input.register_no)
    .limit(1);
  throwIf(member.error, "Failed to load member for payment");
  const m = member.data?.[0] ?? {};
  const { data, error } = await supabase
    .from("payments")
    .insert({
      register_no: input.register_no,
      name: m.name ?? null,
      billing_month: billingMonth,
      renewal_date: m.renewal_date ?? null,
      package_code: m.package_code ?? null,
      package_name: m.package_name ?? null,
      amount_due: input.paid_amount,
      paid_amount: input.paid_amount,
      pending_amount: 0,
      payment_status: "paid",
    })
    .select("*")
    .single();
  throwIf(error, "Failed to record payment");
  return data as AnyRow;
}

// =============================================================================
// MEMBER RENEWAL / UPDATE WORKFLOW
// =============================================================================
// Renews or updates a member's package, duration, amount, and renewal date.
// Updates members table with current state, and INSERTS a new payment row into
// payments table (never overwriting historical payment records).

export type RenewMemberInput = {
  register_no: number;
  package_code: string;
  package_name: string;
  duration_months: number;
  amount: number;
  renewal_date: string;
  billing_month?: string;
  payment_status: "paid" | "due_or_unpaid" | "needs_review";
  personal_training?: string | null;
};

export function calculateRenewalDate(
  currentRenewalDate: string | null | undefined,
  durationMonths: number,
  now = new Date()
): string {
  const todayStr = now.toISOString().slice(0, 10);
  const curStr = currentRenewalDate ? dateOnly(currentRenewalDate) : "";
  const baseDate = curStr && curStr >= todayStr ? curStr : todayStr;
  return addMonthsSafe(baseDate, durationMonths);
}

export async function renewMember(input: RenewMemberInput): Promise<AnyRow> {
  const billingMonth = input.billing_month ?? startOfMonth();
  const pendingAmount = input.payment_status === "paid" ? 0 : input.amount;
  const paidAmount = input.payment_status === "paid" ? input.amount : 0;

  // 1. Fetch current member details
  const memberRes = await supabase
    .from("members")
    .select("*")
    .eq("register_no", input.register_no)
    .single();
  throwIf(memberRes.error, "Failed to load member for renewal");
  const member = memberRes.data;

  // 2. Update member's current package and renewal state
  const updateRes = await supabase
    .from("members")
    .update({
      package_code: input.package_code,
      package_name: input.package_name,
      amount: input.amount,
      renewal_date: input.renewal_date,
      pending_amount: pendingAmount,
      personal_training: input.personal_training ?? member.personal_training ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("register_no", input.register_no)
    .select("*")
    .single();
  throwIf(updateRes.error, "Failed to update member renewal state");

  // 3. Create a NEW row in payments table (preserving historical payment records)
  const paymentRes = await supabase
    .from("payments")
    .insert({
      register_no: input.register_no,
      name: member.name,
      billing_month: billingMonth,
      renewal_date: input.renewal_date,
      package_code: input.package_code,
      package_name: input.package_name,
      amount_due: input.amount,
      paid_amount: paidAmount,
      pending_amount: pendingAmount,
      payment_status: input.payment_status,
      personal_training: input.personal_training ?? member.personal_training ?? null,
    })
    .select("*")
    .single();
  throwIf(paymentRes.error, "Failed to record renewal payment");

  return updateRes.data;
}

// =============================================================================
// ADD NEW MEMBER — pricing, register-number, renewal-date helpers + atomic create
// =============================================================================
// Single source of truth for the "Add New Member" workflow. Pricing and
// registration fees come from public.membership_plans (never hardcoded). Member
// + initial payment are created atomically via the create_member_with_payment
// SECURITY DEFINER RPC, so there are never orphan members and no service-role
// key is exposed in the browser.

export type PlanOption = {
  plan_code: string;
  plan_name: string;
  duration_months: number;
  price: number;
  registration_fee: number;
};

/**
 * Normalise membership_plans rows into typed plan options. The registration
 * fee is read as-is from the database (including a genuine ₹0 for plans like
 * Strength Zone) — a missing/non-numeric value falls back to 0, since "no fee
 * on record" should never silently become a charge.
 */
export function toPlanOptions(rows: AnyRow[] | undefined): PlanOption[] {
  return (rows ?? []).map(r => {
    const fee = Number(r.registration_fee);
    return {
      plan_code: String(r.plan_code ?? ""),
      plan_name: String(r.plan_name ?? ""),
      duration_months: Number(r.duration_months ?? 0),
      price: Number(r.price ?? 0),
      registration_fee: Number.isFinite(fee) && fee > 0 ? fee : 200,
    };
  });
}

/** Distinct package names, in a stable order. */
export function planNames(plans: PlanOption[]): string[] {
  return Array.from(new Set(plans.map(p => p.plan_name))).filter(Boolean);
}

/** Durations actually defined for a package (so PT only offers what exists). */
export function durationsForPlan(plans: PlanOption[], planName: string): number[] {
  return plans
    .filter(p => p.plan_name === planName)
    .map(p => p.duration_months)
    .sort((a, b) => a - b);
}

/** The exact plan row for a package + duration, or undefined if not defined. */
export function findPlan(plans: PlanOption[], planName: string, durationMonths: number): PlanOption | undefined {
  return plans.find(p => p.plan_name === planName && p.duration_months === durationMonths);
}

/**
 * Next permanent register number = current max + 1. Register numbers are never
 * recycled. The members primary key is the ultimate guard against duplicates
 * (and the RPC re-checks), so this is a display/prefill helper.
 */
export async function getNextRegisterNumber(): Promise<number> {
  const { data, error } = await supabase
    .from("members")
    .select("register_no")
    .order("register_no", { ascending: false })
    .limit(1);
  throwIf(error, "Failed to determine next register number");
  const max = data?.[0]?.register_no;
  return (Number.isFinite(Number(max)) ? Number(max) : 0) + 1;
}

/** True if a register number already exists in members. */
export async function registerNumberExists(registerNo: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("members")
    .select("register_no")
    .eq("register_no", registerNo)
    .limit(1);
  throwIf(error, "Failed to check register number");
  return Boolean(data && data.length);
}

/**
 * Add N months to a date, clamping to the last valid day of the target month so
 * we never produce an invalid calendar date (e.g. Jan 31 + 1mo -> Feb 28/29).
 * Returns YYYY-MM-DD.
 */
export function addMonthsSafe(isoDate: string, months: number): string {
  const base = isoDate.slice(0, 10);
  const [y, m, d] = base.split("-").map(Number);
  if (!y || !m || !d) return base;
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // 0-11
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

export type CreateMemberInput = {
  register_no: number;
  name: string;
  mobile_no: string;
  address: string;
  date_of_birth?: string | null;
  date_of_joining: string; // YYYY-MM-DD
  renewal_date: string;    // YYYY-MM-DD (calculated)
  package_code: string;
  package_name: string;
  plan_amount: number;     // recurring plan amount (no reg fee) -> members.amount
  billing_month: string;   // YYYY-MM-01 (first day of joining month)
  amount_due: number;      // first payment incl. registration fee
  paid_amount: number;
  pending_amount: number;
  payment_status: "paid" | "due_or_unpaid" | "needs_review";
  personal_training?: string | null;
};

/** Map RPC/Postgres errors to clean, user-facing messages. */
function mapCreateError(message: string): string {
  if (/DUPLICATE_REGISTER_NO/.test(message) || /duplicate key|already exists|members_pkey/i.test(message)) {
    return "Register number already exists.";
  }
  if (/INVALID_MOBILE/.test(message)) return "Enter a valid 10-digit Indian mobile number.";
  if (/INVALID_NAME/.test(message)) return "Full name is required.";
  if (/INVALID_ADDRESS/.test(message)) return "Address is required.";
  if (/INVALID_REGISTER_NO/.test(message)) return "Register number must be a positive whole number.";
  if (/INVALID_PENDING/.test(message)) return "Pending amount cannot be negative.";
  if (/INVALID_STATUS/.test(message)) return "Invalid payment status.";
  return message;
}

/**
 * Atomically create a member + their initial payment via the SECURITY DEFINER
 * RPC. One logical operation: if the payment insert fails, the member insert is
 * rolled back too. Returns the created register number.
 */
export async function createMemberWithInitialPayment(input: CreateMemberInput): Promise<number> {
  const { data, error } = await supabase.rpc("create_member_with_payment", {
    p_register_no: input.register_no,
    p_name: input.name,
    p_mobile_no: input.mobile_no,
    p_address: input.address,
    p_date_of_joining: input.date_of_joining,
    p_renewal_date: input.renewal_date,
    p_package_code: input.package_code,
    p_package_name: input.package_name,
    p_plan_amount: input.plan_amount,
    p_billing_month: input.billing_month,
    p_amount_due: input.amount_due,
    p_paid_amount: input.paid_amount,
    p_pending_amount: input.pending_amount,
    p_payment_status: input.payment_status,
    p_personal_training: input.personal_training ?? null,
  });
  if (error) throw new Error(mapCreateError(error.message));
  const createdNo = Number(data);
  if (input.date_of_birth) {
    await updateMember(createdNo, { date_of_birth: input.date_of_birth });
  }
  return createdNo;
}

/** Map delete-RPC errors to clean, user-facing messages. */
function mapDeleteError(message: string): string {
  if (/MEMBER_NOT_FOUND/.test(message)) return "This member no longer exists.";
  if (/INVALID_REGISTER_NO/.test(message)) return "Register number must be a positive whole number.";
  return message;
}

/**
 * Permanently deletes a member and every payment history row tied to their
 * register number, via the SECURITY DEFINER RPC (payments are removed first,
 * then the member row, inside one server-side transaction). This is
 * destructive and irreversible — callers must obtain explicit confirmation
 * (and re-verify the caller's password) before invoking this.
 */
export async function deleteMember(registerNo: number): Promise<number> {
  const { data, error } = await supabase.rpc("delete_member", { p_register_no: registerNo });
  if (error) throw new Error(mapDeleteError(error.message));
  return Number(data);
}
