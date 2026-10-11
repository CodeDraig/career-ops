// Exercise the real rollback CLI against an isolated Git repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, hermeticGitEnv, hermeticGitRunner, linkRepoPackage, rmSync } from './helpers.mjs';

for (const [separateData, layout] of [[false, 'full'], [true, 'full'], [true, 'variants-only'], [true, 'new-templates'], [true, 'wild-pack']]) {
  test(`rollback preserves configured templates (separate data: ${separateData}, backup: ${layout})`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'co-rollback-template-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const data = separateData ? join(dir, 'personal') : dir;
    const g = hermeticGitRunner(dir);
    g('init', '-q', '-b', 'main');
    g('config', 'user.name', 'Fixture');
    g('config', 'user.email', 'fixture@example.invalid');
    for (const file of ['update-system.mjs', 'cv-templates.mjs', 'path-resolver.mjs', 'lib/is-main-module.mjs', 'lib/template-manifest.mjs', 'providers/_html-entities.mjs']) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(dir, file));
      g('add', '--', file);
    }
    linkRepoPackage(dir, 'js-yaml');
    const pack = layout === 'wild-pack' ? 'pack [draft]' : 'pack';
    mkdirSync(join(dir, 'templates', pack), { recursive: true });
    const selected = ['templates/cv-template.modern.html', `templates/${pack}/cover-letter-template.concise.tex`];
    const backupTemplates = layout === 'new-templates' ? [] : layout === 'variants-only' ? selected : [...selected, 'templates/cv-template.html'];
    for (const file of backupTemplates) writeFileSync(join(dir, file), 'backup version\n');
    if (backupTemplates.length) g('add', '--', 'templates');
    writeFileSync(join(dir, 'README.md'), 'backup readme\n');
    g('add', '--', 'README.md');
    g('commit', '-qm', 'backup');
    g('branch', 'backup-pre-update-1.0.0');
    writeFileSync(join(dir, 'templates/cv-template.html'), 'updated system version\n');
    writeFileSync(join(dir, 'README.md'), 'updated readme\n');
    g('add', '--', 'templates/cv-template.html', 'README.md');
    g('commit', '-qm', 'update');
    mkdirSync(join(data, 'config'), { recursive: true });
    writeFileSync(join(data, 'config/profile.yml'), 'cv:\n  template: modern\ncover_letter:\n  template: concise\n');
    for (const file of selected) {
      writeFileSync(join(dir, file), 'staged user design\n');
      if (layout !== 'new-templates') g('add', '--', file);
      writeFileSync(join(dir, file), 'newer unstaged user design\n');
    }
    writeFileSync(join(dir, 'unrelated.txt'), 'unrelated staged work\n');
    g('add', '--', 'unrelated.txt');
    const indexBefore = selected.map((file) => layout === 'new-templates' ? null : g('show', `:${file}`));
    const env = { ...hermeticGitEnv(join(dir, '.git', 'fixture-config')), CAREER_OPS_ROOT: data, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' };
    const output = execFileSync(process.execPath, [join(dir, 'update-system.mjs'), 'rollback'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    assert.match(output, /Rollback complete/);
    for (const [i, file] of selected.entries()) {
      assert.equal(readFileSync(join(dir, file), 'utf8'), 'newer unstaged user design\n', file);
      if (layout === 'new-templates') {
        assert.equal(g('ls-files', '--', file), '', `${file}: must remain untracked`);
      } else {
        assert.equal(g('show', `:${file}`), indexBefore[i], `${file}: index`);
        assert.equal(g('show', `HEAD:${file}`), 'backup version', `${file}: must not commit user work`);
      }
    }
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'backup readme\n');
    if (layout === 'full') assert.equal(readFileSync(join(dir, 'templates/cv-template.html'), 'utf8'), 'backup version\n');
    if (layout === 'new-templates') assert.equal(existsSync(join(dir, 'templates/cv-template.html')), false);
    assert.match(g('diff', '--cached', '--name-only'), /unrelated.txt/);
  });
}
