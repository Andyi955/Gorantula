import { expect, test } from '@playwright/test';
import { openSmokeApp, expectNoExternalNetworkRequests } from './helpers';

test('publication requires explicit revision review before local export', async ({ page }) => {
  await openSmokeApp(page);
  const candidate = { id: 'candidate', hypothesis: 'Publication smoke fixture', state: 'reviewed' };
  let paper = { id: 'draft', candidate, revision: 'revision', status: 'draft', stale: false, markdown: '# Candidate paper: a descriptive comparison\n\n## Abstract\n\nThis evidence report describes the recorded sample. Evidential status: **inconclusive**.\n\n## Background\n\nHypothesis (not established): compare the measured values in two recorded groups.\n\n- Source claim [fixture-1]: Measurements are observations from the selected dataset.\n- Source claim [fixture-2]: The sample does not establish a causal relationship or a new discovery.\n\n## Findings\n\nInconclusive synthetic result.', evidenceStatus: 'inconclusive', figures: [], audit: [], exportPath: '' };
  let prepared = false;
  let approved = false;
  await page.route('**/api/research/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' } }); return; }
    let value: unknown = [];
    if (path.endsWith('/candidates')) value = [candidate];
    if (path.endsWith('/runs')) value = [{ id: 'run', candidate, status: 'completed', results: [{}] }];
    if (path.endsWith('/publications')) {
      if (route.request().method() === 'POST') { expect(route.request().postDataJSON()).toEqual({ runId: 'run' }); prepared = true; value = paper; }
      else value = prepared ? [paper] : [];
    }
    if (path.endsWith('/approve')) { expect(route.request().postDataJSON()).toMatchObject({ revision: 'revision', operator: 'Andrew', reason: 'Reviewed evidence' }); approved = true; paper = { ...paper, status: 'approved' }; value = paper; }
    if (path.endsWith('/export')) { expect(approved).toBe(true); paper = { ...paper, status: 'exported', exportPath: 'research-output/fixture' }; value = paper; }
    await route.fulfill({ json: value, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByLabel('Finished verification').selectOption('run');
  await page.getByRole('button', { name: 'Prepare candidate paper' }).click();
  await page.getByText('Read full report and sources', {exact: true}).click();
  await expect(page.getByLabel('Candidate paper')).toContainText('Inconclusive synthetic result');
  await expect(page.getByRole('button', { name: 'Export to local repo folder' })).toHaveCount(0);
  await expect(page.getByLabel('Candidate paper')).toHaveCSS('font-size', '16px');
  await page.getByLabel('Candidate paper').screenshot({ path: 'test-results/publication-reading.png' });
  await page.getByLabel('Reviewer name').fill('Andrew');
  await page.getByText('More sharing options', {exact: true}).click();
  await page.getByLabel('Review notes').fill('Reviewed evidence');
  await page.getByRole('button', { name: 'Approve for sharing' }).click();
  await expect(page.getByRole('checkbox')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('Tick the sharing checkbox.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve for sharing' }).click();
  await expect(page.getByRole('button', { name: 'Export to local repo folder' })).toBeEnabled();
  await page.getByRole('button', { name: 'Export to local repo folder' }).click();
  await expect(page.getByText('Export folder: research-output/fixture')).toBeVisible();
  await expectNoExternalNetworkRequests(page);
  await page.screenshot({ path: "test-results/publication-console.png", fullPage: true });
});
