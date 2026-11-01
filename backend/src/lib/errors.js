import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
export const badRequest = (m, code = 'bad_request', d) => new HttpError(400, code, m, d);
export const unauthorized = (m = 'Please sign in') => new HttpError(401, 'unauthorized', m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const conflict = (m, code = 'conflict') => new HttpError(409, code, m);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorMiddleware(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return res.status(400).json({ error: { code: 'validation_error', message: details[0]?.message ?? 'Invalid input', details } });
    }
    if (err?.code === 11000) return res.status(409).json({ error: { code: 'duplicate', message: 'That value is already in use' } });
    if (err?.name === 'CastError') return res.status(400).json({ error: { code: 'bad_id', message: 'Invalid id' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Invalid JSON' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request is too large' } });
    logger.error?.('[unhandled]', err);
    return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong' } });
  };
}
