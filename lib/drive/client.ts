// Google Drive's app-data folder (scope drive.appdata), fetch only, so the
// same code runs in the desktop's main process and, later, in the website.
// The folder is private to this Google Cloud project and the signed-in
// account; the user never sees it in Drive. Layout: ./layout.ts.

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,modifiedTime,size';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** An access token for drive.appdata; `refresh` asks for a new one (the old was refused). */
export type TokenSource = (opts: { refresh: boolean }) => Promise<string>;

export interface DriveClient {
  /** Files in the app-data folder, optionally only those whose name starts with `prefix`. */
  list(prefix?: string): Promise<DriveFile[]>;
  download(id: string): Promise<Uint8Array>;
  create(name: string, body: Uint8Array | string, mimeType: string): Promise<DriveFile>;
  update(id: string, body: Uint8Array | string, mimeType: string): Promise<DriveFile>;
  /** Removes a file; one already gone counts as removed. */
  remove(id: string): Promise<void>;
}

const bytesOf = (body: Uint8Array | string) =>
  typeof body === 'string' ? new TextEncoder().encode(body) : body;

export function createDriveClient(
  getToken: TokenSource,
  fetchImpl: typeof fetch = fetch
): DriveClient {
  // One retry with a fresh token when the old one is refused (expired, revoked).
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken({ refresh: attempt > 0 });
      const res = await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && attempt === 0) continue;
      if (res.ok || res.status === 204) return res;
      let message = `${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        message = j.error?.message ?? message;
      } catch {
        // Not JSON: the status says enough.
      }
      throw new DriveError(res.status, `Google Drive: ${message}`);
    }
  }

  return {
    async list(prefix) {
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          fields: `nextPageToken,files(${FIELDS})`,
          pageSize: '1000',
          ...(prefix ? { q: `name contains '${prefix.replace(/['\\]/g, '\\$&')}'` } : {}),
          ...(pageToken ? { pageToken } : {}),
        });
        const j = (await (await call(`${API}?${q}`)).json()) as {
          files?: DriveFile[];
          nextPageToken?: string;
        };
        files.push(...(j.files ?? []));
        pageToken = j.nextPageToken;
      } while (pageToken);
      // "contains" matches anywhere; the layout's names are all prefixes.
      return prefix ? files.filter((f) => f.name.startsWith(prefix)) : files;
    },

    async download(id) {
      const res = await call(`${API}/${encodeURIComponent(id)}?alt=media`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async create(name, body, mimeType) {
      const boundary = `bt${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
      const multipart = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        bytesOf(body) as BlobPart,
        `\r\n--${boundary}--`,
      ]);
      const res = await call(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      return (await res.json()) as DriveFile;
    },

    async update(id, body, mimeType) {
      const res = await call(
        `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': mimeType },
          body: new Blob([bytesOf(body) as BlobPart]),
        }
      );
      return (await res.json()) as DriveFile;
    },

    async remove(id) {
      try {
        await call(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (err) {
        if (err instanceof DriveError && err.status === 404) return;
        throw err;
      }
    },
  };
}
