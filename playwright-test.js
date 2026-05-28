/**
 * Playwright test: Cold Start emotion check flow
 * Tests all 4 stages of the emotion check redesign:
 *  1. Three forward prompts: reason → fear → meaning
 *  2. Review screen showing all three answers
 *  3. Three backwards reframe questions (meaning → fear → reason)
 *  4. Closing screen: "You don't need to resolve all of this right now."
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = 'C:\\Users\\yu2511zh\\coldstart\\test-screenshots';
const APP_URL = 'file:///C:/Users/yu2511zh/coldstart/index.html';

// Test answers
const FORWARD_ANSWERS = {
  reason: 'I feel overwhelmed by the scope of the task',
  fear:   'I might fail and let everyone down',
  meaning: 'It means I am not capable enough'
};

const REFRAME_ANSWERS = [
  'Maybe this belief is not entirely accurate',
  'I have faced hard times before and survived',
  'This signals the work matters, not that I should avoid it'
];

let screenshotIndex = 0;

async function screenshot(page, name) {
  screenshotIndex++;
  const filename = path.join(SCREENSHOT_DIR, `${String(screenshotIndex).padStart(2,'0')}-${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`  Screenshot: ${filename}`);
  return filename;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  // Ensure screenshot directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  const results = [];
  let passed = 0;
  let failed = 0;

  function log(msg) { console.log(msg); }
  function pass(msg) { passed++; results.push({ status: 'PASS', msg }); console.log(`PASS: ${msg}`); }
  function fail(msg, err) { failed++; results.push({ status: 'FAIL', msg, err: String(err) }); console.error(`FAIL: ${msg} — ${err}`); }

  try {
    // ── 0. Open app ───────────────────────────────────────────────────────────
    log('\n=== Opening app ===');
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    // Inject a pre-existing project into localStorage so we skip setup
    await page.evaluate(() => {
      const state = {
        githubPAT: '',
        projects: [{
          id: 'test-project-id-001',
          name: 'Test Project',
          description: 'A test project for Playwright',
          githubUrl: '',
          localPath: '',
          tasks: []
        }],
        sessions: []
      };
      localStorage.setItem('coldstart', JSON.stringify(state));
    });

    // Reload so the app picks up the injected localStorage
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);

    await screenshot(page, 'choice-screen');

    // Verify we're on the choice screen (not setup)
    const choiceScreen = await page.locator('#screen-choice.active').count();
    assert(choiceScreen > 0, 'Choice screen is active after localStorage injection');
    pass('Loaded choice screen with pre-seeded project');

    // ── 1. Click "Skip to today's focus" ─────────────────────────────────────
    log('\n=== Navigating to direction screen ===');
    await page.click('#choice-skip');
    await page.waitForTimeout(300);
    await screenshot(page, 'direction-screen');

    const dirScreen = await page.locator('#screen-direction.active').count();
    assert(dirScreen > 0, 'Direction screen is active');
    pass('Navigated to direction screen');

    // ── 2. Fill in direction screen ───────────────────────────────────────────
    log('\n=== Filling direction screen ===');

    // Step 1: main focus
    await page.fill('#dir-focus', 'Build the emotion check flow');
    await page.click('#dir-s1-next');
    await page.waitForTimeout(200);

    // Step 2: tasks
    await page.fill('#dir-tasks', 'Write forward prompts, review screen, reframe questions');
    await page.click('#dir-s2-next');
    await page.waitForTimeout(200);

    // Step 3: small step
    await page.fill('#dir-step', 'Open the file and read the first function');
    await page.click('#dir-s3-next');
    await page.waitForTimeout(400);
    await screenshot(page, 'emotion-gate');

    const emotionScreen = await page.locator('#screen-emotion.active').count();
    assert(emotionScreen > 0, 'Emotion check screen is active');

    const gateVisible = await page.locator('#emotion-gate').isVisible();
    assert(gateVisible, 'Emotion gate is visible');
    pass('Reached emotion check screen');

    // ── 3. Click "Yes, let's look at it" ────────────────────────────────────
    log('\n=== Clicking "Yes, let\'s look at it" ===');
    await page.click('#emotion-yes');
    await page.waitForTimeout(300);
    await screenshot(page, 'forward-prompt-1-reason');

    const promptsVisible = await page.locator('#emotion-prompts').isVisible();
    assert(promptsVisible, 'Forward prompts section is visible after clicking Yes');
    pass('Forward prompts section appeared');

    // ── 4. Forward prompt 1: reason ──────────────────────────────────────────
    log('\n=== Forward prompt 1: reason ===');
    const prompt1Label = await page.locator('#emotion-prompts label').textContent();
    assert(
      prompt1Label.includes("What's making you want to put this off right now?"),
      'First forward prompt asks about the reason'
    );

    await page.fill('#emotion-input', FORWARD_ANSWERS.reason);
    await screenshot(page, 'forward-prompt-1-filled');
    await page.click('#emotion-prompt-next');
    await page.waitForTimeout(300);
    pass('Filled and submitted forward prompt 1 (reason)');

    // ── 5. Forward prompt 2: fear ─────────────────────────────────────────────
    log('\n=== Forward prompt 2: fear ===');
    await screenshot(page, 'forward-prompt-2-fear');
    const prompt2Label = await page.locator('#emotion-prompts label').textContent();
    assert(
      prompt2Label.includes("what are you afraid might happen"),
      'Second forward prompt asks about fear'
    );

    await page.fill('#emotion-input', FORWARD_ANSWERS.fear);
    await screenshot(page, 'forward-prompt-2-filled');
    await page.click('#emotion-prompt-next');
    await page.waitForTimeout(300);
    pass('Filled and submitted forward prompt 2 (fear)');

    // ── 6. Forward prompt 3: meaning ──────────────────────────────────────────
    log('\n=== Forward prompt 3: meaning ===');
    await screenshot(page, 'forward-prompt-3-meaning');
    const prompt3Label = await page.locator('#emotion-prompts label').textContent();
    assert(
      prompt3Label.includes("what would it mean about you"),
      'Third forward prompt asks about meaning'
    );

    await page.fill('#emotion-input', FORWARD_ANSWERS.meaning);
    await screenshot(page, 'forward-prompt-3-filled');
    await page.click('#emotion-prompt-next');
    await page.waitForTimeout(400);

    pass('Filled and submitted forward prompt 3 (meaning)');

    // ── 7. Review screen ──────────────────────────────────────────────────────
    log('\n=== Review screen ===');
    await screenshot(page, 'review-screen');

    const reviewVisible = await page.locator('#emotion-review').isVisible();
    assert(reviewVisible, 'Review screen is visible');

    const reviewText = await page.locator('#emotion-review').textContent();
    assert(reviewText.includes(FORWARD_ANSWERS.reason), 'Review shows reason answer');
    assert(reviewText.includes(FORWARD_ANSWERS.fear), 'Review shows fear answer');
    assert(reviewText.includes(FORWARD_ANSWERS.meaning), 'Review shows meaning answer');
    assert(reviewText.includes("What you've written"), 'Review has "What you\'ve written" heading');
    pass('Review screen shows all three answers correctly');

    await page.click('#review-next');
    await page.waitForTimeout(400);

    // ── 8. Backwards reframe 1: meaning reflection ────────────────────────────
    log('\n=== Backwards reframe 1: meaning → reflection ===');
    await screenshot(page, 'reframe-1-meaning');

    const reframe1Visible = await page.locator('#emotion-reframe').isVisible();
    assert(reframe1Visible, 'Reframe section is visible');

    const reframe1Text = await page.locator('#emotion-reframe').textContent();
    assert(
      reframe1Text.includes(FORWARD_ANSWERS.meaning),
      'Reframe 1 shows the meaning answer in blockquote'
    );
    assert(
      reframe1Text.includes('Is this actually true about you'),
      'Reframe 1 asks the meaning reframe question'
    );

    await page.fill('#reframe-input', REFRAME_ANSWERS[0]);
    await screenshot(page, 'reframe-1-filled');
    await page.click('#reframe-next');
    await page.waitForTimeout(400);
    pass('Completed backwards reframe 1 (meaning)');

    // ── 9. Backwards reframe 2: fear reflection ───────────────────────────────
    log('\n=== Backwards reframe 2: fear → reflection ===');
    await screenshot(page, 'reframe-2-fear');

    const reframe2Text = await page.locator('#emotion-reframe').textContent();
    assert(
      reframe2Text.includes(FORWARD_ANSWERS.fear),
      'Reframe 2 shows the fear answer in blockquote'
    );
    assert(
      reframe2Text.includes('How certain is it that this would actually happen'),
      'Reframe 2 asks the fear reframe question'
    );

    await page.fill('#reframe-input', REFRAME_ANSWERS[1]);
    await screenshot(page, 'reframe-2-filled');
    await page.click('#reframe-next');
    await page.waitForTimeout(400);
    pass('Completed backwards reframe 2 (fear)');

    // ── 10. Backwards reframe 3: reason reflection ────────────────────────────
    log('\n=== Backwards reframe 3: reason → reflection ===');
    await screenshot(page, 'reframe-3-reason');

    const reframe3Text = await page.locator('#emotion-reframe').textContent();
    assert(
      reframe3Text.includes(FORWARD_ANSWERS.reason),
      'Reframe 3 shows the reason answer in blockquote'
    );
    assert(
      reframe3Text.includes('does this still feel like a barrier'),
      'Reframe 3 asks the reason reframe question'
    );

    await page.fill('#reframe-input', REFRAME_ANSWERS[2]);
    await screenshot(page, 'reframe-3-filled');
    await page.click('#reframe-next');
    await page.waitForTimeout(2500); // closing has 2s delay before continue button appears

    pass('Completed backwards reframe 3 (reason)');

    // ── 11. Closing screen ────────────────────────────────────────────────────
    log('\n=== Closing screen ===');
    await screenshot(page, 'closing-screen');

    const closingVisible = await page.locator('#emotion-closing').isVisible();
    assert(closingVisible, 'Closing screen is visible');

    const closingText = await page.locator('#emotion-closing').textContent();
    assert(
      closingText.includes("You don't need to resolve all of this right now."),
      'Closing screen shows "You don\'t need to resolve all of this right now."'
    );
    assert(
      closingText.includes("You only need to begin."),
      'Closing screen shows "You only need to begin."'
    );

    const continueBtn = await page.locator('#emotion-continue').isVisible();
    assert(continueBtn, 'Continue button is visible on closing screen');
    pass('Closing screen displayed correctly');

    // ── 12. Continue from closing screen ─────────────────────────────────────
    log('\n=== Continuing from closing screen ===');
    await page.click('#emotion-continue');
    await page.waitForTimeout(400);
    await screenshot(page, 'projects-screen');

    const projectsScreen = await page.locator('#screen-projects.active').count();
    assert(projectsScreen > 0, 'Projects screen is shown after completing emotion check');
    pass('Navigated to projects screen after emotion check');

  } catch (err) {
    fail('Unexpected error during test run', err);
    await screenshot(page, 'error-state').catch(() => {});
  } finally {
    await browser.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} [${r.status}] ${r.msg}`);
    if (r.err) console.log(`         Error: ${r.err}`);
  }
  console.log('='.repeat(60));
  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`\nOverall status: ${failed === 0 ? 'PASS' : 'FAIL'}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
