#!/usr/bin/env node
/**
 * crawler.js – Thu thập danh sách nhà thầu nước ngoài từ eTax Vietnam
 * Port sang Node.js từ etax_crawler_v2.py
 *
 * Sử dụng: node crawler.js [--append | --full]
 *   --append  (mặc định): Chỉ bổ sung nhà thầu mới, giữ nguyên dữ liệu cũ
 *   --full:               Cập nhật toàn bộ (ghi đè, cập nhật tên nếu đổi)
 *
 * Output:
 *   registered_contractors.csv   — Danh sách nhà thầu (CSV)
 *   registered_contractors.json  — Bản sao JSON
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL  = 'https://etaxvn.gdt.gov.vn/nccnn/Request';
const SCRIPT_DIR = __dirname;
const CSV_FILE  = path.join(SCRIPT_DIR, 'registered_contractors.csv');
const JSON_FILE = path.join(SCRIPT_DIR, 'registered_contractors.json');
const TIMEOUT   = 60_000; // ms

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE = args.includes('--full') ? 'full' : 'append';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(msg + '\n');
}

function formatDate(raw) {
  if (!raw) return '';
  const s = raw.trim();
  // "DD/MM/YYYY HH:MM:SS" → "DD/MM/YYYY"
  const m = s.match(/^(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : s;
}

function parseDateForSort(dateStr) {
  if (!dateStr) return new Date(0);
  const [d, mo, y] = dateStr.split('/').map(Number);
  return new Date(y, mo - 1, d);
}

/**
 * Load existing CSV → returns { existingMap: Map<taxCode, row>, rows: Array }
 */
function loadExistingCsv() {
  const existingMap = new Map();
  const rows = [];

  if (!fs.existsSync(CSV_FILE)) {
    log('   📋 File CSV chưa tồn tại, sẽ tạo mới.');
    return { existingMap, rows };
  }

  const content = fs.readFileSync(CSV_FILE, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return { existingMap, rows };

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV parse (handles quoted fields with commas inside)
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });
    const tc = row['Tax Code'];
    if (tc) {
      existingMap.set(tc, row);
      rows.push(row);
    }
  }

  log(`   📋 File CSV hiện có: ${existingMap.size} nhà thầu.`);
  return { existingMap, rows };
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function saveCsv(records) {
  // Sort by Issuance Date asc
  records.sort((a, b) => parseDateForSort(a['Issuance Date']) - parseDateForSort(b['Issuance Date']));
  // Re-number
  records.forEach((r, i) => { r['No.'] = String(i + 1); });

  const headers = ['No.', 'Tax Code', 'Company Name', 'Issuance Date'];
  const escapeField = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(','),
    ...records.map(r => headers.map(h => escapeField(r[h])).join(',')),
  ];

  // Write with UTF-8 BOM for Excel compatibility
  fs.writeFileSync(CSV_FILE, '\uFEFF' + lines.join('\r\n'), 'utf-8');
  log(`   💾 Đã lưu ${records.length} nhà thầu → ${CSV_FILE}`);
}

function convertCsvToJson(records) {
  const out = records.map(r => ({
    'No.': r['No.'],
    'Tax Code': r['Tax Code'],
    'Company Name': r['Company Name'],
    'Issuance Date': r['Issuance Date'],
  }));
  fs.writeFileSync(JSON_FILE, JSON.stringify(out, null, 2), 'utf-8');
  log(`   💾 Đã xuất JSON → ${JSON_FILE}`);
}

// ─── Browser Data Extraction ──────────────────────────────────────────────────
async function extractTableData(frame) {
  return frame.evaluate(() => {
    const results = [];
    for (const table of document.querySelectorAll('table')) {
      for (const tr of table.querySelectorAll('tr')) {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 4) {
          const stt      = tds[0].textContent.trim();
          const mst      = tds[1].textContent.trim();
          const ten      = tds[2].textContent.trim();
          const thoigian = tds[3].textContent.trim();
          if (/^\d+$/.test(stt) && /^\d{7,}$/.test(mst)) {
            results.push({ mst, ten, thoigian });
          }
        }
      }
    }
    return results;
  });
}

async function getPaginationInfo(frame) {
  return frame.evaluate(() => {
    let maxPage = 1;
    for (const link of document.querySelectorAll('a[href*="pn="]')) {
      const m = link.href.match(/pn=(\d+)/);
      if (m) {
        const pn = parseInt(m[1], 10);
        if (pn > maxPage) maxPage = pn;
      }
    }
    return maxPage;
  });
}

async function navigateToPage(frame, pageNum) {
  return frame.evaluate((pn) => {
    for (const link of document.querySelectorAll('a[href*="pn="]')) {
      const m = link.href.match(/pn=(\d+)/);
      if (m && parseInt(m[1], 10) === pn) { link.click(); return true; }
    }
    return false;
  }, pageNum);
}

function getIframe(page) {
  let iframe = page.frame({ name: 'mainframe' });
  if (!iframe) {
    iframe = page.frames().find(f => (f.name() || '').includes('mainframe')) || null;
  }
  return iframe;
}

