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

  // The primary action leads somewhere useful rather than dead-ending.
  await overview.getByRole('button', { name: 'Discover something new' }).click();
  await expect(page.getByRole('button', { name: 'Run discovery' })).toBeVisible();

  await expectNoExternalNetworkRequests(page);
});
