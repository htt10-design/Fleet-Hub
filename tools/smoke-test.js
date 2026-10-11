// Smoke-Test für SGS Pro: startet einen lokalen Server, öffnet die App in
// Chromium (Handy- und Desktop-Größe), klickt die Hauptbereiche durch und
// meldet alle JS-Fehler. Screenshots landen im angegebenen Ordner.
//
// Aufruf:  node tools/smoke-test.js [screenshot-ordner]
// Voraussetzung: Playwright (global oder lokal installiert).
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.smoke'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html`;
  fs.mkdirSync(OUT, { recursive: true });
  const launchOpts = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await chromium.launch(launchOpts);
  const errors = [];

  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
    page.on('requestfailed', r => errors.push(`[${label}] request failed: ${r.url()}`));

    await page.goto(url);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT, `${label}-01-start.png`) });

    await page.evaluate(() => selectArea('eigene'));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${label}-02-garage.png`) });

    await page.evaluate(() => chooseGarageVehicle(appData.vehicles[0].id));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${label}-03-dashboard.png`) });

    for (const tab of ['fuel', 'service', 'history', 'settings']) {
      await page.evaluate(t => showTab(t, document.querySelector(`.nav-item[onclick*="'${t}'"]`)), tab);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${label}-tab-${tab}.png`), fullPage: true });
    }
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(`Screenshots: ${OUT}`);
  if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
  console.log('OK - keine JS-Fehler.');
})().catch(e => { console.error(e); server.close(); process.exit(1); });
