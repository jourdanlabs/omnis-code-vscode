/**
 * Install metadata a stranger can follow. This extension is sideloaded from a
 * GitHub Release vsix — not listed on the Visual Studio Marketplace.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(__dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

test('manifest identity a stranger will search for', () => {
  const pkg = JSON.parse(read('package.json')) as {
    name: string;
    displayName: string;
    publisher: string;
    version: string;
    main: string;
    icon: string;
    activationEvents: string[];
  };
  assert.equal(pkg.name, 'omnis-code');
  assert.equal(pkg.displayName, 'OMNIS CODE for VS Code');
  assert.equal(pkg.publisher, 'jourdanlabs');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.main, './out/extension.js');
  assert.equal(pkg.icon, 'media/icon.png');
  assert.ok(
    pkg.activationEvents.includes('onStartupFinished'),
    'a missing engine must be reported without waiting for a sidebar click',
  );
});

test('the packaged icon exists so vsce can build a vsix', () => {
  assert.ok(existsSync(join(ROOT, 'media', 'icon.png')), 'media/icon.png is missing');
});

test('README tells a stranger the exact vsix install command', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string };
  const readme = read('README.md');
  const vsix = `omnis-code-${pkg.version}.vsix`;
  assert.match(
    readme,
    new RegExp(`code --install-extension ${vsix.replace(/\./g, '\\.')}`),
    `README must name the install command for ${vsix}`,
  );
  assert.match(readme, /releases\/latest/);
  assert.match(readme, /Download/i);
});

test('README does not claim a Marketplace listing or a coming-soon', () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, /coming soon/i);
  assert.doesNotMatch(readme, /install from the (visual studio )?marketplace/i);
  assert.doesNotMatch(readme, /available on the (visual studio )?marketplace/i);
  assert.doesNotMatch(
    readme,
    /marketplace\.visualstudio\.com/i,
    'do not point at a Marketplace item that 404s',
  );
});

test('README still states the observer contract', () => {
  const readme = read('README.md');
  assert.match(readme, /can observe/i);
  assert.match(readme, /cannot gate/i);
  assert.match(readme, /does not block writes/i);
});
