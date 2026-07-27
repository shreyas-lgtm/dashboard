/**
 * Dashboard configuration + the plain-language glossary.
 *
 * The glossary is the heart of this dashboard: the My Verizon website is
 * confusing mostly because of its vocabulary. Every term below is decoded in
 * everyday language and shown in the "What am I actually paying for?" section.
 */

/** Auto-refresh interval in milliseconds (5 minutes). */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Color used for each charge category in the breakdown bar. */
export const CHARGE_COLORS: Record<string, string> = {
  plan: '#2563eb', // blue
  devices: '#7c3aed', // violet
  perks: '#0891b2', // cyan
  surcharges: '#d97706', // amber
  taxes: '#64748b', // slate
  oneTime: '#dc2626', // red
};

/** Plain-language definitions of the Verizon terms that trip people up. */
export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'Line access charge',
    definition:
      'The monthly fee for keeping one phone number active on your plan. On a family account each line has its own charge — three lines means three access charges added together. This is your "service" cost and it recurs every month forever, unlike a device payment which ends.',
  },
  {
    term: 'Device payment agreement',
    definition:
      'Instead of paying for a phone up front, Verizon splits the retail price into 24 or 36 interest-free monthly installments. It shows up as a separate line on your bill. When it finishes, that amount drops off your bill. If you cancel the line early, the remaining balance becomes due immediately.',
  },
  {
    term: 'Trade-in / promo credit',
    definition:
      'When Verizon advertises a phone as "free" or "$800 off", they usually still charge you the full device payment each month AND apply a matching credit — but only if you keep the line for the entire 36 months. Leave early and you lose the remaining credits while still owing the device balance.',
  },
  {
    term: 'Surcharges',
    definition:
      'Fees Verizon sets itself — most notably the "Administrative and Telco Recovery Charge" and the "Regulatory Charge". These are NOT government taxes; they are Verizon revenue that is simply listed outside the advertised plan price. They vary slightly month to month.',
  },
  {
    term: 'Taxes & government fees',
    definition:
      'Actual taxes and 911 fees imposed by your state and local government. Verizon collects these and passes them on; the amount depends on your billing address.',
  },
  {
    term: 'Autopay & paper-free discount',
    definition:
      'Verizon advertises plan prices that already assume you have Auto Pay (from a bank account or debit card) plus paperless billing turned on. Without both, each line typically costs $10 more than the advertised price.',
  },
  {
    term: 'eSIM vs physical SIM',
    definition:
      'A SIM is what connects a device to the network. A physical SIM is the little plastic card you insert; an eSIM is a digital version programmed into the phone — nothing to insert, and you can switch devices by scanning a QR code. Both work identically; newer iPhones in the US are eSIM-only.',
  },
  {
    term: 'ICCID',
    definition:
      'The serial number that uniquely identifies a SIM/eSIM. You only ever need it when activating a line or moving service to a new SIM. The dashboard shows just the last 4 digits.',
  },
  {
    term: 'Billing cycle',
    definition:
      'Verizon bills a month at a time on a fixed cycle that usually does NOT match the calendar month (e.g. the 11th to the 10th). Data usage resets at the start of each cycle, and your payment is due a couple of weeks after the cycle closes.',
  },
];
