import { AuditLog } from '../models/index.js';

/** Writes an audit entry; never throws into the request (a logging problem must not block the action). */
export async function audit(req, action, entity, entityId, details = {}) {
  try {
    await AuditLog.create({
      actorId: req?.user?._id, actorRole: req?.user?.roles?.includes('admin') ? 'admin' : req?.seller ? 'seller' : 'user',
      action, entity, entityId: entityId == null ? '' : String(entityId), details, ip: req?.ip,
    });
  } catch (e) { console.error('[audit failed]', e.message); }
}