// ─── Main Crawler ─────────────────────────────────────────────────────────────
async function crawlAllContractors(page) {
  const allData = [];

  log('[1/4] Đang tải trang chủ...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  log('   ✓ Trang chủ đã tải xong');

  log('[2/4] Đang mở trang tra cứu nhà thầu...');
  const link = page.locator('a[href*="corpTCuuTTinMSTProc"][target="mainframe"]').first();
  if (await link.count() > 0) {
    await link.click();
    await page.waitForTimeout(3000);
    log('   ✓ Đã mở trang tra cứu');
  } else {
    log('   ⚠ Không tìm thấy link tra cứu');
  }

  let iframe = getIframe(page);
  if (!iframe) {
    log('   ✗ Không thể truy cập iframe!');
    process.exit(1);
  }
  log('   ✓ Đã truy cập iframe');
  await page.waitForTimeout(3000);

  log('[3/4] Đang tìm kiếm toàn bộ nhà thầu...');
  const searchSelectors = [
    'input[value*="Search"]', 'input[value*="Tra cứu"]',
    'a:has-text("Search")', 'a:has-text("Tra cứu")',
    'button:has-text("Search")', 'input[type="submit"]',
  ];

  let clicked = false;
  for (const sel of searchSelectors) {
    try {
      const loc = iframe.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click();
        log('   ✓ Đã nhấn nút tìm kiếm');
        clicked = true;
        break;
      }
    } catch (_) { /* continue */ }
  }
  if (!clicked) log('   ⚠ Không tìm thấy nút tìm kiếm, thử tiếp tục...');
  await page.waitForTimeout(5000);

  log('[4/4] Đang thu thập dữ liệu...');
  iframe = getIframe(page);

  const page1 = await extractTableData(iframe);
  const totalPages = await getPaginationInfo(iframe);
  log(`   Tổng số trang: ${totalPages}`);
  log(`   Trang 1: ${page1.length} nhà thầu`);
  allData.push(...page1);

  for (let pg = 2; pg <= totalPages; pg++) {
    log(`   Đang tải trang ${pg}/${totalPages}...`);
    iframe = getIframe(page);
    const navigated = await navigateToPage(iframe, pg);
    if (navigated) {
      await page.waitForTimeout(4000);
      iframe = getIframe(page);
      const pgData = await extractTableData(iframe);
      log(`   Trang ${pg}: ${pgData.length} nhà thầu`);
      allData.push(...pgData);
    } else {
      log(`   ⚠ Không thể chuyển đến trang ${pg}`);
    }
  }

  log(`\n   📊 Tổng thu thập: ${allData.length} nhà thầu`);
  return allData;
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
(async () => {
  log('='.repeat(65));
  log('   BOT THU THẬP DANH SÁCH NHÀ THẦU NƯỚC NGOÀI - eTax VN');
  log(`   Chế độ: ${MODE === 'append' ? 'BỔ SUNG (append)' : 'CẬP NHẬT TOÀN BỘ (full)'}`);
  log('='.repeat(65));
  log('');

  const { existingMap, rows: existingRows } = loadExistingCsv();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'vi-VN',
  });
  const page = await ctx.newPage();

  let allContractors;
  try {
    allContractors = await crawlAllContractors(page);
  } catch (err) {
    log(`\n[LỖI] ${err.message}`);
    console.error(err);
    await browser.close();
    process.exit(1);
  }
  await browser.close();

  if (!allContractors || allContractors.length === 0) {
    log('\n   ⚠ Không có dữ liệu để lưu.');
    process.exit(0);
  }

  log('\n   Đang xử lý dữ liệu...');
  let records = [];

  if (MODE === 'full') {
    const seen = new Set();
    let updated = 0;
    for (const c of allContractors) {
      if (seen.has(c.mst)) continue;
      seen.add(c.mst);
      const old = existingMap.get(c.mst);
      if (old && old['Company Name'] && old['Company Name'] !== c.ten) {
        log(`   🔄 Cập nhật tên: ${c.mst} | "${old['Company Name']}" → "${c.ten}"`);
        updated++;
      }
      records.push({ 'No.': '', 'Tax Code': c.mst, 'Company Name': c.ten, 'Issuance Date': formatDate(c.thoigian) });
    }
    log(`   📝 Tổng: ${records.length} | Tên được cập nhật: ${updated}`);

  } else {
    // APPEND
    for (const row of existingRows) {
      records.push({ 'No.': '', 'Tax Code': row['Tax Code'], 'Company Name': row['Company Name'], 'Issuance Date': row['Issuance Date'] });
    }
    let newCount = 0, skipCount = 0;
    for (const c of allContractors) {
      if (existingMap.has(c.mst)) { skipCount++; continue; }
      records.push({ 'No.': '', 'Tax Code': c.mst, 'Company Name': c.ten, 'Issuance Date': formatDate(c.thoigian) });
      existingMap.set(c.mst, true);
      newCount++;
    }
    log(`   ➕ Nhà thầu mới: ${newCount}`);
    log(`   ⏭️  Đã tồn tại (bỏ qua): ${skipCount}`);
  }

  saveCsv(records);
  convertCsvToJson(records);

  log('');
  log('='.repeat(65));
  log('   HOÀN THÀNH!');
  log('='.repeat(65));
})();
