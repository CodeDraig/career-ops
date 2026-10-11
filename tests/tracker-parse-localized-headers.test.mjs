import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveColumns, detectColumns, isHeaderRow, parseTrackerRow } from '../tracker-parse.mjs';

for (const [date, company, role] of [['Fecha', 'Empresa', 'Puesto'], ['Datum', 'Firma', 'Rolle'], ['Data', 'Firma', 'Rola'], ['Data', 'Empresa', 'Vaga'], ['Dato', 'Virksomhed', 'Rolle'], ['Tanggal', 'Perusahaan', 'Role']]) {
 test(`${company}/${role}: localized header is rejected`, () => {
  const header = `| # | ${date} | ${company} | Via | ${role} | Score | Status | PDF | Report |`;
  assert.equal(detectColumns([header]), null);
  assert.equal(isHeaderRow(header), false);
  assert.throws(() => resolveColumns([header]), /English header/);
 });
}
test('English headers preserve foreign-language company names and job titles', () => {
 const header = '| # | Date | Company | Via | Role | Score | Status | PDF | Report |';
 const cols = resolveColumns([header]);
 const row = parseTrackerRow('| 1 | 2026-01-01 | 株式会社 | — | 開発者 | 4/5 | Applied | — | — |', cols);
 assert.equal(row.company, '株式会社');
 assert.equal(row.role, '開発者');
});
