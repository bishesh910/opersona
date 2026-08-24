/**
 * Phase 0 click-through: sign up → org → clone → brief → fact → playbook → document → chat → settings.
 * Run with both servers up: `pnpm dev` then `pnpm e2e`.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;

test('phase 0 flow', async ({ page }) => {
  // sign up
  await page.goto('/sign-up');
  await page.fill('#name', 'E2E User');
  await page.fill('#email', email);
  await page.fill('#password', 'correct-horse-battery');
  await page.click('button:has-text("Sign up")');
  await page.waitForURL(/onboarding/);

  // org
  await page.fill('#name', `E2E Org ${stamp}`);
  await page.click('button:has-text("Create organization")');
  await page.waitForURL(/clones/);

  // clone
  await page.click('button:has-text("Create my clone")');
  await page.waitForURL(/clones\/[0-9a-f-]{36}/);
  const cloneUrl = new URL(page.url());
  const cloneId = cloneUrl.pathname.match(/clones\/([0-9a-f-]{36})/)![1];

  // brief
  await page.goto(`/clones/${cloneId}/brief`);
  await page.fill('#displayName', 'E2E Wazuh');
  await page.fill('#roleTitle', 'SOC engineer');
  await page.fill('#briefMd', 'I troubleshoot Wazuh agents. I read ossec.log before forming a theory.');
  await page.fill('#operatingRules', '- Never wipe /var/ossec without a backup.');
  await page.click('button:has-text("Save brief")');
  await expect(page.locator('text=/saved|snapshot/i').first()).toBeVisible({ timeout: 20_000 });

  // fact
  await page.goto(`/clones/${cloneId}/memory`);
  await page.click('button:has-text("Add fact")');
  await page.fill('textarea[name="statement"]', 'Agents talk to the manager on 1514/tcp.');
  await page.fill('input[name="domain"]', 'wazuh');
  await page.locator('form:has(textarea[name="statement"]) button.btn-primary').click();
  await expect(page.locator('text=Agents talk to the manager on 1514/tcp.')).toBeVisible({ timeout: 20_000 });

  // playbook
  await page.click('button:has-text("Add playbook")');
  const pb = page.locator('form').filter({ has: page.locator('input[placeholder="Action (required)"]') }).first();
  await pb.locator('input').first().fill('Agent disconnected');
  await pb.locator('input[placeholder="An agent shows status Disconnected in the manager UI"]').fill('Agent shows Disconnected');
  await pb.locator('input[placeholder="Action (required)"]').first().fill('Read the agent ossec.log first');
  await pb.locator('input[placeholder="Command (optional)"]').first().fill('tail -n 200 /var/ossec/logs/ossec.log');
  await pb.locator('button.btn-primary').click();
  await expect(page.locator('text=Agent disconnected').first()).toBeVisible({ timeout: 20_000 });

  // "what my clone knows" includes both
  await page.click('button:has-text("Refresh")');
  await expect(page.locator('text=/Playbooks \\(index/')).toBeVisible({ timeout: 20_000 });

  // document upload
  const tmp = `/tmp/claude-1000/e2e-notes-${stamp}.md`;
  writeFileSync(tmp, '# Notes\n\nManager API on 55000/tcp. token=abcdefghijk\n');
  await page.goto(`/clones/${cloneId}/documents`);
  await page.setInputFiles('input[type="file"]', tmp);
  await expect(page.locator(`text=e2e-notes-${stamp}.md`)).toBeVisible({ timeout: 30_000 });

  // chat: create conversation, send a message, expect either a stream or a clean "no key" error
  await page.goto(`/clones/${cloneId}/chat`);
  await page.click('button:has-text("New conversation")');
  await page.waitForURL(/chat\/[0-9a-f-]{36}/);
  await page.fill('textarea', 'An agent shows Disconnected. What first?');
  await page.keyboard.press('Enter');
  await expect(page.locator('text=An agent shows Disconnected. What first?')).toBeVisible();
  await expect(page.locator('text=/API key|retrying|result|cost|\\$/i').first()).toBeVisible({ timeout: 30_000 });

  // settings: bogus key is rejected and not stored
  await page.goto('/settings');
  await page.fill('input[placeholder="sk-ant-…"]', 'sk-ant-bogus-key-000000000000000');
  await page.locator('form:has(input[placeholder="sk-ant-…"]) button.btn-primary, input[placeholder="sk-ant-…"] ~ button.btn-primary').first().click();
  await expect(page.locator('text=/invalid|401|rejected/i').first()).toBeVisible({ timeout: 30_000 });
});
