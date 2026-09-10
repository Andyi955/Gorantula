import { expect, test } from '@playwright/test';
import { expectNoExternalNetworkRequests, openSmokeApp } from './helpers';

// The Research tab opens on an overview that explains the area in plain
// language, shows the state of the engine, and offers one clear next step.
test('research opens on an overview that explains the area and routes onward', async ({ page }) => {
  await openSmokeApp(page);
  await page.route('**/api/research/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST',
        },
      });
      return;
    }
    let value: unknown = [];
    if (path.endsWith('/discoveries')) {
      value = [{
        id: 'discovery-1',
        theme: 'ecology',
        status: 'completed',
        questions: [{ id: 'q1', status: 'completed' }, { id: 'q2', status: 'rejected' }],
        workedCount: 1,
        rejectedCount: 1,
      }];
    }
    if (path.endsWith('/publications')) value = [{ id: 'pub-1' }];
    await route.fulfill({ json: value, headers: { 'Access-Control-Allow-Origin': '*' } });
  });

  await page.getByRole('button', { name: 'Research', exact: true }).click();

  const overview = page.getByRole('region', { name: 'Research overview' });
  await expect(overview).toBeVisible();
  await expect(overview).toContainText('Ask a question');
  await expect(overview).toContainText('Produced a result');
  await expect(overview).toContainText('What the words mean');
  await expect(overview).toContainText('invented nothing');

  // The plain-language numbers come from the mocked discovery runs.
  await expect(overview.locator('.research-overview__stat').nth(1)).toContainText('1');
  await expect(overview.locator('.research-overview__stat').nth(2)).toContainText('1');

  // The tiles navigate rather than being decoration.
  await overview.locator('.research-overview__stat').nth(1).click();
  await expect(page.getByRole('region', { name: 'Research results' })).toBeVisible();

  await expectNoExternalNetworkRequests(page);
});

// One press runs the whole chain and then hands the reader to the results,
// which is the whole point of the overview: no research knowledge required.
test('one press runs a discovery and lands on the results', async ({ page }) => {
  await openSmokeApp(page);
  let started = false;
  await page.route('**/api/research/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST',
        },
      });
      return;
    }
    let value: unknown = [];
    if (path.endsWith('/discover')) {
      expect(JSON.parse(request.postData() || '{}')).toMatchObject({ count: 2 });
      started = true;
      value = { id: 'run-1', theme: '', status: 'running', workedCount: 0, rejectedCount: 0, questions: [] };
    }
    if (path.endsWith('/discoveries/run-1')) {
      value = {
        id: 'run-1',
        theme: '',
        status: 'completed',
        workedCount: 1,
        rejectedCount: 1,
        questions: [
          { id: 'q1', question: 'Does X correlate with Y', status: 'completed', runId: 'vr-1', publicationId: 'pub-1' },
          { id: 'q2', question: 'Is A higher than B', status: 'rejected' },
        ],
      };
    }
    if (path.endsWith('/discoveries')) {
      value = started ? [{
        id: 'run-1', theme: '', status: 'completed', createdAt: '2026-09-08T10:00:00Z',
        workedCount: 1, rejectedCount: 1,
        questions: [{ id: 'q1', question: 'Does X correlate with Y', status: 'completed', runId: 'vr-1', publicationId: 'pub-1' }],
      }] : [];
    }
    if (path.endsWith('/publications')) value = [{ id: 'pub-1' }];
    if (path.endsWith('/runs/vr-1')) value = { id: 'vr-1', results: [{ status: 'completed', summary: 'Descriptive pearsonR = 0.61; no inferential uncertainty computed.' }] };
    await route.fulfill({ json: value, headers: { 'Access-Control-Allow-Origin': '*' } });
  });

  await page.getByRole('button', { name: 'Research', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Research overview' });
  await overview.getByRole('button', { name: 'Run a discovery for me' }).click();

  const status = overview.getByRole('status');
  await expect(status).toContainText('Working');
  await expect(status).toContainText('Done');
  await overview.getByRole('button', { name: 'See the results' }).click();

  const results = page.getByRole('region', { name: 'Research results' });
  await expect(results).toBeVisible();
  await expect(results.getByText('Does X correlate with Y')).toBeVisible();
  await expect(results.getByText('Descriptive pearsonR = 0.61')).toBeVisible();
  await expect(results.getByRole('button', { name: 'Read report' })).toBeVisible();
  await expect(results.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', /publications\/pub-1\/pdf$/);
  await expect(results.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', /download=1$/);

  await expectNoExternalNetworkRequests(page);
});
