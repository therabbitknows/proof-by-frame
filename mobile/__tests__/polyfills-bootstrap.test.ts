import fs from 'node:fs';
import path from 'node:path';

describe('Hermes runtime bootstrap', () => {
  const root = path.resolve(__dirname, '..');
  const entrypoint = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const polyfills = fs.readFileSync(path.join(root, 'polyfills.js'), 'utf8');

  it('loads polyfills before the application module', () => {
    expect(entrypoint.indexOf("import './polyfills'"))
      .toBeLessThan(entrypoint.indexOf("import App from './App'"));
  });

  it('installs the required Hermes and Solana globals', () => {
    expect(polyfills).toContain("from 'buffer'");
    expect(polyfills).toContain("'react-native-get-random-values'");
    expect(polyfills).toContain('globalThis.Buffer ??= Buffer');
  });
});
