import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile, rotateDailyBackup, writeFileAtomic, writeFileAtomicSync } from './files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-files-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const busy = (code: string) => Object.assign(new Error(code), { code });

describe('writeFileAtomic', () => {
  it('writes the file, creating folders, and leaves no temporary file', async () => {
    const file = path.join(dir, 'a', 'b', 'state.json');
    await writeFileAtomic(file, '{"x":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"x":1}');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);
  });

  it('retries the rename while Windows holds the file', async () => {
    const real = fs.promises.rename;
    const rename = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(busy('EPERM'))
      .mockRejectedValueOnce(busy('EBUSY'))
      .mockImplementation(real);
    const file = path.join(dir, 'state.json');
    await writeFileAtomic(file, 'ok');
    expect(rename).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(file, 'utf8')).toBe('ok');
  });

  it('gives up on other errors, removing the temporary file', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(busy('ENOSPC'));
    await expect(writeFileAtomic(path.join(dir, 'state.json'), 'x')).rejects.toThrow('ENOSPC');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('has a synchronous twin for the final write', () => {
    const file = path.join(dir, 'sync', 'state.json');
    writeFileAtomicSync(file, 'sync');
    expect(fs.readFileSync(file, 'utf8')).toBe('sync');
  });
});

describe('readJsonFile', () => {
  it('reads JSON, and null for a missing file', async () => {
    const file = path.join(dir, 'a.json');
    expect(await readJsonFile(file)).toBeNull();
    fs.writeFileSync(file, '[1,2]');
    expect(await readJsonFile(file)).toEqual([1, 2]);
  });

  it('moves a file that does not parse aside instead of losing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, '{broken');
    expect(await readJsonFile(file)).toBeNull();
    const left = fs.readdirSync(dir);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^a\.json\.corrupt-\d+$/);
  });
});

describe('rotateDailyBackup', () => {
  it('copies the file once per day and keeps the newest seven', async () => {
    const file = path.join(dir, 'state.json');
    const backups = path.join(dir, 'backup');
    fs.writeFileSync(file, 'day 1');
    for (let d = 1; d <= 9; d++) {
      fs.writeFileSync(file, `day ${d}`);
      await rotateDailyBackup(file, backups, `2026-11-0${d}`);
    }
    // A second call on the same day keeps that day's first copy.
    fs.writeFileSync(file, 'later');
    expect(await rotateDailyBackup(file, backups, '2026-11-09')).toBe('2026-11-09');
    const names = fs.readdirSync(backups).sort();
    expect(names).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => `state-2026-11-0${d}.bak`));
    expect(fs.readFileSync(path.join(backups, 'state-2026-11-09.bak'), 'utf8')).toBe('day 9');
  });

  it('does nothing without a file', async () => {
    expect(
      await rotateDailyBackup(path.join(dir, 'none.json'), path.join(dir, 'b'), '2026-11-04')
    ).toBeNull();
  });
});
