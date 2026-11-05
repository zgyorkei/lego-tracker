import path from 'node:path';
import type { RejectedOp } from '../../../lib/data/ops';
import { readJsonFile, writeFileAtomic } from '../store/files';

// What the Drive worker remembers per account, beside the copy
// (<userData>/data/<sub>/drive.json): the Drive file ids it writes, the change
// batches it has applied (so none is applied twice) and refused ops, and which
// history files are up to date in the folder.

export interface DriveStateData {
  fileIds: Record<string, string>;
  applied: string[];
  rejected: Record<string, RejectedOp[]>;
  /** Per set, the history last published: "<rows>:<last row id>". */
  history: Record<string, string>;
}

/** How many batches' refusals are kept for the website to show. */
const MAX_REJECTED_BATCHES = 50;

export class DriveState {
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    readonly data: DriveStateData
  ) {}

  static async load(accountDir: string): Promise<DriveState> {
    const file = path.join(accountDir, 'drive.json');
    const v = await readJsonFile<Partial<DriveStateData>>(file);
    return new DriveState(file, {
      fileIds: v?.fileIds ?? {},
      applied: Array.isArray(v?.applied) ? v.applied : [],
      rejected: v?.rejected ?? {},
      history: v?.history ?? {},
    });
  }

  noteRejected(batchId: string, rejected: RejectedOp[]) {
    if (!rejected.length) return;
    const entries = Object.entries({ ...this.data.rejected, [batchId]: rejected });
    this.data.rejected = Object.fromEntries(entries.slice(-MAX_REJECTED_BATCHES));
  }

  save(): Promise<void> {
    const json = JSON.stringify(this.data);
    this.writing = this.writing.then(
      () => writeFileAtomic(this.file, json),
      () => writeFileAtomic(this.file, json)
    );
    return this.writing;
  }
}
