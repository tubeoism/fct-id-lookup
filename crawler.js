#!/usr/bin/env node
/**
 * crawler.js – Thu thập danh sách nhà cung cấp nước ngoài từ eTax Vietnam
 * Port sang Node.js từ etax_crawler_v2.py
 *
 * Sử dụng: node crawler.js [--append | --full]
 *   --append  (mặc định): Chỉ bổ sung nhà cung cấp mới, giữ nguyên dữ liệu cũ
 *   --full:               Duyệt lại toàn bộ, cập nhật tên/ngày nếu đổi (không xoá bản ghi cũ
 *                         đã biến mất khỏi nguồn — chỉ thêm/cập nhật, không phải ghi đè hoàn toàn)
 *
 * Output:
 *   registered_contractors.csv   — Danh sách nhà cung cấp (CSV)
 *   registered_contractors.json  — Bản sao JSON
 *
 * Fields:
 *   No., Tax Code, Provider Name, Issuance Date, Issuance Time
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL  = 'https://etaxvn.gdt.gov.vn/nccnn/Request';
const SCRIPT_DIR = __dirname;
const CSV_FILE  = path.join(SCRIPT_DIR, 'registered_contractors.csv');
const JSON_FILE = path.join(SCRIPT_DIR, 'registered_contractors.json');
const TIMEOUT   = 60_000; // ms
const GOTO_RETRIES    = 3;
const GOTO_BACKOFF_MS = 10_000; // 10s, 20s, ...
const PAGE_RETRIES    = 3;      // số lần thử lại khi chuyển trang / trang trả về rỗng
const ROWS_WAIT_MS    = 20_000; // thời gian tối đa chờ bảng dữ liệu hiển thị

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

function formatTime(raw) {
  if (!raw) return '';
  const s = raw.trim();
  // "DD/MM/YYYY HH:MM:SS" → "HH:MM:SS"
  const m = s.match(/(\d{2}:\d{2}:\d{2})$/);
  return m ? m[1] : '';
}

function parseDateTimeForSort(dateStr, timeStr) {
  if (!dateStr) return new Date(0);
  const [d, mo, y] = dateStr.split('/').map(Number);
  let h = 0, min = 0, sec = 0;
  if (timeStr) {
    const tp = timeStr.split(':').map(Number);
    h = tp[0] || 0; min = tp[1] || 0; sec = tp[2] || 0;
  }
  return new Date(y, mo - 1, d, h, min, sec);
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
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  for (const row of records) {
    // Migrate legacy 'Company Name' field
    if (!row['Provider Name'] && row['Contractor Name']) {
      row['Provider Name'] = row['Contractor Name'];
    }
    if (!row['Provider Name'] && row['Company Name']) {
      row['Provider Name'] = row['Company Name'];
    }
    const tc = row['Tax Code'];
    if (tc) {
      existingMap.set(tc, row);
      rows.push(row);
    }
  }

  log(`   📋 File CSV hiện có: ${existingMap.size} nhà cung cấp.`);
  return { existingMap, rows };
}

function saveCsv(records) {
  // Sort by Issuance Date+Time asc, then by original order
  records.sort((a, b) => {
    const timeA = parseDateTimeForSort(a['Issuance Date'], a['Issuance Time']).getTime();
    const timeB = parseDateTimeForSort(b['Issuance Date'], b['Issuance Time']).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return (a._orderIdx || 0) - (b._orderIdx || 0);
  });
  // Re-number
  records.forEach((r, i) => {
    r['No.'] = String(i + 1);
    delete r._orderIdx;
  });

  const headers = ['No.', 'Tax Code', 'Provider Name', 'Issuance Date', 'Issuance Time'];
  const csvBody = stringify(records, { header: true, columns: headers, record_delimiter: '\r\n' });

  // Write with UTF-8 BOM for Excel compatibility
  fs.writeFileSync(CSV_FILE, '\uFEFF' + csvBody, 'utf-8');
  log(`   💾 Đã lưu ${records.length} nhà cung cấp → ${CSV_FILE}`);
}

function convertCsvToJson(records) {
  const out = records.map(r => ({
    'No.': r['No.'],
    'Tax Code': r['Tax Code'],
    'Provider Name': r['Provider Name'],
    'Issuance Date': r['Issuance Date'],
    'Issuance Time': r['Issuance Time'] || '',
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
            results.push({ stt, mst, ten, thoigian });
          }
        }
      }
    }
    return results;
  });
}

/** Số trang lớn nhất trong các link đang hiển thị (site chỉ hiện một "cửa sổ" link, nên chỉ là cận dưới). */
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

