#!/usr/bin/env python3
"""
Bot thu thập danh sách nhà thầu nước ngoài được cấp MST từ eTax Vietnam.
Website: https://etaxvn.gdt.gov.vn/nccnn/Request

Sử dụng Playwright (headless Chromium) để xử lý JavaScript + iframe.

Chế độ chạy:
    python3 etax_crawler.py              # Mặc định: --append (chỉ bổ sung mới)
    python3 etax_crawler.py --append     # Bổ sung nhà thầu mới, giữ nguyên dữ liệu cũ
    python3 etax_crawler.py --full       # Cập nhật toàn bộ (ghi đè, cập nhật tên nếu đổi)

Output:
    registered_contractors.csv   — Danh sách nhà thầu (CSV)
    registered_contractors.json  — Bản sao JSON (tự động tạo sau mỗi lần chạy)
"""

import argparse
import asyncio
import csv
import json
import os
import sys
from datetime import datetime

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Đang cài đặt playwright...")
    os.system("pip install playwright && playwright install chromium")
    from playwright.async_api import async_playwright


# ============ CẤU HÌNH ============
BASE_URL = "https://etaxvn.gdt.gov.vn/nccnn/Request"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(SCRIPT_DIR, "registered_contractors.csv")
JSON_FILE = os.path.join(SCRIPT_DIR, "registered_contractors.json")
CSV_HEADERS = ["No.", "Tax Code", "Company Name", "Issuance Date"]
TIMEOUT = 60000  # 60s


# ============ HELPER FUNCTIONS ============
def format_date(datetime_str):
    """Convert 'DD/MM/YYYY HH:MM:SS' → 'DD/MM/YYYY'."""
    datetime_str = datetime_str.strip()
    for fmt in ["%d/%m/%Y %H:%M:%S", "%d/%m/%Y"]:
        try:
            return datetime.strptime(datetime_str, fmt).strftime("%d/%m/%Y")
        except ValueError:
            continue
    return datetime_str


def parse_date_for_sort(date_str):
    """Parse DD/MM/YYYY for sorting."""
    try:
        return datetime.strptime(date_str, "%d/%m/%Y")
    except ValueError:
        return datetime.min


