// Validates req.body / req.query / req.params with a zod schema. Schemas for write endpoints are
// .strict(): unknown fields (e.g. a client trying to send sellerId, price or commission) are rejected.
export const validate = (schema, part = 'body') => (req, _res, next) => {
  try { req[part] = schema.parse(req[part] ?? {}); next(); } catch (e) { next(e); }
};