/**
 * Đọc tổng số trang / bản ghi do site tự công bố, ví dụ:
 *   "Page 1/Total 7 page. Total record 334."
 * Trả null cho trường không đọc được (không đoán mò).
 */
async function getSiteSummary(frame) {
  const text = await frame.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const pages = text.match(/Total\s+(\d+)\s+page/i);
  const records = text.match(/Total\s+record\s+(\d+)/i);
  return {
    totalPages: pages ? parseInt(pages[1], 10) : null,
    totalRecords: records ? parseInt(records[1], 10) : null,
  };
}

/**
 * Chờ bảng dữ liệu có ít nhất 1 dòng hợp lệ (và, nếu có notFirstStt, dòng đầu phải khác
 * trang trước — tức nội dung đã thực sự đổi). Trả null nếu hết thời gian.
 */
async function waitForRows(page, { notFirstStt = null, timeoutMs = ROWS_WAIT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const iframe = getIframe(page);
      if (iframe) {
        const rows = await extractTableData(iframe);
        if (rows.length > 0 && (notFirstStt === null || rows[0].stt !== notFirstStt)) return rows;
      }
    } catch (_) { /* iframe đang điều hướng — thử lại */ }
    await page.waitForTimeout(1000);
  }
  return null;
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

/**
 * page.goto với retry + backoff. Dùng 'domcontentloaded' thay vì 'networkidle'
 * vì site eTax chậm/có request treo khiến networkidle không bao giờ đạt.
 */
async function gotoWithRetry(page, url) {
  let lastErr;
  for (let attempt = 1; attempt <= GOTO_RETRIES; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      // Chờ mạng yên tĩnh theo kiểu "best effort": không fail nếu không đạt
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < GOTO_RETRIES) {
        const delay = GOTO_BACKOFF_MS * attempt;
        log(`   ⚠ Tải trang thất bại (lần ${attempt}/${GOTO_RETRIES}): ${err.message.split('\n')[0]} — thử lại sau ${delay / 1000}s`);
        await page.waitForTimeout(delay);
      }
    }
  }
  throw lastErr;
}

