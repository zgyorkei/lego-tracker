import { describe, expect, it } from 'vitest';
import { canChooseSource, chooseDataSource, type SourceInputs } from './dataSource';

const website: SourceInputs = {
  desktopApp: false,
  firebase: true,
  google: true,
  preference: 'auto',
  firestoreFailed: false,
  driveSignedIn: false,
};

describe('chooseDataSource', () => {
  it('uses the copy on this PC in the desktop app, whatever else is set', () => {
    expect(chooseDataSource({ ...website, desktopApp: true, preference: 'desktop' }).source).toBe(
      'local'
    );
  });

  it('uses Firebase on a website without a Google client id, even when Firestore fails', () => {
    expect(chooseDataSource({ ...website, google: false, firestoreFailed: true })).toEqual({
      source: 'firestore',
      switched: false,
      offerDesktop: false,
    });
  });

  it("uses the desktop's copy on a website without Firebase", () => {
    expect(chooseDataSource({ ...website, firebase: false }).source).toBe('drive');
  });

  it('follows the preference when there is a choice', () => {
    expect(
      chooseDataSource({ ...website, preference: 'firebase', firestoreFailed: true }).source
    ).toBe('firestore');
    expect(chooseDataSource({ ...website, preference: 'desktop' }).source).toBe('drive');
  });

  it("Auto: Firebase while it works, the desktop's copy when it fails and Drive is signed in", () => {
    expect(chooseDataSource(website).source).toBe('firestore');
    expect(chooseDataSource({ ...website, firestoreFailed: true, driveSignedIn: true })).toEqual({
      source: 'drive',
      switched: true,
      offerDesktop: false,
    });
  });

  it("Auto: offers the desktop's copy when Firebase fails and Drive needs a sign-in", () => {
    expect(chooseDataSource({ ...website, firestoreFailed: true })).toEqual({
      source: 'firestore',
      switched: false,
      offerDesktop: true,
    });
  });

  it('lets the user choose only on a website with both', () => {
    expect(canChooseSource(website)).toBe(true);
    expect(canChooseSource({ ...website, google: false })).toBe(false);
    expect(canChooseSource({ ...website, firebase: false })).toBe(false);
    expect(canChooseSource({ ...website, desktopApp: true })).toBe(false);
  });
});
