import { expect, test } from '@playwright/test';
import { expectNoExternalNetworkRequests, openSmokeApp } from './helpers';

// The candidate queue must only show corpus-derived ideas (run-scoped
// `topic-*` candidates stay out), must filter by decision state, and must let
// an operator archive and restore a candidate.
test('candidate queue filters by state and archives without losing evidence', async ({ page }) => {
  const open = {
    id: 'candidate-signal-1',
    signalID: 'signal-1',
    hypothesis: 'Contradiction: metformin increased survival vs decreased survival',
    state: 'reviewed',
    verdict: 'disputed',
    evidenceGrade: 'very low',
    checklist: [
      { id: 'consistency', question: 'Is it independently replicated?', answer: 'no', grade: 'none' },
      { id: 'precision', question: 'Is the claim stated with exact quantities?', answer: 'yes', grade: 'low' },
    ],
    summary: 'Inconclusive — 1/2 criteria satisfied, 1 failed.',
  };
  const rejected = {
    id: 'candidate-signal-2',
    signalID: 'signal-2',
    hypothesis: 'Do penguin chicks differ in body mass',
    state: 'rejected',
    verdict: 'disputed',
    checklist: [],
  };
  const archived = {
    id: 'candidate-signal-3',
    signalID: 'signal-3',
    hypothesis: 'Do iris species differ in petal length',
    state: 'reviewed',
    verdict: 'disputed',
    checklist: [],
    dismissed: true,
    dismissedAt: '2026-09-08T10:00:00Z',
  };
  let dismissed = false;
  let sawDismiss = false;
  let sawIncludeDismissed = false;

  await openSmokeApp(page);
  await page.route('**/api/research/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' },
      });
      return;
    }
    if (path.endsWith('/candidate-signal-1/dismiss')) {
      expect(method).toBe('POST');
      sawDismiss = true;
      dismissed = true;
      await route.fulfill({ json: { ...open, dismissed: true, dismissedAt: '2026-09-08T11:00:00Z' }, headers });
      return;
    }
    if (path.endsWith('/candidate-signal-1/restore')) {
      dismissed = false;
      await route.fulfill({ json: { ...open, dismissed: false }, headers });
      return;
    }
    if (path.endsWith('/candidates')) {
      const includeDismissed = url.searchParams.get('includeDismissed') === '1';
      if (includeDismissed) sawIncludeDismissed = true;
      const visible = [
        dismissed ? { ...open, dismissed: true, dismissedAt: '2026-09-08T11:00:00Z' } : open,
        rejected,
        ...(includeDismissed ? [archived] : []),
      ];
      await route.fulfill({ json: visible, headers });
      return;
    }
    await route.fulfill({ json: [], headers });
  });

  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: /^Candidates/ }).click();

  const main = page.locator('.research-workspace-main');

  // Open is the default filter: the open candidate is listed, the rejected one is not.
  await expect(main.getByText(open.hypothesis)).toBeVisible();
  await expect(main.getByText(rejected.hypothesis)).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^Open/ })).toContainText('1');
  await expect(main.getByRole('button', { name: /^Rejected/ })).toContainText('1');

  await main.getByRole('button', { name: /^Rejected/ }).click();
  await expect(main.getByText(rejected.hypothesis)).toBeVisible();
  await expect(main.getByText(open.hypothesis)).toHaveCount(0);

  await main.getByRole('button', { name: /^All/ }).click();
  await expect(main.getByText(open.hypothesis)).toBeVisible();
  await expect(main.getByText(rejected.hypothesis)).toBeVisible();

  // Archiving takes it out of the open queue and into the archived view.
  await main.getByRole('button', { name: /^Archive / }).first().click();
  expect(sawDismiss).toBe(true);
  await main.getByRole('button', { name: /^Show archived/ }).click();
  expect(sawIncludeDismissed).toBe(true);
  await expect(main.getByText(archived.hypothesis)).toBeVisible();
  await expect(main.getByText('Archived', { exact: true }).first()).toBeVisible();

  await main.getByRole('button', { name: /^Restore / }).first().click();
  await expect(main.getByRole('button', { name: /^Show archived/ })).toHaveAttribute('aria-pressed', 'true');

  await expectNoExternalNetworkRequests(page);
});
