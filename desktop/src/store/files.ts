import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Files for the local store. On Windows a rename onto a file that an
// antivirus scanner or the search indexer has open fails with EPERM, EBUSY or
// EACCES for a moment, so renames are retried. Writes go to a temporary file
// first and are flushed to disk before the rename, so a crash or power cut
// leaves either the old file or the new one, never half of one.

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [20, 50, 100, 200, 400, 800, 1000];

const isRetryable = (err: unknown) => RETRY_CODES.has((err as NodeJS.ErrnoException)?.code ?? '');
const tmpName = (file: string) => `${file}.${randomBytes(6).toString('hex')}.tmp`;

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes `data` to `file` atomically, retrying the rename while Windows holds the target. */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpName(file);
  const handle = await fs.promises.open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmp, file);
      return;
    } catch (err) {
      if (!isRetryable(err) || attempt >= RETRY_DELAYS_MS.length) {
        await fs.promises.rm(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** The same, synchronously: for the last write as the app quits. */
export function writeFileAtomicSync(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpName(file);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!isRetryable(err) || attempt >= RETRY_DELAYS_MS.length) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Reads a JSON file: null when it does not exist. A file that does not parse
 * is moved aside (kept for inspection, never overwritten) and read as missing.
 */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const aside = `${file}.corrupt-${Date.now()}`;
    await fs.promises.rename(file, aside).catch(() => {});
    console.error(`Local store: ${file} did not parse; kept as ${aside}`);
    return null;
  }
}

/**
 * Keeps one copy of `file` per day in `backupDir` (named <base>-<day>.bak),
 * the newest `keep` of them. Does nothing when today's copy exists already or
 * the file is missing. Returns the day of the newest backup, if any.
 */
export async function rotateDailyBackup(
  file: string,
  backupDir: string,
  day: string,
  keep = 7
): Promise<string | null> {
  const base = path.basename(file, path.extname(file));
  const name = (d: string) => `${base}-${d}.bak`;
  await fs.promises.mkdir(backupDir, { recursive: true });
  const today = path.join(backupDir, name(day));
  if (!fs.existsSync(today) && fs.existsSync(file)) {
    await fs.promises.copyFile(file, today);
  }
  const pattern = new RegExp(`^${base}-(\\d{4}-\\d{2}-\\d{2})\\.bak$`);
  const days = (await fs.promises.readdir(backupDir))
    .map((f) => f.match(pattern)?.[1])
    .filter((d): d is string => !!d)
    .sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) {
    await fs.promises.rm(path.join(backupDir, name(old)), { force: true });
  }
  return days.length ? days[days.length - 1] : null;
}
