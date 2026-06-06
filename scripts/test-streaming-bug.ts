import { chromium } from 'playwright';

const BASE = 'https://aichat.asheblog.org';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Collect console logs
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  try {
    // Step 1: Login first
    console.log('=== Step 1: Login ===');
    await page.goto(BASE + '/auth', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    console.log('URL:', page.url());

    // Try to find login form
    let usernameInput = page.locator('input[name="username"], input[type="email"], input[placeholder*="用户"], input[placeholder*="账号"], input[placeholder*="邮箱"]').first();
    let passwordInput = page.locator('input[type="password"]').first();

    if (!(await usernameInput.isVisible().catch(() => false))) {
      // Maybe we need to click a login link first
      console.log('Login form not visible, looking for login link...');
      const loginLink = page.locator('a[href*="auth"], a[href*="login"], button:has-text("登录"), a:has-text("登录")').first();
      if (await loginLink.isVisible().catch(() => false)) {
        await loginLink.click();
        await page.waitForTimeout(2000);
      }
      usernameInput = page.locator('input[name="username"], input[type="email"], input[placeholder*="用户"], input[placeholder*="账号"], input[placeholder*="邮箱"]').first();
      passwordInput = page.locator('input[type="password"]').first();
    }

    const userVisible = await usernameInput.isVisible().catch(() => false);
    const passVisible = await passwordInput.isVisible().catch(() => false);
    console.log('Username visible:', userVisible, 'Password visible:', passVisible);

    if (userVisible && passVisible) {
      await usernameInput.fill('Pandoratobe');
      await passwordInput.fill('a262015622');
      
      const submitBtn = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("登 录")').first();
      await submitBtn.click();
      console.log('Submitted login');
      await page.waitForTimeout(3000);
      console.log('After login URL:', page.url());
    }

    // Step 2: Go to main and start a new chat
    console.log('\n=== Step 2: Start new chat ===');
    await page.goto(BASE + '/main', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    console.log('URL:', page.url());

    // Look for "新建聊天" or just use the textarea directly
    const textarea = page.locator('textarea').first();
    let textareaVisible = await textarea.isVisible().catch(() => false);
    console.log('Textarea visible:', textareaVisible);

    if (!textareaVisible) {
      // Maybe session picker is showing, try clicking new chat
      const newChat = page.locator('button:has-text("新建"), button:has-text("新对话"), a:has-text("新建")').first();
      if (await newChat.isVisible().catch(() => false)) {
        console.log('Clicking new chat...');
        await newChat.click();
        await page.waitForTimeout(2000);
        textareaVisible = await textarea.isVisible().catch(() => false);
        console.log('Textarea visible after new chat:', textareaVisible);
      }
    }

    if (!textareaVisible) {
      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/aichat-login-debug.png', fullPage: true });
      console.log('Screenshot saved. Body text:');
      const body = await page.textContent('body');
      console.log(body?.slice(0, 600));
      return;
    }

    // Step 3: Send a message
    console.log('\n=== Step 3: Send message ===');
    await textarea.click();
    await textarea.fill('用一句话介绍人工智能');
    await page.waitForTimeout(300);

    const sendBtn = page.locator('button[aria-label="发送"]').first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
      console.log('Clicked send');
    } else {
      await textarea.press('Enter');
      console.log('Pressed Enter');
    }

    // Wait for streaming to start
    await page.waitForTimeout(2000);
    const stopBtn = page.locator('button[aria-label="停止生成"]').first();
    const streamingStarted = await stopBtn.isVisible().catch(() => false);
    console.log('Streaming started:', streamingStarted);

    // Get current URL (with session ID)
    const sessionUrl = page.url();
    console.log('Session URL:', sessionUrl);

    // Step 4: REFRESH mid-stream
    console.log('\n=== Step 4: REFRESH ===');
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    console.log('URL after refresh:', page.url());

    // Step 5: Monitor
    console.log('\n=== Step 5: Monitor ===');
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(3000);

      const stopV = await page.locator('button[aria-label="停止生成"]').first().isVisible().catch(() => false);
      const sendV = await page.locator('button[aria-label="发送"]').first().isVisible().catch(() => false);
      const bodyText = await page.textContent('body');
      const hasContent = (bodyText?.match(/人工智能|AI|智能/g) || []).length;

      console.log(`  [+${(i+1)*3}s] stop:${stopV} send:${sendV} aiMentions:${hasContent}`);

      if (sendV && !stopV) {
        console.log('  ✅ Completed');
        break;
      }
    }

    // Final check
    console.log('\n=== Final State ===');
    const fStop = await page.locator('button[aria-label="停止生成"]').first().isVisible().catch(() => false);
    const fSend = await page.locator('button[aria-label="发送"]').first().isVisible().catch(() => false);
    console.log('stop:', fStop, 'send:', fSend);

    if (fStop) {
      console.log('\n❌ BUG REPRODUCED: isStreaming stuck');
      
      // Click stop
      console.log('Clicking stop...');
      await page.locator('button[aria-label="停止生成"]').first().click();
      await page.waitForTimeout(2000);
      const s1 = await page.locator('button[aria-label="停止生成"]').first().isVisible().catch(() => false);
      console.log('After 1st stop click - stop visible:', s1);
      
      if (s1) {
        console.log('Clicking stop AGAIN...');
        await page.locator('button[aria-label="停止生成"]').first().click();
        await page.waitForTimeout(2000);
        const s2 = await page.locator('button[aria-label="停止生成"]').first().isVisible().catch(() => false);
        console.log('After 2nd stop click - stop visible:', s2);
      }

      // Check content
      const bodyText = await page.textContent('body');
      console.log('Content length:', bodyText?.length);
    } else {
      console.log('\n✅ OK');
    }

    // Log API-related console messages
    const apiLogs = consoleLogs.filter(l => 
      l.includes('/api/') || l.includes('stream') || l.includes('snapshot') || 
      l.includes('error') || l.includes('Error') || l.includes('fail')
    );
    console.log('\n=== API Console Logs ===');
    apiLogs.slice(-30).forEach(l => console.log(l));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
