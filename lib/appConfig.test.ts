import { describe, expect, it } from 'vitest';
import { normalisePublicUrl, parseFirebaseConfigText, validateAppConfig } from './appConfig';

const consoleSnippet = `
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "AIzaSyExample-key_1",
  authDomain: "my-bricks.firebaseapp.com",
  projectId: "my-bricks",
  storageBucket: "my-bricks.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
  measurementId: "G-ABC123"
};
const app = initializeApp(firebaseConfig);
`;

describe('parseFirebaseConfigText', () => {
  it("reads the Firebase console's JavaScript snippet", () => {
    expect(parseFirebaseConfigText(consoleSnippet)).toMatchObject({
      apiKey: 'AIzaSyExample-key_1',
      authDomain: 'my-bricks.firebaseapp.com',
      projectId: 'my-bricks',
      appId: '1:1234567890:web:abcdef',
    });
  });

  it('reads JSON such as firebase-applet-config.json', () => {
    const json = JSON.stringify({ apiKey: 'k', authDomain: 'a', projectId: 'p', appId: 'i', firestoreDatabaseId: 'named-db' });
    expect(parseFirebaseConfigText(json)).toEqual({
      apiKey: 'k',
      authDomain: 'a',
      projectId: 'p',
      appId: 'i',
      firestoreDatabaseId: 'named-db',
    });
  });

  it('accepts single quotes', () => {
    expect(parseFirebaseConfigText("{ projectId: 'p' }")).toEqual({ projectId: 'p' });
  });
});

describe('normalisePublicUrl', () => {
  it('drops a trailing slash', () => {
    expect(normalisePublicUrl(' https://bricks.example.com/ ')).toBe('https://bricks.example.com');
  });

  it('keeps a path, for a site under a subfolder', () => {
    expect(normalisePublicUrl('https://example.com/bricks/')).toBe('https://example.com/bricks');
  });

  it('allows plain http only for localhost', () => {
    expect(normalisePublicUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalisePublicUrl('http://bricks.example.com')).toBeNull();
  });

  it('rejects things that are not addresses', () => {
    expect(normalisePublicUrl('bricks.example.com')).toBeNull();
    expect(normalisePublicUrl('javascript:alert(1)')).toBeNull();
    expect(normalisePublicUrl('https://example.com/?x=1')).toBeNull();
  });
});

describe('validateAppConfig', () => {
  const firebase = parseFirebaseConfigText(consoleSnippet);

  it('cleans a complete config and defaults the database name', () => {
    const result = validateAppConfig({ firebase: { ...firebase, extra: 'ignored' }, publicAppUrl: 'https://bricks.example.com/' });
    expect(result).toEqual({
      config: {
        firebase: {
          apiKey: 'AIzaSyExample-key_1',
          authDomain: 'my-bricks.firebaseapp.com',
          projectId: 'my-bricks',
          storageBucket: 'my-bricks.firebasestorage.app',
          messagingSenderId: '1234567890',
          appId: '1:1234567890:web:abcdef',
          firestoreDatabaseId: '(default)',
        },
        publicAppUrl: 'https://bricks.example.com',
      },
    });
  });

  it('names the missing Firebase fields', () => {
    expect(validateAppConfig({ firebase: { apiKey: 'k' }, publicAppUrl: 'https://x.example' })).toEqual({
      error: 'The Firebase config is missing authDomain, projectId, appId.',
    });
  });

  it('requires a usable website address', () => {
    expect(validateAppConfig({ firebase, publicAppUrl: 'not a url' })).toHaveProperty('error');
    expect(validateAppConfig({ firebase })).toHaveProperty('error');
  });

  it('rejects nothing at all', () => {
    expect(validateAppConfig(null)).toHaveProperty('error');
  });
});
