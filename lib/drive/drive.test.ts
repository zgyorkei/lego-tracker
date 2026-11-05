import { describe, expect, it, vi } from 'vitest';
import { createDriveClient, DriveError } from './client';
import {
  anotherPublisher,
  decodeJsonGz,
  encodeJsonGz,
  isFresh,
  opsFile,
  parseHistoryFile,
  parseOpsFile,
  pendingBatches,
  remember,
} from './layout';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createDriveClient', () => {
  it('lists the app folder page by page, keeping names that start with the prefix', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ files: [{ id: '1', name: 'ops-1-aaaaaaaa.json' }], nextPageToken: 'p2' })
      )
      .mockResolvedValueOnce(json({ files: [{ id: '2', name: 'x-ops-2.json' }] }));
    const drive = createDriveClient(async () => 'tok', fetchMock as unknown as typeof fetch);
    const files = await drive.list("ops-'");
    expect(files.map((f) => f.id)).toEqual([]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('spaces')).toBe('appDataFolder');
    expect(url.searchParams.get('q')).toBe("name contains 'ops-\\''");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('p2');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('asks for a new token once when Google refuses the old one', async () => {
    const tokens: boolean[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(json({ files: [] }));
    const drive = createDriveClient(
      async ({ refresh }) => {
        tokens.push(refresh);
        return refresh ? 'new' : 'old';
      },
      fetchMock as unknown as typeof fetch
    );
    await drive.list();
    expect(tokens).toEqual([false, true]);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('uploads into the app folder and reports errors with Google message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'f1', name: 'status.json' }))
      .mockResolvedValueOnce(json({ error: { message: 'Rate limit' } }, 429))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const drive = createDriveClient(async () => 't', fetchMock as unknown as typeof fetch);
    expect(await drive.create('status.json', '{"a":1}', 'application/json')).toEqual({
      id: 'f1',
      name: 'status.json',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('uploadType=multipart');
    const body = await (init.body as Blob).text();
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('{"a":1}');
    await expect(drive.update('f1', 'x', 'application/json')).rejects.toEqual(
      new DriveError(429, 'Google Drive: Rate limit')
    );
    // A file already gone counts as removed.
    await expect(drive.remove('gone')).resolves.toBeUndefined();
  });
});

describe('layout', () => {
  it('reads ops file names, and nothing else', () => {
    expect(parseOpsFile(opsFile(1730800000000, 'batch-0001'))).toEqual({
      at: 1730800000000,
      batchId: 'batch-0001',
    });
    expect(parseOpsFile('ops-1-../x.json')).toBeNull();
    expect(parseOpsFile('snapshot.json.gz')).toBeNull();
    expect(parseHistoryFile('history-abc.json.gz')).toBe('abc');
    expect(parseHistoryFile('history-../x.json.gz')).toBeNull();
  });

  it('lists the batches still to apply, oldest first', () => {
    const files = [
      { id: 'c', name: opsFile(3, 'batch-cccc') },
      { id: 'a', name: opsFile(1, 'batch-aaaa') },
      { id: 'b', name: opsFile(2, 'batch-bbbb') },
      { id: 's', name: 'snapshot.json.gz' },
    ];
    expect(pendingBatches(files, ['batch-bbbb']).map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('tells a live publisher from a gone one', () => {
    const now = Date.parse('2026-11-05T10:00:00Z');
    const at = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
    expect(isFresh({ heartbeatAt: at(4) }, now)).toBe(true);
    expect(isFresh({ heartbeatAt: at(6) }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    expect(anotherPublisher({ publisher: 'other', heartbeatAt: at(1) }, 'me', now)).toBe(true);
    expect(anotherPublisher({ publisher: 'me', heartbeatAt: at(1) }, 'me', now)).toBe(false);
    expect(anotherPublisher({ publisher: 'other', heartbeatAt: at(10) }, 'me', now)).toBe(false);
  });

  it('remembers the newest applied ids without repeats', () => {
    expect(remember(['a', 'b'], 'a', 3)).toEqual(['b', 'a']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('gzips JSON both ways', async () => {
    const value = { sets: [{ id: 'x', name: 'Árvíztűrő' }], n: 3 };
    const bytes = await encodeJsonGz(value);
    expect(bytes[0]).toBe(0x1f);
    expect(await decodeJsonGz(bytes)).toEqual(value);
  });
});
