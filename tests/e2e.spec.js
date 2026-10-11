import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// Helper to log in a user through the UI
async function loginUser(page, username, password = 'Password123!') {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Check if already logged in as this user
  const userBadge = page.locator(`header:has-text("${username}")`);
  if (await userBadge.isVisible().catch(() => false)) {
    return;
  }

  // Click Sign In button in navbar
  await page.click('#nav-login-btn');
  await page.waitForSelector('#auth-username', { state: 'visible' });

  // Fill credentials
  await page.fill('#auth-username', username);
  await page.fill('#auth-password', password);

  // Submit and wait for navbar to reflect logged-in user
  await page.click('#auth-submit-btn');
  await expect(page.locator(`header:has-text("${username}")`)).toBeVisible({ timeout: 15000 });
}

test.describe('Step 3: End-to-End Bidding & Real-Time Flows', () => {

  test.beforeEach(() => {
    // Reset test state before each test for total test isolation
    execSync('pipenv run python tests/setup_test_data.py', { stdio: 'inherit' });
  });

  test('1. Valid bid updates the UI for the bidder and broadcasts live to a spectator', async ({ browser }) => {
    test.setTimeout(60000);

    const bidderContext = await browser.newContext();
    const spectatorContext = await browser.newContext();

    const bidderPage = await bidderContext.newPage();
    const spectatorPage = await spectatorContext.newPage();

    try {
      // 1. Bidder logs in as bidder_1
      await loginUser(bidderPage, 'bidder_1');

      // 2. Both open Item 17 ("Working")
      await bidderPage.goto('/auction/17');
      await spectatorPage.goto('/auction/17');

      // 3. Await live WebSocket connection on both
      await expect(bidderPage.locator('text=Live Stream Connected')).toBeVisible({ timeout: 15000 });
      await expect(spectatorPage.locator('text=Live Stream Connected')).toBeVisible({ timeout: 15000 });

      // 4. Read current price
      const priceText = await bidderPage.locator('#current-bid').innerText();
      const currentPrice = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 26000;
      const targetBid = currentPrice + 2000;
      const targetFormatted = targetBid.toLocaleString('en-IN');

      // 5. Bidder places valid bid
      await bidderPage.fill('#bid-amount', String(targetBid));
      await bidderPage.click('#place-bid-btn');

      // 6. Verify bidder UI updates
      await expect(bidderPage.locator('#current-bid')).toContainText(targetFormatted, { timeout: 10000 });

      // 7. Verify spectator page receives real-time WebSocket push and updates WITHOUT REFRESHING
      await expect(spectatorPage.locator('.current-bid')).toContainText(targetFormatted, { timeout: 10000 });
      await expect(spectatorPage.locator('text=Live Bid Stream')).toBeVisible();
    } finally {
      await bidderContext.close();
      await spectatorContext.close();
    }
  });

  test('2. Underbid shows the correct error message', async ({ page }) => {
    test.setTimeout(45000);

    // 1. Login as bidder_2
    await loginUser(page, 'bidder_2');

    // 2. Open Item 17
    await page.goto('/auction/17');
    await expect(page.locator('text=Live Stream Connected')).toBeVisible({ timeout: 15000 });

    // 3. Enter a very low bid below the minimum increment
    await page.fill('#bid-amount', '100');
    await page.click('#place-bid-btn');

    // 4. Verify input error validation displays on screen
    const errorEl = page.locator('#input-error');
    await expect(errorEl).toBeVisible({ timeout: 5000 });
    await expect(errorEl).toContainText(/Bid must be at least ₹/);
    await expect(errorEl).toContainText(/minimum increment/);
  });

  test('3. Seller is blocked from bidding on their own item', async ({ page }) => {
    test.setTimeout(45000);

    // Item 15 seller is set to bidder_25
    await loginUser(page, 'bidder_25');

    // Open Item 15
    await page.goto('/auction/15');
    await expect(page.locator('text=Live Stream Connected')).toBeVisible({ timeout: 15000 });

    // Verify Shill Bidding protection banner is visible
    await expect(page.locator('text=Shill bidding is prohibited')).toBeVisible({ timeout: 5000 });

    // Verify place bid button is disabled and warns the seller
    const bidBtn = page.locator('#place-bid-btn');
    await expect(bidBtn).toBeDisabled();
    await expect(bidBtn).toContainText('Seller Cannot Bid on Own Item');
  });

  test('4. A bid in the final 60 seconds triggers the anti-snipe extension message', async ({ page }) => {
    test.setTimeout(60000);

    // 1. Login as bidder_4
    await loginUser(page, 'bidder_4');

    // 2. Set Item 14 to expire in 45 seconds right before opening the room
    execSync('pipenv run python tests/setup_test_data.py --anti-snipe', { stdio: 'inherit' });

    // 3. Open Item 14
    await page.goto('/auction/14');
    await expect(page.locator('text=Live Stream Connected')).toBeVisible({ timeout: 15000 });

    // 4. Read current price and compute valid bid above min increment (increment is 5,000 for > 1L)
    const priceText = await page.locator('#current-bid').innerText();
    const currentPrice = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 119000;
    const targetBid = currentPrice + 10000;

    // 5. Place bid in the final 60 seconds
    await page.fill('#bid-amount', String(targetBid));
    await page.click('#place-bid-btn');

    // 6. Verify Anti-Snipe notice is triggered and visible
    const notice = page.locator('#anti-snipe-notice');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText('Anti-Snipe: Auction extended by 60 seconds');
  });

});
