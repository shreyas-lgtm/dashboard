/**
 * Sample Verizon account for local development (VITE_USE_MOCK=true, the default).
 *
 * These numbers are fictional but structured exactly like a real Verizon bill:
 * a 3-line "Unlimited Plus" account with two phones still being paid off, one
 * paid-off phone, a mix of eSIM and physical SIMs, and the usual pile of
 * surcharges and taxes.
 *
 * To see YOUR account here, replace the values below with the numbers from your
 * latest bill (My Verizon → Bill → View bill / "Bill details"). Everything on
 * the dashboard is computed from this one object.
 */

import type { VerizonAccount } from './types';

export const MOCK_ACCOUNT: VerizonAccount = {
  bill: {
    accountName: 'Sample Household',
    accountNumber: '•••• 4021',
    planName: 'Unlimited Plus',
    autopayEnabled: true,
    totalDue: 214.37,
    dueDate: '2026-08-10',
    billingPeriodStart: '2026-07-11',
    billingPeriodEnd: '2026-08-10',
    previousBalance: 0,
    lastMonthTotal: 208.11,
    currency: 'USD',
    charges: [
      {
        key: 'plan',
        label: 'Plan (line access)',
        amount: 115.0,
        description:
          'The recurring monthly fee for your plan, charged per line. This is the "service" part — talk, text, and data. On multi-line accounts each line has its own charge and they add up.',
      },
      {
        key: 'devices',
        label: 'Device payments',
        amount: 68.32,
        description:
          'Installments toward phones you financed instead of buying outright. Interest-free, but you owe the full balance if you leave before the term ends. Trade-in promo credits are applied here too.',
      },
      {
        key: 'perks',
        label: 'Perks & add-ons',
        amount: 10.0,
        description:
          'Optional extras added to the plan — things like a streaming perk, a cloud storage upgrade, or device protection.',
      },
      {
        key: 'surcharges',
        label: 'Surcharges',
        amount: 12.44,
        description:
          'Verizon-set fees that are NOT taxes: the Federal Universal Service Charge, a Regulatory Charge, and the Administrative & Telco Recovery Charge. They change month to month.',
      },
      {
        key: 'taxes',
        label: 'Taxes & gov fees',
        amount: 8.61,
        description:
          'Actual government taxes and 911 fees set by your state and city, not by Verizon.',
      },
    ],
  },

  lines: [
    {
      lineId: 'line1',
      phoneNumber: '(415) 555-0142',
      nickname: 'Alex — main phone',
      device: 'iPhone 15 Pro 256GB',
      planName: 'Unlimited Plus',
      monthlyLineAccess: 45.0,
      dataUsedGb: 24.3,
      dataAllowanceGb: 'unlimited',
      devicePaymentId: 'dp1',
      simId: 'sim1',
    },
    {
      lineId: 'line2',
      phoneNumber: '(415) 555-0178',
      nickname: 'Sam — phone',
      device: 'Samsung Galaxy S24',
      planName: 'Unlimited Plus',
      monthlyLineAccess: 40.0,
      dataUsedGb: 11.8,
      dataAllowanceGb: 'unlimited',
      devicePaymentId: 'dp2',
      simId: 'sim2',
    },
    {
      lineId: 'line3',
      phoneNumber: '(415) 555-0199',
      nickname: 'Jordan — phone (paid off)',
      device: 'iPhone 13',
      planName: 'Unlimited Plus',
      monthlyLineAccess: 30.0,
      dataUsedGb: 6.1,
      dataAllowanceGb: 'unlimited',
      // no devicePaymentId — this phone is fully paid off
      simId: 'sim3',
    },
  ],

  devicePayments: [
    {
      agreementId: 'dp1',
      device: 'iPhone 15 Pro 256GB',
      monthlyAmount: 41.66,
      monthsPaid: 12,
      termMonths: 36,
      originalPrice: 1499.99,
      remainingBalance: 999.84,
      promoCredit: 27.77, // trade-in credit — net cost ≈ $13.89/mo
    },
    {
      agreementId: 'dp2',
      device: 'Samsung Galaxy S24',
      monthlyAmount: 22.22,
      monthsPaid: 30,
      termMonths: 36,
      originalPrice: 799.99,
      remainingBalance: 133.32,
      promoCredit: 0,
    },
  ],

  sims: [
    {
      simId: 'sim1',
      type: 'eSIM',
      iccidLast4: '8842',
      status: 'active',
      lineId: 'line1',
    },
    {
      simId: 'sim2',
      type: 'physical',
      iccidLast4: '3107',
      status: 'active',
      lineId: 'line2',
    },
    {
      simId: 'sim3',
      type: 'physical',
      iccidLast4: '9560',
      status: 'active',
      lineId: 'line3',
    },
  ],
};