// ─── Main Crawler ─────────────────────────────────────────────────────────────
async function crawlAllContractors(page) {
  const allData = [];

  log('[1/4] Đang tải trang chủ...');
  log('[2/4] Đang mở trang tra cứu nhà cung cấp...');
  // Trang chủ đôi khi tải xong nhưng link tra cứu chưa kịp render → chờ link thật sự xuất hiện,
  // nếu không thì tải lại trang thay vì đi tiếp với iframe rỗng.
  const linkSel = 'a[href*="corpTCuuTTinMSTProc"][target="mainframe"]';
  let opened = false;
  for (let attempt = 1; attempt <= GOTO_RETRIES && !opened; attempt++) {
    try {
      await gotoWithRetry(page, BASE_URL);
      await page.locator(linkSel).first().waitFor({ state: 'visible', timeout: 30_000 });
      log('   ✓ Trang chủ đã tải xong');
      await page.locator(linkSel).first().click();
      await page.waitForTimeout(3000);
      if (!getIframe(page)) throw new Error('chưa có iframe mainframe sau khi mở trang tra cứu');
      opened = true;
      log('   ✓ Đã mở trang tra cứu');
    } catch (err) {
      log(`   ⚠ Mở trang tra cứu thất bại (lần ${attempt}/${GOTO_RETRIES}): ${err.message.split('\n')[0]}`);
      if (attempt < GOTO_RETRIES) await page.waitForTimeout(GOTO_BACKOFF_MS * attempt);
    }
  }
  if (!opened) throw new Error('Không mở được trang tra cứu / iframe sau nhiều lần thử');

  let iframe = getIframe(page);
  log('   ✓ Đã truy cập iframe');
  await page.waitForTimeout(3000);

  log('[3/4] Đang tìm kiếm toàn bộ nhà cung cấp...');
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

  log('[4/4] Đang thu thập dữ liệu...');
  const page1 = await waitForRows(page, { timeoutMs: 30_000 });
  if (!page1) throw new Error('Trang 1 không có dữ liệu sau khi tìm kiếm');
  iframe = getIframe(page);

  const summary = await getSiteSummary(iframe);
  let totalPages = Math.max(summary.totalPages || 1, await getPaginationInfo(iframe));
  log(`   Site công bố: ${summary.totalRecords ?? '?'} bản ghi / ${summary.totalPages ?? '?'} trang`);
  log(`   Trang 1: ${page1.length} nhà cung cấp`);
  allData.push(...page1);

  // Site chỉ hiển thị một "cửa sổ" link phân trang, nên tổng số trang được cập nhật lại
  // sau mỗi trang thay vì chốt cứng từ trang 1.
  let prevFirstStt = page1[0].stt;
  for (let pg = 2; pg <= totalPages; pg++) {
    log(`   Đang tải trang ${pg}/${totalPages}...`);
    let pgData = null;
    for (let attempt = 1; attempt <= PAGE_RETRIES && !pgData; attempt++) {
      const navigated = await navigateToPage(getIframe(page), pg).catch(() => false);
      if (navigated) pgData = await waitForRows(page, { notFirstStt: prevFirstStt });
      if (!pgData) {
        log(`   ⚠ Trang ${pg} chưa tải được (lần ${attempt}/${PAGE_RETRIES})`);
        await page.waitForTimeout(2000 * attempt);
      }
    }
    if (!pgData) throw new Error(`Không tải được trang ${pg}/${totalPages} sau ${PAGE_RETRIES} lần thử`);

    log(`   Trang ${pg}: ${pgData.length} nhà cung cấp`);
    allData.push(...pgData);
    prevFirstStt = pgData[0].stt;
    totalPages = Math.max(totalPages, await getPaginationInfo(getIframe(page)).catch(() => totalPages));
  }

  log(`\n   📊 Tổng thu thập: ${allData.length} nhà cung cấp`);
  return { data: allData, expectedRecords: summary.totalRecords };
}

/**
 * Đối chiếu kết quả crawl. Trả về chuỗi lỗi nếu dữ liệu thiếu, null nếu đạt.
 * Nguồn là danh bạ tích luỹ, nên thu được ít hơn số site công bố (hoặc ít hơn CSV hiện có
 * khi không đọc được số site công bố) nghĩa là crawl bị cắt cụt.
 */
