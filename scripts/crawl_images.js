/**
 * ScaryButCute - 이미지 크롤러
 * 매일 실행하여 로컬 번들 이미지를 새로운 사진으로 교체
 *
 * 사용법: node scripts/crawl_images.js
 * Windows Task Scheduler로 매일 자동 실행 권장
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const BASE_DIR = path.join(__dirname, "..", "images");
const COUNT = 80;

const ANIMALS = {
  dog: { type: "batch", url: "https://dog.ceo/api/breeds/image/random/50" },
  cat: { url: (i) => `https://cataas.com/cat?width=300&height=200&t=${Date.now()}_${i}` },
  fox: { type: "fox_static" },
  capybara: { url: (i) => `https://api.tinyfox.dev/img?animal=capy&t=${Date.now()}_${i}` },
  rabbit: { url: (i) => `https://api.tinyfox.dev/img?animal=bun&t=${Date.now()}_${i}` },
  red_panda: { url: (i) => `https://api.tinyfox.dev/img?animal=wah&t=${Date.now()}_${i}` },
  ferret: { url: (i) => `https://api.tinyfox.dev/img?animal=dook&t=${Date.now()}_${i}` },
  snow_leopard: { url: (i) => `https://api.tinyfox.dev/img?animal=snep&t=${Date.now()}_${i}` },
};

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "ComfortViewer/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchJson(url) {
  const buf = await download(url);
  return JSON.parse(buf.toString());
}

async function crawlAnimal(name, config) {
  const dir = path.join(BASE_DIR, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log(`[${name}] Downloading ${COUNT} images...`);
  let success = 0;
  let fail = 0;

  // dog.ceo: batch API (50장씩 2번)
  if (config.type === "batch") {
    try {
      const json1 = await fetchJson(config.url);
      const json2 = await fetchJson(config.url);
      const urls = [...json1.message, ...json2.message].slice(0, COUNT);
      for (let i = 0; i < urls.length; i++) {
        try {
          const buf = await download(urls[i]);
          if (buf.length > 1000) {
            fs.writeFileSync(path.join(dir, `${i + 1}.jpg`), buf);
            success++;
          } else { fail++; }
        } catch { fail++; }
      }
    } catch (e) { console.log(`[${name}] Batch error:`, e.message); fail = COUNT; }
    console.log(`[${name}] Done: ${success} ok, ${fail} failed`);
    return;
  }

  // randomfox: 정적 파일 (1~124)
  if (config.type === "fox_static") {
    const used = new Set();
    for (let i = 0; i < COUNT; i++) {
      let n;
      do { n = Math.floor(Math.random() * 124) + 1; } while (used.has(n));
      used.add(n);
      try {
        const buf = await download(`https://randomfox.ca/images/${n}.jpg`);
        if (buf.length > 1000) {
          fs.writeFileSync(path.join(dir, `${i + 1}.jpg`), buf);
          success++;
        } else { fail++; }
      } catch { fail++; }
    }
    console.log(`[${name}] Done: ${success} ok, ${fail} failed`);
    return;
  }

  // 기본: 개별 URL (10개씩 병렬)
  for (let batch = 0; batch < COUNT; batch += 10) {
    const promises = [];
    for (let i = batch; i < Math.min(batch + 10, COUNT); i++) {
      const idx = i + 1;
      const p = (async () => {
        try {
          const imgUrl = config.url(i);
          const buf = await download(imgUrl);
          if (buf.length > 1000) {
            fs.writeFileSync(path.join(dir, `${idx}.jpg`), buf);
            success++;
          } else { fail++; }
        } catch { fail++; }
      })();
      promises.push(p);
    }
    await Promise.all(promises);
  }

  console.log(`[${name}] Done: ${success} ok, ${fail} failed`);
}

async function resizeAll() {
  const { execSync } = require("child_process");
  console.log("\n[resize] Resizing all images to 200x150, quality 70%...");
  try {
    execSync(`python -c "
from PIL import Image
import os, glob
count = 0
for f in glob.glob('images/**/*.jpg', recursive=True):
    try:
        img = Image.open(f).convert('RGB')
        img.thumbnail((200, 150), Image.LANCZOS)
        img.save(f, 'JPEG', quality=70)
        count += 1
    except: pass
print(f'Resized {count} images')
"`, { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  } catch (e) {
    console.log("[resize] Failed:", e.message);
    console.log("[resize] Pillow 필요: pip install Pillow");
  }
}

async function main() {
  console.log("=== ScaryButCute Image Crawler ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Target: ${BASE_DIR}\n`);

  for (const [name, config] of Object.entries(ANIMALS)) {
    await crawlAnimal(name, config);
  }

  await resizeAll();

  console.log("\nAll done!");
}

main().catch(console.error);
