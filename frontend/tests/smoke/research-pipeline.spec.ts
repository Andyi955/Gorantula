import { expect, test } from '@playwright/test';
import { openSmokeApp, expectNoExternalNetworkRequests } from './helpers';

test('one pipeline leads to a report and approval highlights missing user input', async ({page}) => {
  await openSmokeApp(page);
  const candidate = {id:'candidate', hypothesis:'Pipeline example'};
  let started = false;
  let approved = false;
  const run = {id:'run', candidate, status:'completed', pipelineStage:'review', publicationId:'paper', request:{autoPrepare:true}, results:[{}], createdAt:'2026-09-05T00:00:00Z'};
  let paper = {id:'paper', revision:'revision', candidate, status:'draft', stale:false, evidenceStatus:'inconclusive', figures:[], audit:[], markdown:'# Evidence report', run:{interpretation:'The recorded samples differ. More evidence is needed.'}};
  await page.route('**/api/research/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await route.fulfill({status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST'}}); return; }
    let value: unknown = [];
    if (path.endsWith('/candidates')) value = [candidate];
    if (path.endsWith('/verify')) {
      expect(route.request().postDataJSON()).toEqual({mode:'agent',candidateId:'candidate',autoPrepare:true});
      started = true; value = {...run, status:'queued', pipelineStage:'checking', publicationId:undefined};
    }
    if (path.endsWith('/runs')) value = started ? [run] : [];
    if (path.endsWith('/publications/paper')) value = paper;
    if (path.endsWith('/approve')) { approved = true; expect(route.request().postDataJSON()).toMatchObject({operator:'Andrew',revision:'revision'}); paper = {...paper,status:'approved'}; value = paper; }
    await route.fulfill({json:value, headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.getByRole('button', {name:'Research',exact:true}).click();
  await page.getByRole('button', {name:'Start research pipeline'}).click();
  await expect(page.getByText('The recorded samples differ. More evidence is needed.')).toBeVisible();
  await expect(page.getByRole('button', {name:'Prepare candidate paper'})).toHaveCount(0);
  await page.getByRole('button', {name:'Approve for sharing'}).click();
  await expect(page.getByLabel('Reviewer name')).toBeFocused();
  await expect(page.getByLabel('Reviewer name')).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('alert')).toContainText('Enter your name.');
  expect(approved).toBe(false);
  await page.getByLabel('Reviewer name').fill('Andrew');
  await page.getByRole('button', {name:'Approve for sharing'}).click();
  await expect(page.getByRole('checkbox')).toBeFocused();
  expect(approved).toBe(false);
  await page.screenshot({path:'test-results/pipeline-approval-guidance.png',fullPage:true});
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name:'Approve for sharing'}).click();
  await expect(page.getByRole('button', {name:'Export to local repo folder'})).toBeEnabled();
  expect(approved).toBe(true);
  await expectNoExternalNetworkRequests(page);
});
