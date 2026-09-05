import { expect, test } from '@playwright/test';
import { openSmokeApp, expectNoExternalNetworkRequests } from './helpers';

test('research verification imports data, submits typed calls, and replays results', async ({ page }) => {
  await openSmokeApp(page);
  const candidate = { id: 'candidate', hypothesis: 'Synthetic group comparison', state: 'reviewed' };
  const dataset = { id: 'dataset', name: 'Synthetic data', source: 'Synthetic smoke fixture', columns: ['group', 'value'], rows: 4, digest: 'input-digest' };
  const run = { id: 'run', candidate, dataset, status: 'completed', createdAt: '2026-09-05T00:00:00Z', toolVersion: 'native-v1', runtime: 'Go', implementationDigest: 'tool-digest', results: [{ call: { tool: 'stats-reanalysis', statement: 'Compare means' }, status: 'completed', verdict: 'inconclusive', summary: 'Mean difference: 2; permutation p = 0.33.', assumptions: ['Independent observations'], outputDigest: 'output-digest' }] };
  let saved = false;
  let started = false;
  let replayed = false;
  await page.route('**/api/research/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' } }); return; }
    let value: unknown = [];
    if (path.endsWith('/candidates')) value = [candidate];
    if (path.endsWith('/datasets')) {
      if (route.request().method() === 'POST') { saved = true; value = dataset; }
      else value = saved ? [dataset] : [];
    }
    if (path.endsWith('/datasets/tools')) { expect(['dataset-validate', 'paper-complex-table']).toContain(route.request().postDataJSON().call.tool); value = {sessionId: 'prep', dataset, result: {summary: 'Validation complete.', warnings: ['Review observation independence'], counts: {duplicateRows: 0}}}; }
    if (path.endsWith('/verify')) {
      const body = route.request().postDataJSON();
      if (body.mode === 'replay') { expect(body.replayOf).toBe('run'); replayed = true; }
      else { expect(body.calls[0]).toMatchObject({ tool: 'stats-reanalysis', groupColumn: 'group', valueColumn: 'value' }); started = true; }
      value = run;
    }
    if (path.endsWith('/runs')) value = started ? [{ ...run, ...(replayed ? { replayMatches: true } : {}) }] : [];
    if (path.endsWith('/inspect')) value = {summary: 'Known fixture: no missing values.', columns: [{name: 'value', numeric: 4, missing: 0, text: 0, min: 1, max: 4}], sample: [['a', '1']]};
    if (path.endsWith('/runs/run')) value = run;
    await route.fulfill({ json: value, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: 'Verification', exact: true }).click();
  await page.getByRole('button', {name: 'Load known-answer example'}).click();
  await expect(page.getByLabel('CSV contents', {exact: true})).toHaveValue('group,value\na,1\na,3\nb,9\nb,11\n');
  await page.getByLabel('Dataset name', { exact: true }).fill('Synthetic data');
  await page.getByLabel('Provenance (source and relevance)', { exact: true }).fill('Synthetic smoke fixture');
  await page.getByLabel('CSV contents', { exact: true }).fill('group,value\na,1\na,2\nb,3\nb,4');
  await page.getByRole('button', { name: 'Save dataset snapshot' }).click();
  await expect(page.getByText('Source: Synthetic smoke fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', {name: 'Inspect CSV'}).click();
  await expect(page.getByText('Known fixture: no missing values.')).toBeVisible();
  await page.getByLabel('Run mode', { exact: true }).selectOption('manual');
  await page.getByLabel('Group column', { exact: true }).selectOption('group');
  await page.getByLabel('Numeric value column', { exact: true }).selectOption('value');
  await page.getByLabel('Statement being tested', { exact: true }).fill('Compare means');
  await page.getByLabel('Why this method and dataset?', { exact: true }).fill('Independent observations');
  await page.getByRole('button', { name: 'Run verification', exact: true }).click();
  await expect(page.getByText('Hypothesis verdict: inconclusive')).toBeVisible();
  await page.getByRole('button', { name: 'Replay without a model' }).click();
  await expect(page.getByText('Replay matches saved output digests.')).toBeVisible();
  await page.getByText('Research data tools', {exact: true}).click();
  await page.getByRole('button', {name: 'Run data tool', exact: true}).click();
  await expect(page.getByText('Review observation independence')).toBeVisible();
  await expect(page.getByRole('link', {name: 'Download preparation evidence'})).toBeVisible();
  await page.getByLabel('Data tool', {exact:true}).selectOption('paper-complex-table');
  await page.getByLabel('Paper or observed supplement URL', {exact:true}).fill('https://example.org/paper.pdf');
  await page.getByLabel('Header rows', {exact:true}).fill('2');
  await page.getByLabel('Column boundaries (% from left)', {exact:true}).fill('30, 60');
  await page.getByLabel('Preparation rationale', {exact:true}).fill('Review stacked headers');
  await page.getByRole('button', {name:'Run data tool',exact:true}).click();
  await expect(page.getByText('Validation complete.', {exact:true})).toBeVisible();
  await page.screenshot({path: test.info().outputPath('research-tools.png'), fullPage: true});
  expectNoExternalNetworkRequests(page);
});