function validateCrawl({ collected, expectedRecords, existingCount }) {
  if (collected === 0) return 'Không thu thập được bản ghi nào';
  if (expectedRecords != null) {
    if (collected < expectedRecords) return `Thu được ${collected} < ${expectedRecords} bản ghi site công bố`;
    return null;
  }
  if (collected < existingCount) return `Không đọc được tổng số của site và thu được ${collected} < ${existingCount} bản ghi trong CSV`;
  return null;
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
(async () => {
  log('='.repeat(65));
  log('   BOT THU THẬP DANH SÁCH NHÀ CUNG CẤP NƯỚC NGOÀI - eTax VN');
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

  let crawl;
  try {
    crawl = await crawlAllContractors(page);
  } catch (err) {
    log(`\n[LỖI] ${err.message}`);
    console.error(err);
    await browser.close();
    process.exit(1);
  }
  await browser.close();

  // Khử trùng theo MST (giữ thứ tự xuất hiện) phòng khi site dịch trang giữa chừng
  const uniq = new Map();
  for (const c of crawl.data) if (!uniq.has(c.mst)) uniq.set(c.mst, c);
  const allContractors = Array.from(uniq.values());
  if (allContractors.length !== crawl.data.length) {
    log(`   ⚠ Phát hiện ${crawl.data.length - allContractors.length} bản ghi trùng MST, đã loại bỏ.`);
  }
  if (crawl.expectedRecords != null && crawl.expectedRecords < existingMap.size) {
    log(`   ⚠ Site công bố ${crawl.expectedRecords} < CSV hiện có ${existingMap.size} (site có thể đã xoá bản ghi).`);
  }

  const problem = validateCrawl({
    collected: allContractors.length,
    expectedRecords: crawl.expectedRecords,
    existingCount: existingMap.size,
  });
  if (problem) {
    log(`\n[LỖI] Dữ liệu thu thập không đầy đủ: ${problem}. Không ghi đè CSV/JSON.`);
    process.exit(1);
  }

  log('\n   Đang xử lý dữ liệu...');
  let records = [];

  if (MODE === 'full') {
    const finalMap = new Map();
    let updatedCount = 0;
    let newCount = 0;

    // 1. Khởi tạo danh sách bằng dữ liệu cũ
    for (const row of existingRows) {
      finalMap.set(row['Tax Code'], {
        'No.': '',
        'Tax Code': row['Tax Code'],
        'Provider Name': row['Provider Name'],
        'Issuance Date': row['Issuance Date'],
        'Issuance Time': row['Issuance Time'] || '',
        _orderIdx: parseInt(row['No.'], 10) || 0
      });
    }

    // 2. Duyệt qua dữ liệu mới để cập nhật tên hoặc thêm mới
    const N = allContractors.length;
    allContractors.forEach((c, index) => {
      const existing = finalMap.get(c.mst);
      if (existing) {
        let changed = false;
        const newName = c.ten;
        const newDate = formatDate(c.thoigian);
        const newTime = formatTime(c.thoigian);

        if (existing['Provider Name'] !== newName) {
          log(`   🔄 Cập nhật tên: ${c.mst} | "${existing['Provider Name']}" → "${newName}"`);
          existing['Provider Name'] = newName;
          changed = true;
        }
        if (existing['Issuance Date'] !== newDate) {
          log(`   📅 Cập nhật Ngày cấp: ${c.mst} | "${existing['Issuance Date']}" → "${newDate}"`);
          existing['Issuance Date'] = newDate;
          changed = true;
        }
        if (existing['Issuance Time'] !== newTime) {
          log(`   ⏰ Cập nhật Giờ cấp: ${c.mst} | "${existing['Issuance Time'] || '(trống)'}" → "${newTime}"`);
          existing['Issuance Time'] = newTime;
          changed = true;
        }
        if (changed) {
          updatedCount++;
        }
      } else {
        finalMap.set(c.mst, {
          'No.': '',
          'Tax Code': c.mst,
          'Provider Name': c.ten,
          'Issuance Date': formatDate(c.thoigian),
          'Issuance Time': formatTime(c.thoigian),
          _orderIdx: 1000000 + (N - index)
        });
        newCount++;
      }
    });

    records = Array.from(finalMap.values());
    log(`   📝 Tổng: ${records.length} | Thêm mới: ${newCount} | Tên được cập nhật: ${updatedCount}`);

  } else {
    // APPEND
    for (const row of existingRows) {
      records.push({ 'No.': '', 'Tax Code': row['Tax Code'], 'Provider Name': row['Provider Name'], 'Issuance Date': row['Issuance Date'], 'Issuance Time': row['Issuance Time'] || '', _orderIdx: parseInt(row['No.'], 10) || 0 });
    }
    let newCount = 0, skipCount = 0;
    const N = allContractors.length;
    allContractors.forEach((c, index) => {
      if (existingMap.has(c.mst)) { skipCount++; return; }
      records.push({ 'No.': '', 'Tax Code': c.mst, 'Provider Name': c.ten, 'Issuance Date': formatDate(c.thoigian), 'Issuance Time': formatTime(c.thoigian), _orderIdx: 1000000 + (N - index) });
      existingMap.set(c.mst, true);
      newCount++;
    });
    log(`   ➕ Nhà cung cấp mới: ${newCount}`);
    log(`   ⏭️  Đã tồn tại (bỏ qua): ${skipCount}`);
  }

  saveCsv(records);
  convertCsvToJson(records);

  log('');
  log('='.repeat(65));
  log('   HOÀN THÀNH!');
  log('='.repeat(65));
})();
