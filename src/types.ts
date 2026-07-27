// ---------------------------------------------------------------------------
// Verizon account entity types
//
// These model the pieces of a Verizon Wireless account that the My Verizon
// website spreads across many different screens: your bill, your plan, each
// phone line, the device-payment agreements, and the SIMs/eSIMs.
//
// The whole point of this dashboard is to pull them back into one place.
// ---------------------------------------------------------------------------

/**
 * A device-payment agreement — the 24 or 36-month interest-free installment
 * plan Verizon puts your phone on when you don't pay for it up front.
 * This is the single most confusing line on most Verizon bills.
 */
export interface DevicePayment {
  agreementId: string;
  /** e.g. "iPhone 15 Pro 256GB" */
  device: string;
  /** What you pay toward the phone each month */
  monthlyAmount: number;
  /** How many of the term's months you've already paid */
  monthsPaid: number;
  /** Total length of the agreement, in months (usually 36) */
  termMonths: number;
  /** Full retail price of the device */
  originalPrice: number;
  /** How much you still owe on the phone */
  remainingBalance: number;
  /**
   * Monthly bill credit from a trade-in / promo. Verizon charges the full
   * device payment AND applies this credit separately — so the phone is only
   * "free" if you keep the line for the full term. Net cost = monthlyAmount - promoCredit.
   */
  promoCredit?: number;
}

/** A SIM or eSIM — the thing that actually connects a device to the network. */
export interface Sim {
  simId: string;
  type: 'eSIM' | 'physical';
  /** Last 4 digits of the ICCID (the SIM's serial number) */
  iccidLast4: string;
  status: 'active' | 'inactive' | 'suspended';
  /** The line (phone number) this SIM is assigned to */
  lineId: string;
}

/** One phone line on the account. */
export interface Line {
  lineId: string;
  /** Formatted phone number, e.g. "(415) 555-0142" */
  phoneNumber: string;
  /** A friendly label so you know whose line it is */
  nickname: string;
  /** The device currently on this line */
  device: string;
  /** The plan assigned to this specific line */
  planName: string;
  /**
   * "Line access charge" — the recurring monthly fee for keeping this line on
   * the plan. On a multi-line account each line has its own access charge and
   * they add up; this is separate from device payments.
   */
  monthlyLineAccess: number;
  /** Data used this cycle, in GB */
  dataUsedGb: number;
  /** Plan data allowance in GB, or 'unlimited' */
  dataAllowanceGb: number | 'unlimited';
  /** Links to a DevicePayment, if this line's phone is being paid off */
  devicePaymentId?: string;
  /** Links to the SIM assigned to this line */
  simId?: string;
}

/** One category of charges on the monthly bill. */
export interface ChargeCategory {
  key: 'plan' | 'devices' | 'surcharges' | 'taxes' | 'oneTime' | 'perks';
  label: string;
  amount: number;
  /** Plain-language explanation of what this bucket actually is */
  description: string;
}

/** The monthly bill and account header. */
export interface Bill {
  accountName: string;
  /** Masked account number, e.g. "•••• 4021" */
  accountNumber: string;
  /** The account-level plan name, e.g. "Unlimited Plus" */
  planName: string;
  /** Whether autopay + paper-free discount is active */
  autopayEnabled: boolean;
  totalDue: number;
  /** ISO date string */
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  /** Balance carried from the prior bill (should be 0 if you paid in full) */
  previousBalance: number;
  /** Last month's total, for the month-over-month comparison */
  lastMonthTotal: number;
  currency: string;
  charges: ChargeCategory[];
}

/** The complete account payload the dashboard renders. */
export interface VerizonAccount {
  bill: Bill;
  lines: Line[];
  devicePayments: DevicePayment[];
  sims: Sim[];
}

// ---------------------------------------------------------------------------
// Computed summary values shown at the top of the dashboard
// ---------------------------------------------------------------------------

export interface AccountSummary {
  totalDue: number;
  dueDate: string;
  lineCount: number;
  /** Sum of every line's access charge — the recurring "plan" part */
  monthlyPlanTotal: number;
  /** Sum of what you pay toward devices each month */
  devicePaymentMonthly: number;
  /** Total still owed across all device-payment agreements */
  deviceDebtRemaining: number;
  /** Total data used across all lines this cycle */
  totalDataUsedGb: number;
  /** Change vs last month's total (positive = went up) */
  vsLastMonth: number;
  currency: string;
}
