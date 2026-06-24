import { chromium } from 'playwright';
import * as path from 'path';

const SCREENSHOT_DIR = 'V:\\Antgravity\\webstreamer';

const VIEWPORTS = [
  { width: 375,  height: 812,  name: '375px (iPhone X)' },
  { width: 768,  height: 1024, name: '768px (iPad)' },
  { width: 1280, height: 800,  name: '1280px (Desktop)' },
  { width: 1920, height: 1080, name: '1920px (Desktop HD)' },
];

async function drawBoxAnnotation(page, { x, y, width, height, color, label, viewportWidth, viewportHeight }) {
  return page.evaluate(({ x, y, width, height, color, label, viewportWidth, viewportHeight }) => {
    const old = document.getElementById('__measure_overlay');
    if (old) old.remove();
    const canvas = document.createElement('canvas');
    canvas.id = '__measure_overlay';
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = color.replace(')', ', 0.12)').replace('rgb', 'rgba');
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'top';
    const wLabel = `${width}px`;
    const wMetrics = ctx.measureText(wLabel);
    ctx.fillText(wLabel, x + (width - wMetrics.width) / 2, y + height + 6);
    ctx.textBaseline = 'middle';
    const hLabel = `${height}px`;
    ctx.fillText(hLabel, x + width + 8, y + height / 2);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(label || '', x + 4, y + 4);
  }, { x, y, width, height, color, label, viewportWidth, viewportHeight });
}

async function run() {
  console.log('='.repeat(70));
  console.log('  PLAYER LAYOUT ANALYSIS');
  console.log('  Web App: http://localhost:5173/');
  console.log('='.repeat(70));
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.waitForSelector('.poster-card', { timeout: 15000 });
  console.log('Page loaded, poster cards visible.\n');

  for (const vp of VIEWPORTS) {
    console.log('-'.repeat(70));
    console.log('  VIEWPORT: ' + vp.name + ' (' + vp.width + 'x' + vp.height + ')');
    console.log('-'.repeat(70));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.poster-card', { timeout: 15000 });
    await page.waitForTimeout(1000);

    try {
      const posterCards = await page.$$('.poster-card');
      if (posterCards.length === 0) {
        console.log('  ERROR: No poster cards found');
        continue;
      }
      await posterCards[0].click();
      await page.waitForTimeout(1500);

      const playBtn = await page.$('.detail-panel .hero-actions .primary-btn');
      if (!playBtn) {
        console.log('  WARNING: No Play button found, trying alternative...');
        const altPlayBtn = await page.$('.detail-panel button.primary-btn');
        if (altPlayBtn) {
          await altPlayBtn.click();
        } else {
          console.log('  ERROR: Could not find play button');
          continue;
        }
      } else {
        await playBtn.click();
      }
      await page.waitForTimeout(1500);

      try {
        await page.waitForSelector('.stream-picker-panel', { timeout: 15000 });
        console.log('  Stream picker appeared.');
      } catch (e) {
        console.log('  WARNING: Stream picker did not appear.');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'stream-picker-fail-' + vp.width + '.png'), fullPage: false });
        continue;
      }
      await page.waitForTimeout(500);

      try {
        await page.waitForSelector('.stream-option.clickable', { timeout: 20000 });
        console.log('  Stream options available.');
      } catch (e) {
        console.log('  WARNING: No clickable stream options found.');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'stream-options-fail-' + vp.width + '.png'), fullPage: false });
        continue;
      }
      await page.waitForTimeout(500);

      const streamOptions = await page.$$('.stream-option.clickable');
      if (streamOptions.length === 0) {
        console.log('  ERROR: No clickable stream options');
        continue;
      }
      const firstOption = streamOptions[0];
      await firstOption.scrollIntoViewIfNeeded();
      await firstOption.click();
      console.log('  Clicked first stream option.');

      await page.waitForTimeout(4000);
      await measureAndScreenshot(page, vp);

    } catch (err) {
      console.log('  ERROR at ' + vp.name + ': ' + err.message);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error-' + vp.width + '.png'), fullPage: false });
    }
  }

  await browser.close();
  console.log('\n' + '='.repeat(70));
  console.log('  All viewports analyzed.');
  console.log('='.repeat(70));
}

