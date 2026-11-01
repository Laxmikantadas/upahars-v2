const KEY = 'upahars_recent';
export function getRecent() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
}
export function addRecent(id) {
    try {
        const next = [id, ...getRecent().filter((x) => x !== id)].slice(0, 10);
        localStorage.setItem(KEY, JSON.stringify(next));
    }
    catch {
        /* storage unavailable — recently viewed is a convenience only */
    }
}
