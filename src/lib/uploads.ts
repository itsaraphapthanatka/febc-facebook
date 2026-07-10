import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

/** Temp storage for broadcast images (uploaded once, sent to each page during async processing). */
export const UPLOAD_DIR = join(process.cwd(), 'uploads');

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export function isAllowedImage(mimetype: string): boolean {
  return mimetype in MIME_EXT;
}

export function extFromMime(mimetype: string): string {
  return MIME_EXT[mimetype] ?? '.jpg';
}

export function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const found = Object.entries(MIME_EXT).find(([, e]) => e === ext);
  return found ? found[0] : 'image/jpeg';
}

/** Saves a buffer to the upload dir and returns the generated filename (no path). */
export async function saveUpload(buffer: Buffer, mimetype: string): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = randomBytes(16).toString('hex') + extFromMime(mimetype);
  await fs.writeFile(join(UPLOAD_DIR, name), buffer);
  return name;
}

export async function readUpload(name: string): Promise<Buffer> {
  return fs.readFile(join(UPLOAD_DIR, name));
}

/** True if an uploaded file still exists (they are pruned after ~24h). */
export async function uploadExists(name: string): Promise<boolean> {
  try {
    await fs.access(join(UPLOAD_DIR, name));
    return true;
  } catch {
    return false;
  }
}

/** Deletes upload files older than maxAgeMs. Returns count removed. */
export async function cleanupOldUploads(maxAgeMs: number): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(UPLOAD_DIR);
  } catch {
    return 0; // dir doesn't exist yet
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    const full = join(UPLOAD_DIR, name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(full);
        removed++;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}
