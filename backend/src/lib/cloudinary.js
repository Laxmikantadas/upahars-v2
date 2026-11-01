import { createHash } from 'node:crypto';

// Images are uploaded straight from the browser to Cloudinary with a SERVER-SIGNED request, so the API
// secret never leaves the server and each user can only upload into their own folder.
// Signature (Cloudinary docs): sort params, join as k=v&k=v, append the API secret, SHA-1 hex.
const sign = (params, secret) =>
  createHash('sha1').update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret).digest('hex');

export const ALLOWED_FORMATS = 'jpg,jpeg,png,webp';

export function signUpload(cfg, { folder, timestamp = Math.floor(Date.now() / 1000) }) {
  const { cloudName, apiKey, apiSecret } = cfg;
  if (!cloudName || !apiKey || !apiSecret) return null;
  const params = { allowed_formats: ALLOWED_FORMATS, folder, timestamp };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    cloudName, apiKey, timestamp, folder, allowedFormats: ALLOWED_FORMATS,
    signature: sign(params, apiSecret),
  };
}

/** Folder a given user may upload product/store images into. */
export const sellerFolder = (sellerId) => `upahars/sellers/${sellerId}`;
export const originalsFolder = () => 'upahars/originals';
export const siteFolder = () => 'upahars/site';

/**
 * Accept only images that live in OUR Cloudinary account and inside the allowed folder.
 * This stops sellers pointing products at arbitrary external URLs.
 */
export function parseOwnedImage(cfg, url, folder) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com' || u.search || u.hash) return null;
    const prefix = `/${cfg.cloudName}/image/upload/`;
    if (!cfg.cloudName || !u.pathname.startsWith(prefix)) return null;
    let rest = u.pathname.slice(prefix.length);
    rest = rest.replace(/^v\d+\//, '');
    if (!rest.startsWith(folder + '/') || rest.includes('..')) return null;
    const publicId = rest.replace(/\.[a-z0-9]+$/i, '');
    return { url: u.toString(), publicId };
  } catch { return null; }
}
