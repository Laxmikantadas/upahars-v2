import { conflict, notFound, badRequest } from '../lib/errors.js';
import { Ledger, Payout } from '../models/index.js';

const log = (by, action, note = '') => ({ at: new Date(), by: String(by), action, note });
export const outstanding = (l) => l.sellerPayablePaise - l.settledPaise;

/**
 * A ledger is payable once the order was delivered and the return window (payoutHoldDays) has passed.
 * A NEGATIVE outstanding (a refund after the seller was already paid) is a clawback and is netted into the next payout.
 * Ledgers on hold for a dispute, or already inside an open payout, are skipped.
 */
export async function eligibleLedgers(sellerId, now = new Date()) {
  const rows = await Ledger.find({ sellerId, status: { $in: ['pending', 'paid', 'reversed'] } });
  return rows.filter((l) => { const o = outstanding(l); return o < 0 || (o > 0 && l.status === 'pending' && l.deliveredAt && l.payableAfter && l.payableAfter <= now); });
}

export async function createPayout({ sellerId, adminId, now = new Date() }) {
  const rows = await eligibleLedgers(sellerId, now);
  const total = rows.reduce((a, l) => a + outstanding(l), 0);
  if (!rows.length || total <= 0) throw conflict('Nothing is payable for this seller yet', 'nothing_to_pay');
  const payout = await Payout.create({ sellerId, ledgerIds: rows.map((r) => r._id), amountPaise: total, createdBy: adminId });
  const locked = [];
  for (const r of rows) {
    const ok = await Ledger.findOneAndUpdate({ _id: r._id, status: r.status }, { $set: { status: 'in_payout', pendingSettlePaise: outstanding(r), payoutId: payout._id }, $push: { history: log(adminId, 'in_payout', String(payout._id)) } });
    if (!ok) {
      for (const l of locked) await Ledger.updateOne({ _id: l._id }, { $set: { status: l.status, pendingSettlePaise: 0, payoutId: null } });
      await Payout.deleteOne({ _id: payout._id });
      throw conflict('Earnings changed while creating the payout. Please try again.', 'payout_conflict');
    }
    locked.push({ _id: r._id, status: r.status });
  }
  return payout;
}

export async function markPayoutPaid({ payoutId, reference, method = '', adminId }) {
  if (!reference?.trim()) throw badRequest('Enter the bank/UPI transaction reference', 'reference_required'); // no confirmed payout without evidence
  const p = await Payout.findOneAndUpdate({ _id: payoutId, status: 'processing' }, { $set: { status: 'paid', reference: reference.trim(), method, paidAt: new Date() } }, { new: true });
  if (!p) throw conflict('This payout is not awaiting payment', 'bad_state');
  for (const id of p.ledgerIds) {
    const l = await Ledger.findById(id);
    await Ledger.updateOne({ _id: id }, { $set: { settledPaise: l.settledPaise + l.pendingSettlePaise, pendingSettlePaise: 0, status: 'paid' }, $push: { history: log(adminId, 'paid', reference) } });
  }
  return p;
}

export async function markPayoutFailed({ payoutId, note = '', adminId }) {
  const p = await Payout.findOneAndUpdate({ _id: payoutId, status: 'processing' }, { $set: { status: 'failed', note } }, { new: true });
  if (!p) throw conflict('This payout is not awaiting payment', 'bad_state');
  await Ledger.updateMany({ _id: { $in: p.ledgerIds } }, { $set: { status: 'pending', pendingSettlePaise: 0, payoutId: null }, $push: { history: log(adminId, 'payout_failed', note) } });
  return p;
}

export async function earningsSummary(sellerId, now = new Date()) {
  const rows = await Ledger.find({ sellerId }).lean();
  const sum = (f) => rows.filter(f).reduce((a, l) => a + outstanding(l), 0);
  const delivered = (l) => l.deliveredAt && l.payableAfter && l.payableAfter <= now;
  return {
    pendingPaise: sum((l) => l.status === 'pending' && outstanding(l) > 0 && !delivered(l)),
    payablePaise: sum((l) => l.status === 'pending' && outstanding(l) > 0 && delivered(l)),
    inPayoutPaise: rows.filter((l) => l.status === 'in_payout').reduce((a, l) => a + l.pendingSettlePaise, 0),
    paidPaise: rows.reduce((a, l) => a + l.settledPaise, 0),
    onHoldPaise: sum((l) => l.status === 'disputed'),
    grossPaise: rows.reduce((a, l) => a + l.grossPaise, 0),
    commissionPaise: rows.reduce((a, l) => a + l.commissionPaise, 0),
    orders: rows.length,
  };
}
export { notFound };
