// Tiny .env loader so the backend runs on ANY Node.js 18+ (no `--env-file` flag, no extra package).
// Real environment variables always win over the file. Import this FIRST in every entry point.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(file = resolve(process.cwd(), '.env'), env = process.env) {
  if (!existsSync(file)) return false;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ''); // strip trailing "  # comment" on unquoted values
    if (env[m[1]] === undefined) env[m[1]] = v;
  }
  return true;
}
loadEnvFile();
