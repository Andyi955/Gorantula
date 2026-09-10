import { expect, test } from '@playwright/test';
import { expectNoExternalNetworkRequests, openSmokeApp } from './helpers';

// The discovery dashboard must let an operator archive (dismiss), restore and
// permanently delete a discovery, and must open a discovery report in-app
// instead of navigating to the raw JSON endpoint.
test('discoveries can be archived, restored, deleted and read in-app', async ({ page }) => {
  const run = {
    id: 'discovery-1',
    theme: 'ecology',
    status: 'completed',
    createdAt: '2026-09-07T10:00:00Z',
    completedAt: '2026-09-07T10:04:00Z',
    dismissed: false,
    questions: [
      {
        id: 'q-worked',
        question: 'Does predator abundance negatively correlate with prey population size',
        status: 'completed',
        hasResult: true,
        resultsCount: 1,
        publicationId: 'pub-1',
        hypothesis: 'Predator counts fall as prey counts rise across the sampled sections.',
        interpretation: 'A negative association was recorded between the two measured columns.',
      },
      {
        id: 'q-nodata',
        question: 'Do mitigation actions outnumber adaptation actions in the Hamburg dataset',
        status: 'rejected',
        hasResult: false,
        resultsCount: 0,
        error: 'retrieved papers did not address the topic; no finding was proposed',
      },
    ],
    workedCount: 1,
    rejectedCount: 1,
  };

  const publication = {
    id: 'pub-1',
    revision: 'rev-1',
    status: 'draft',
    stale: false,
    markdown: '# Candidate paper: predator and prey counts\n\n## Findings\n\nA negative association was recorded.',
    evidenceStatus: 'inconclusive',
    figures: [],
    audit: [],
    exportPath: '',
    candidate: { id: 'cand-1', hypothesis: 'Predator abundance versus prey population size' },
    run: {
      interpretation: 'The recorded dataset shows a negative association between the two measured columns.',
      results: [{ status: 'completed', summary: 'Pearson correlation computed on the recorded columns.' }],
      datasetActions: [],
      studyReviews: [],
      reportReviews: [],
    },
    papers: [{}, {}],
    claims: [{}, {}],
    relations: [],
  };

  let dismissed = false;
  let deleted = false;
  let sawDismiss = false;
  let sawRestore = false;

  // Registered after openSmokeApp: its catch-all network guard is added last by
  // that helper and Playwright runs the most recently added handler first.
  await openSmokeApp(page);
  await page.route('**/api/research/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        },
      });
      return;
    }
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (path.endsWith('/discovery-1/dismiss')) {
      expect(method).toBe('POST');
      expect(request.postDataJSON()).toEqual({});
      sawDismiss = true;
      dismissed = true;
      await route.fulfill({ json: { ...run, dismissed: true, dismissedAt: '2026-09-08T10:00:00Z' }, headers });
      return;
    }
    if (path.endsWith('/discovery-1/restore')) {
      expect(method).toBe('POST');
      sawRestore = true;
      dismissed = false;
      await route.fulfill({ json: { ...run, dismissed: false }, headers });
      return;
    }
    if (path.endsWith('/discovery-1') && method === 'DELETE') {
      deleted = true;
      await route.fulfill({ json: { deleted: true }, headers });
      return;
    }
    if (path.endsWith('/discoveries')) {
      const includeDismissed = url.searchParams.get('includeDismissed') === '1';
      const visible = deleted ? [] : dismissed && !includeDismissed ? [] : [{ ...run, dismissed }];
      await route.fulfill({ json: visible, headers });
      return;
    }
    if (path.endsWith('/publications/pub-1')) {
      await route.fulfill({ json: publication, headers });
      return;
    }
    await route.fulfill({ json: [], headers });
  });

  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: 'Discoveries', exact: true }).click();

  const card = page.locator('article').filter({ hasText: 'ecology' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('1 worked')).toBeVisible();
  await expect(card.getByText('1 no-data')).toBeVisible();
  await expect(card.getByText('retrieved papers did not address the topic')).toBeVisible();
  await expect(card.getByText('1 calculation')).toBeVisible();

  // A discovery report opens in-app, never as the raw JSON endpoint.
  await card.getByRole('button', { name: 'Open report' }).click();
  const dialog = page.getByRole('dialog', { name: /Research report/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('What we found')).toBeVisible();
  await expect(dialog.getByText('The recorded dataset shows a negative association')).toBeVisible();
  // Read-only: no sharing decision is offered from a discovery report.
  await expect(dialog.getByRole('button', { name: 'Approve for sharing' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Export to local repo folder' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Open report' })).toBeFocused();

  // Archive hides it from the active list without deleting it.
  await card.getByRole('button', { name: 'Archive' }).click();
  expect(sawDismiss).toBe(true);
  await expect(page.getByText('No discoveries yet. Run one above.')).toBeVisible();

  await page.getByRole('button', { name: 'Show archived' }).click();
  const archived = page.locator('article').filter({ hasText: 'ecology' }).first();
  // exact: the "Archive" + "Delete" buttons concatenate to "ArchiveDelete",
  // which a non-exact substring match would treat as containing "archived".
  await expect(archived.getByText('Archived', { exact: true })).toBeVisible();

  await archived.getByRole('button', { name: 'Restore' }).click();
  expect(sawRestore).toBe(true);
  await expect(page.locator('article').filter({ hasText: 'ecology' }).first().getByText('Archived', { exact: true })).toHaveCount(0);

  // Deleting is destructive, so it asks first and only then sends the request.
  await page.getByRole('button', { name: /delete the ecology discovery permanently/i }).click();
  await expect(page.getByText('Delete permanently?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(deleted).toBe(false);
  await expect(card.getByRole('button', { name: 'Archive' })).toBeVisible();

  await page.getByRole('button', { name: /delete the ecology discovery permanently/i }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  expect(deleted).toBe(true);
  await expect(page.getByText('Nothing archived yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Active' }).click();
  await expect(page.getByText('No discoveries yet. Run one above.')).toBeVisible();

  await expectNoExternalNetworkRequests(page);
});