async function measureAndScreenshot(page, vp) {
  const results = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    function getRect(selector) {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        top: Math.round(r.top),
        left: Math.round(r.left),
        bottom: Math.round(r.bottom),
        right: Math.round(r.right),
      };
    }

    const playerWrap = getRect('.player-wrap');
    const neoPlayer = getRect('.neo-player');
    const playerHeader = getRect('.player-header');
    const playerControls = getRect('.player-controls');
    const streamShell = getRect('.stream-shell');

    let playerWrapStyle = null;
    let neoPlayerStyle = null;
    let neoPlayerAspectRatio = null;

    if (playerWrap) {
      const style = window.getComputedStyle(document.querySelector('.player-wrap'));
      playerWrapStyle = {
        maxWidth: style.maxWidth,
        width: style.width,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
      };
    }

    if (neoPlayer) {
      const el = document.querySelector('.neo-player');
      const style = window.getComputedStyle(el);
      neoPlayerStyle = {
        aspectRatio: style.aspectRatio,
        width: style.width,
        height: style.height,
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
      };
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        neoPlayerAspectRatio = (el.offsetWidth / el.offsetHeight).toFixed(4);
      }
    }

    return {
      viewportWidth: vw,
      viewportHeight: vh,
      playerWrap,
      neoPlayer,
      playerHeader,
      playerControls,
      streamShell,
      playerWrapStyle,
      neoPlayerStyle,
      neoPlayerAspectRatio,
    };
  });

  const gaps = {};
  if (results.playerWrap) {
    gaps.left = results.playerWrap.left;
    gaps.right = results.viewportWidth - results.playerWrap.right;
    gaps.top = results.playerWrap.top;
    gaps.bottom = results.viewportHeight - results.playerWrap.bottom;
  } else {
    gaps.left = null;
    gaps.right = null;
    gaps.top = null;
    gaps.bottom = null;
  }

  const overlayData = [];
  if (results.playerWrap) {
    overlayData.push({ ...results.playerWrap, color: 'rgb(255, 80, 80)', label: 'player-wrap' });
  }
  if (results.neoPlayer) {
    overlayData.push({ ...results.neoPlayer, color: 'rgb(80, 180, 255)', label: 'neo-player' });
  }
  if (results.playerHeader) {
    overlayData.push({ ...results.playerHeader, color: 'rgb(80, 255, 80)', label: 'player-header' });
  }
  if (results.playerControls) {
    overlayData.push({ ...results.playerControls, color: 'rgb(255, 200, 50)', label: 'player-controls' });
  }

  for (const item of overlayData) {
    await drawBoxAnnotation(page, {
      x: item.x, y: item.y, width: item.width, height: item.height,
      color: item.color, label: item.label,
      viewportWidth: results.viewportWidth, viewportHeight: results.viewportHeight,
    });
  }

  const screenshotPath = path.join(SCREENSHOT_DIR, 'player-layout-' + vp.width + '.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('  Screenshot saved: ' + screenshotPath);

  console.log('');
  console.log('  +- Viewport: ' + vp.width + 'x' + vp.height);
  console.log('  |');

  if (results.streamShell) {
    console.log('  +- StreamShell dimensions:');
    console.log('  |    width: ' + results.streamShell.width + 'px, height: ' + results.streamShell.height + 'px');
    console.log('  |    top: ' + results.streamShell.top + 'px, left: ' + results.streamShell.left + 'px');
  }

  if (results.playerWrap) {
    const pw = results.playerWrap;
    console.log('  +- .player-wrap dimensions:');
    console.log('  |    width: ' + pw.width + 'px, height: ' + pw.height + 'px');
    console.log('  |    top: ' + pw.top + 'px, left: ' + pw.left + 'px');
    console.log('  |    bottom: ' + pw.bottom + 'px, right: ' + pw.right + 'px');
    console.log('  |    max-width: ' + (results.playerWrapStyle ? results.playerWrapStyle.maxWidth : 'N/A'));
    console.log('  |    computed width: ' + (results.playerWrapStyle ? results.playerWrapStyle.width : 'N/A'));
    console.log('  |    margin: ' + (results.playerWrapStyle ? results.playerWrapStyle.marginLeft + ' ' + results.playerWrapStyle.marginRight : 'N/A'));
  }

  if (results.neoPlayer) {
    const np = results.neoPlayer;
    console.log('  +- .neo-player dimensions:');
    console.log('  |    width: ' + np.width + 'px, height: ' + np.height + 'px');
    console.log('  |    top: ' + np.top + 'px, left: ' + np.left + 'px');
    console.log('  |    computed aspect-ratio: ' + (results.neoPlayerStyle ? results.neoPlayerStyle.aspectRatio : 'N/A'));
    console.log('  |    actual ratio (w/h): ' + results.neoPlayerAspectRatio);
    console.log('  |    computed width: ' + (results.neoPlayerStyle ? results.neoPlayerStyle.width : 'N/A'));
    console.log('  |    computed height: ' + (results.neoPlayerStyle ? results.neoPlayerStyle.height : 'N/A'));
  }

  if (results.playerHeader) {
    const ph = results.playerHeader;
    console.log('  +- .player-header:');
    console.log('  |    height: ' + ph.height + 'px');
  }

  if (results.playerControls) {
    const pc = results.playerControls;
    console.log('  +- .player-controls:');
    console.log('  |    height: ' + pc.height + 'px, bottom edge: ' + pc.bottom);
  }

  console.log('  +- Gaps (player-wrap edge to viewport edge):');
  console.log('  |    left gap:  ' + gaps.left + 'px');
  console.log('  |    right gap: ' + gaps.right + 'px');
  console.log('  |    top gap:   ' + gaps.top + 'px');
  console.log('  |    bottom gap: ' + gaps.bottom + 'px');

  if (results.playerWrap) {
    const isFullWidth = results.playerWrap.width === results.viewportWidth;
    console.log('  |');
    console.log('  +- Player fills full viewport width: ' + (isFullWidth ? 'YES' : 'NO'));
    if (!isFullWidth && results.playerWrapStyle && results.playerWrapStyle.maxWidth) {
      console.log('  |    Constrained by max-width: ' + results.playerWrapStyle.maxWidth);
    }
  }

  if (results.neoPlayerAspectRatio) {
    const ar = parseFloat(results.neoPlayerAspectRatio);
    const expectedDesktop = 16/9;
    const expectedMobile = 3/2;
    const isDesktopRatio = Math.abs(ar - expectedDesktop) < 0.1;
    const isMobileRatio = Math.abs(ar - expectedMobile) < 0.1;
    console.log('  |');
    console.log('  +- Aspect ratio analysis:');
    if (isDesktopRatio) {
      console.log('  |    -> 16:9 (DESKTOP) aspect ratio active');
    } else if (isMobileRatio) {
      console.log('  |    -> 3:2 (MOBILE) aspect ratio active');
    } else {
      console.log('  |    -> UNKNOWN aspect ratio: ' + ar);
    }
  }

  console.log('  +-');
  console.log('');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
