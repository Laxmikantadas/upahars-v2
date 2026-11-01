import { api, ApiError } from '../../lib/api';
/** Uploads one image straight to Cloudinary with a server-signed request and returns its https URL. Administrators only. */
export async function uploadImage(file, scope) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type))
        throw new ApiError(0, 'bad_type', 'Please choose a JPG, PNG or WebP image.');
    if (file.size > 8 * 1024 * 1024)
        throw new ApiError(0, 'too_big', 'That image is larger than 8 MB. Please choose a smaller one.');
    const { upload: u } = await api('/uploads/sign', { body: { scope } });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', u.apiKey);
    fd.append('timestamp', String(u.timestamp));
    fd.append('signature', u.signature);
    fd.append('folder', u.folder);
    fd.append('allowed_formats', u.allowedFormats);
    let res;
    try {
        res = await fetch(u.uploadUrl, { method: 'POST', body: fd });
    }
    catch {
        throw new ApiError(0, 'network', 'Image upload failed. Check your connection.');
    }
    const data = (await res.json().catch(() => ({})));
    if (!res.ok || !data.secure_url)
        throw new ApiError(res.status, 'upload_failed', data.error?.message ?? 'Image upload failed.');
    return data.secure_url;
}
