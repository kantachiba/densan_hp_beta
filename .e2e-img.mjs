import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4410";
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const log = (...a) => console.log(...a);

// ---- login
await page.goto(`${BASE}/login`);
await page.fill("input[name=loginId]", "e2etest");
await page.fill("input[name=password]", "e2e-test-pass-1234");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/);
log("login:", page.url());

// ---- new article
await page.goto(`${BASE}/admin/articles/new`);
await page.waitForSelector("#editor .ProseMirror");
await page.fill("#title", "画像レイアウトのテスト");

// upload an image through the hidden file input
await page.setInputFiles("#image-input", "data/uploads/59cab46d151c52af91dbf5d7aca13833.webp");
await page.waitForSelector("#editor .a-fig img", { timeout: 15000 });
log("image inserted:", await page.locator("#editor .a-fig").count());

// ---- select the image -> toolbar should appear
await page.click("#editor .a-fig img");
await page.waitForSelector("#image-menu", { state: "visible", timeout: 5000 });
log("toolbar visible:", await page.locator("#image-menu").isVisible());

// ---- align right
await page.click('#image-menu [data-img-set="align:right"]');
log("align attr:", await page.getAttribute("#editor .a-fig", "data-align"));

// ---- width 60%
const range = page.locator("#img-width");
await range.fill("60");
await range.dispatchEvent("input");
log("width style:", await page.getAttribute("#editor .a-fig", "style"));

// ---- crop 1:1
await page.click('#editor .a-fig img');
await page.click('#image-menu [data-img-set="ratio:1:1"]');
await page.waitForSelector("#editor .a-fig__frame[data-cropped]");
const framed = await page.evaluate(() => {
  const f = document.querySelector("#editor .a-fig__frame");
  const r = f.getBoundingClientRect();
  return { ratio: (r.width / r.height).toFixed(2), cropped: f.hasAttribute("data-cropped") };
});
log("after 1:1 crop:", framed);
log("hint shown:", await page.locator("#img-crop-hint").isVisible());

// ---- drag to pan
const box = await page.locator("#editor .a-fig__frame").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
log("after pan style:", await page.getAttribute("#editor .a-fig", "style"));

// ---- save as published and check the public page
await page.click("#open-publish");
await page.fill("#category", "テスト");
await page.click("#publish");
await page.waitForSelector('[data-step="done"]:not([hidden])', { timeout: 15000 });
const viewUrl = await page.getAttribute("#done-view", "href");
log("published:", viewUrl);

const pub = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await pub.goto(viewUrl);
const rendered = await pub.evaluate(() => {
  const fig = document.querySelector(".article-body .a-fig");
  const frame = fig?.querySelector(".a-fig__frame");
  const img = fig?.querySelector("img");
  const fr = frame.getBoundingClientRect();
  return {
    align: fig.dataset.align,
    style: fig.getAttribute("style"),
    cropped: frame.hasAttribute("data-cropped"),
    frameRatio: (fr.width / fr.height).toFixed(2),
    objectPosition: getComputedStyle(img).objectPosition,
    objectFit: getComputedStyle(img).objectFit,
    widthRatioVsColumn: (fr.width / document.querySelector(".article-body").getBoundingClientRect().width).toFixed(2),
  };
});
log("public page:", rendered);
await pub.screenshot({ path: "/tmp/densan-img-public.png", fullPage: false });
await page.screenshot({ path: "/tmp/densan-img-editor.png", fullPage: false });

log("errors:", errors);
await browser.close();