def load_existing_csv():
    """Load file CSV hiện tại. Trả về dict {tax_code: row} và list rows."""
    existing = {}  # tax_code → row dict
    rows = []
    if os.path.exists(CSV_FILE):
        with open(CSV_FILE, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tc = row.get("Tax Code", "").strip()
                if tc:
                    existing[tc] = row
                    rows.append(row)
        print(f"   📋 File CSV hiện có: {len(existing)} nhà thầu.")
    else:
        print("   📋 File CSV chưa tồn tại, sẽ tạo mới.")
    return existing, rows


def save_csv(records):
    """Lưu records vào CSV, sắp xếp theo Issuance Date tăng dần, đánh lại No."""
    records.sort(key=lambda r: parse_date_for_sort(r["Issuance Date"]))
    for i, rec in enumerate(records, 1):
        rec["No."] = str(i)
    with open(CSV_FILE, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(records)
    print(f"   💾 Đã lưu {len(records)} nhà thầu → {CSV_FILE}")


def convert_csv_to_json():
    """Đọc CSV và xuất bản sao JSON (tương tự logic PowerShell Import-Csv | ConvertTo-Json)."""
    if not os.path.exists(CSV_FILE):
        print("   ⚠ Không tìm thấy file CSV để convert.")
        return
    rows = []
    with open(CSV_FILE, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(dict(row))  # giữ nguyên tất cả cột
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"   💾 Đã xuất JSON → {JSON_FILE}")


# ============ BROWSER DATA EXTRACTION ============
async def extract_table_data(frame):
    """Trích xuất dữ liệu nhà thầu từ bảng HTML trong iframe."""
    return await frame.evaluate("""
        () => {
            const results = [];
            for (const table of document.querySelectorAll('table')) {
                for (const tr of table.querySelectorAll('tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length === 4) {
                        const stt = tds[0].textContent.trim();
                        const mst = tds[1].textContent.trim();
                        const ten = tds[2].textContent.trim();
                        const thoigian = tds[3].textContent.trim();
                        if (/^\\d+$/.test(stt) && /^\\d{7,}$/.test(mst)) {
                            results.push({mst, ten, thoigian});
                        }
                    }
                }
            }
            return results;
        }
    """)


async def get_pagination_info(frame):
    """Lấy thông tin phân trang."""
    return await frame.evaluate("""
        () => {
            let maxPage = 1;
            for (const link of document.querySelectorAll('a[href*="pn="]')) {
                const m = link.href.match(/pn=(\\d+)/);
                if (m) { const pn = parseInt(m[1]); if (pn > maxPage) maxPage = pn; }
            }
            return maxPage;
        }
    """)


async def navigate_to_page(frame, page_num):
    """Click link sang trang page_num trong iframe."""
    return await frame.evaluate("""
        (pageNum) => {
            for (const link of document.querySelectorAll('a[href*="pn="]')) {
                const m = link.href.match(/pn=(\\d+)/);
                if (m && parseInt(m[1]) === pageNum) { link.click(); return true; }
            }
            return false;
        }
    """, page_num)


def get_iframe(page):
    """Lấy iframe 'mainframe' từ page."""
    iframe = page.frame(name="mainframe")
    if not iframe:
        for f in page.frames:
            if "mainframe" in (f.name or ""):
                return f
    return iframe


# ============ MAIN CRAWLER ============
async def crawl_all_contractors(page):
    """Thu thập toàn bộ nhà thầu từ website. Trả về list[dict]."""
    all_data = []

    # Step 1: Load trang chủ
    print("[1/4] Đang tải trang chủ...")
    await page.goto(BASE_URL, wait_until="networkidle", timeout=TIMEOUT)
    await page.wait_for_load_state("networkidle")
    await asyncio.sleep(3)
    print("   ✓ Trang chủ đã tải xong")

    # Step 2: Click "LIST OF REGISTERED FOREIGN PROVIDERS"
    print("[2/4] Đang mở trang tra cứu nhà thầu...")
    link = page.locator('a[href*="corpTCuuTTinMSTProc"][target="mainframe"]').first
    if await link.count() > 0:
        await link.click()
        await asyncio.sleep(3)
        print("   ✓ Đã mở trang tra cứu")
    else:
        print("   ⚠ Không tìm thấy link tra cứu")

    iframe = get_iframe(page)
    if not iframe:
        print("   ✗ Không thể truy cập iframe!")
        sys.exit(1)
    print("   ✓ Đã truy cập iframe")
    await asyncio.sleep(3)

    # Step 3: Click Search (empty = tất cả)
    print("[3/4] Đang tìm kiếm toàn bộ nhà thầu...")
    search_selectors = [
        'input[value*="Search"]', 'input[value*="Tra cứu"]',
        'a:has-text("Search")', 'a:has-text("Tra cứu")',
        'button:has-text("Search")', 'input[type="submit"]',
    ]
    for sel in search_selectors:
        try:
            loc = iframe.locator(sel).first
            if await loc.is_visible(timeout=2000):
                await loc.click()
                print(f"   ✓ Đã nhấn nút tìm kiếm")
                break
        except Exception:
            continue
    await asyncio.sleep(5)

    # Step 4: Thu thập tất cả các trang
    print("[4/4] Đang thu thập dữ liệu...")
    iframe = get_iframe(page)

    page1 = await extract_table_data(iframe)
    total_pages = await get_pagination_info(iframe)
    print(f"   Tổng số trang: {total_pages}")
    print(f"   Trang 1: {len(page1)} nhà thầu")
    all_data.extend(page1)

    for pg in range(2, total_pages + 1):
        print(f"   Đang tải trang {pg}/{total_pages}...")
        iframe = get_iframe(page)
        if await navigate_to_page(iframe, pg):
            await asyncio.sleep(4)
            iframe = get_iframe(page)
            pg_data = await extract_table_data(iframe)
            print(f"   Trang {pg}: {len(pg_data)} nhà thầu")
            all_data.extend(pg_data)
        else:
            print(f"   ⚠ Không thể chuyển đến trang {pg}")

    print(f"\n   📊 Tổng thu thập: {len(all_data)} nhà thầu")
    return all_data


async def run(mode="append"):
    print("=" * 65)
    print("   BOT THU THẬP DANH SÁCH NHÀ THẦU NƯỚC NGOÀI - eTax VN")
    print(f"   Chế độ: {'BỔ SUNG (append)' if mode == 'append' else 'CẬP NHẬT TOÀN BỘ (full)'}")
    print("=" * 65)
    print()

    # Load dữ liệu cũ
    existing_map, existing_rows = load_existing_csv()

    # Mở trình duyệt & thu thập
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="vi-VN",
        )
        page = await ctx.new_page()
        try:
            all_contractors = await crawl_all_contractors(page)
        except Exception as e:
            print(f"\n[LỖI] {e}")
            import traceback; traceback.print_exc()
            await browser.close()
            sys.exit(1)
        await browser.close()

    if not all_contractors:
        print("\n   ⚠ Không có dữ liệu để lưu.")
        return

    # ---- Xử lý theo chế độ ----
    print("\n   Đang xử lý dữ liệu...")

    if mode == "full":
        # FULL: Ghi đè toàn bộ bằng dữ liệu mới nhất từ web
        records = []
        seen = set()
        for c in all_contractors:
            mst = c["mst"]
            if mst in seen:
                continue
            seen.add(mst)
            records.append({
                "No.": "",
                "Tax Code": mst,
                "Company Name": c["ten"],
                "Issuance Date": format_date(c["thoigian"]),
            })

        # So sánh với dữ liệu cũ để báo cáo thay đổi
        updated = 0
        for rec in records:
            tc = rec["Tax Code"]
            if tc in existing_map:
                old_name = existing_map[tc].get("Company Name", "")
                if old_name and old_name != rec["Company Name"]:
                    print(f"   🔄 Cập nhật tên: {tc} | \"{old_name}\" → \"{rec['Company Name']}\"")
                    updated += 1

        print(f"   📝 Tổng: {len(records)} | Tên được cập nhật: {updated}")

    else:
        # APPEND: Giữ dữ liệu cũ, chỉ thêm mới
        records = []
        for row in existing_rows:
            records.append({
                "No.": "",
                "Tax Code": row["Tax Code"],
                "Company Name": row["Company Name"],
                "Issuance Date": row["Issuance Date"],
            })

        new_count = skip_count = 0
        for c in all_contractors:
            mst = c["mst"]
            if mst in existing_map:
                skip_count += 1
                continue
            records.append({
                "No.": "",
                "Tax Code": mst,
                "Company Name": c["ten"],
                "Issuance Date": format_date(c["thoigian"]),
            })
            existing_map[mst] = True  # đánh dấu đã thêm
            new_count += 1

        print(f"   ➕ Nhà thầu mới: {new_count}")
        print(f"   ⏭️  Đã tồn tại (bỏ qua): {skip_count}")

    # Lưu CSV
    save_csv(records)

    # Convert sang JSON
    convert_csv_to_json()

    print()
    print("=" * 65)
    print("   HOÀN THÀNH!")
    print("=" * 65)


# ============ CLI ============
def main():
    parser = argparse.ArgumentParser(
        description="Thu thập danh sách nhà thầu nước ngoài từ eTax Vietnam"
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Cập nhật toàn bộ: ghi đè dữ liệu cũ bằng dữ liệu mới nhất (cập nhật cả tên nhà thầu nếu thay đổi)",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        default=True,
        help="Chỉ bổ sung nhà thầu mới, giữ nguyên dữ liệu cũ (mặc định)",
    )
    args = parser.parse_args()

    mode = "full" if args.full else "append"
    asyncio.run(run(mode))


if __name__ == "__main__":
    main()
