import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('bundled gallery resolves every indexed SVG without an external checkout or working directory', async t => {
  const isolated = await mkdtemp(join(tmpdir(), 'forma-gallery-'));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const env = { ...process.env, HOME: isolated };
  delete env.LOGOS_DIR;
  const moduleUrl = new URL('../lib/gallery.ts', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile, realpath } from 'node:fs/promises';
    import { join } from 'node:path';
    import { gallery, logoRoot, resolveReference } from ${JSON.stringify(moduleUrl)};
    const root = await realpath(logoRoot);
    const brands = JSON.parse(await readFile(join(root, 'logos.json'), 'utf8'));
    const entries = await gallery();
    assert.ok(entries.length > 1000);
    for (const brand of brands) {
      for (const file of brand.files) {
        const asset = await realpath(join(root, 'logos', file));
        assert.ok(asset.startsWith(root + '/logos/'), file + ' must be bundled');
        assert.match(await readFile(asset, 'utf8'), /<svg\\b/);
        assert.equal((await resolveReference(brand.shortname, file))?.file, file);
      }
    }
    assert.equal(await resolveReference('missing-brand', '../outside.svg'), null);
    console.log(entries.length);
  `], { cwd: isolated, env, encoding: 'utf8' });
  assert.ok(Number(output.trim()) > 1000);
});
