// Dev helper: renders the running dev server in headless Chrome and saves screenshots.
// usage: node tools/shoot.mjs <url> <outdir> <width> <height> '<js steps as JSON array of [code, waitMs, name]>'
import puppeteer from 'puppeteer-core';
const [url, out, w, h, stepsJson] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2, isMobile: +w < 700, hasTouch: +w < 700 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle0' });
for (const [code, wait, name] of JSON.parse(stepsJson)) {
  if (code) { const r = await page.evaluate(code); if (r !== undefined && r !== null) console.log("result:", JSON.stringify(r)); }
  await new Promise((r) => setTimeout(r, wait));
  if (name) await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 80 });
}
if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
await browser.close();
