# FCT ID Lookup

**Tra cứu danh sách nhà cung cấp Nước ngoài đã đăng ký Mã số Thuế tại Việt Nam**

Công cụ gồm hai thành phần chính:
- **Web app tĩnh** – giao diện tra cứu, tìm kiếm và lọc danh sách nhà cung cấp ngay trên trình duyệt.
- **Crawler** – bot tự động thu thập dữ liệu từ cổng eTax VN (Cục Thuế) và lưu về dạng CSV + JSON.

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Tính năng Web App](#tính-năng-web-app)
- [Bảo mật & Accessibility](#bảo-mật--accessibility)
- [Tính năng Crawler](#tính-năng-crawler)
- [Tự động hóa (GitHub Actions)](#tự-động-hóa-github-actions)
- [Cài đặt & Chạy thủ công](#cài-đặt--chạy-thủ-công)
- [Định dạng dữ liệu](#định-dạng-dữ-liệu)
- [Giấy phép](#giấy-phép)

---

## Tổng quan

Nguồn dữ liệu: [eTax VN – Cục Thuế](https://etaxvn.gdt.gov.vn/nccnn/Request)

Dự án lấy dữ liệu từ cổng eTax VN, lưu trữ dưới dạng tĩnh (`registered_contractors.json` và `registered_contractors.csv`), và phục vụ tra cứu thông qua một trang HTML thuần – không cần backend hay database.

---

## Cấu trúc dự án

```
fct-id-lookup/
├── index.html                    # Giao diện web app chính
├── css/
│   └── style.css                 # Stylesheet (theme, layout, components, responsive)
├── js/
│   ├── theme-init.js             # Inline theme detection – chạy trước CSS để tránh FOUC
│   └── app.js                    # Logic frontend (i18n, tìm kiếm, lọc, phân trang, theme)
├── crawler.js                    # Bot thu thập dữ liệu từ eTax VN (Node.js + Playwright)
├── registered_contractors.json   # Dữ liệu nhà cung cấp (nguồn chính cho web app)
├── registered_contractors.csv    # Dữ liệu nhà cung cấp dạng CSV (Excel-friendly, UTF-8 BOM)
├── package.json                  # Cấu hình npm & scripts
└── .github/
    └── workflows/
        └── crawler.yml           # GitHub Actions: tự động crawl & commit dữ liệu
```

---

## Tính năng Web App

### Giao diện & Trải nghiệm

| Tính năng | Mô tả |
|---|---|
| **Dark / Light Mode tự động** | Tự động chuyển sang Dark Mode lúc 19:00 và Light Mode lúc 06:00 (GMT+7). Người dùng có thể ghi đè thủ công bằng nút trên thanh tiêu đề – lựa chọn được lưu vào `sessionStorage` nên chỉ tồn tại trong phiên tab hiện tại (giữ nguyên khi refresh, nhưng mỗi lần load trang mới cơ chế tự động theo giờ sẽ được áp dụng lại). |
| **Chống FOUC** | Script [`theme-init.js`](js/theme-init.js) chạy đồng bộ trong `<head>` trước khi CSS render, đảm bảo theme đúng ngay từ frame đầu tiên mà không có hiện tượng nhấp nháy. |
| **Đa ngôn ngữ (i18n)** | Hỗ trợ chuyển đổi Tiếng Việt ↔ English qua nút toggle trên thanh tiêu đề. Ngôn ngữ được lưu vào `localStorage` và áp dụng cho toàn bộ giao diện, bao gồm `aria-label`, `placeholder`, `title`, và `document.title`. |
| **Skeleton loading** | Hiển thị placeholder animation trong khi đang tải dữ liệu JSON. |
| **Toast notification** | Thông báo nhỏ ở góc màn hình cho các lỗi hệ thống, tự động biến mất sau 3 giây. |
| **Responsive** | Giao diện tương thích cả desktop lẫn thiết bị di động. Trên mobile, bảng chuyển thành layout card với label cho từng ô dữ liệu. |

### Thống kê tổng quan (Stats Cards)

Ba thẻ thống kê hiển thị ngay trên đầu trang:

| Thẻ | Nội dung |
|---|---|
| **Số lượng nhà cung cấp đã cấp mã** | Tổng số bản ghi trong danh sách. |
| **Cấp mới trong năm [năm]** | Số nhà cung cấp được cấp mã trong năm hiện tại. |
| **Thông tin cấp mới nhất** | Ngày cấp mã số thuế mới nhất trong dữ liệu. |

### Tìm kiếm

- Ô tìm kiếm hỗ trợ tìm theo **tên nhà cung cấp** hoặc **mã số thuế** (không phân biệt hoa/thường).
- **Debounce 300ms** – tránh gọi lại quá nhiều khi người dùng gõ nhanh.
- Nút **Xóa (×)** xuất hiện khi có nội dung trong ô tìm kiếm để xóa nhanh.
- Số kết quả tìm được hiển thị theo thời gian thực.

### Lọc theo loại

Bộ lọc dropdown **Loại** cho phép thu hẹp kết quả:

| Tùy chọn | Điều kiện lọc |
|---|---|
| Tất cả | Không lọc |
| Công ty | MST bắt đầu bằng **`9`** |
| Cá nhân | MST bắt đầu bằng **`8`** |

### Sắp xếp

Hỗ trợ sắp xếp theo hai cách:

1. **Click vào tiêu đề cột** trên bảng (desktop) – click lần đầu: tăng dần, click lại: giảm dần (riêng cột STT luôn hiển thị theo thứ tự tăng dần cố định).
2. **Dropdown sắp xếp** (responsive, hoạt động trên cả mobile).

| Cột | Khóa sắp xếp |
|---|---|
| STT | *Không hỗ trợ sắp xếp (STT luôn hiển thị tăng dần theo danh sách hiển thị)* |
| Mã số thuế | A→Z / Z→A |
| Tên nhà cung cấp | A→Z / Z→A |
| Ngày cấp | Mới nhất / Cũ nhất (sử dụng ngày và giờ cấp - Issuance Time để sắp xếp chính xác thứ tự mới cũ) |

### Bảng dữ liệu

Bảng hiển thị 4 cột:

| Cột | Mô tả |
|---|---|
| STT | Số thứ tự hiển thị tuần tự tăng dần (không phục vụ sắp xếp) |
| Mã số thuế | Mã số thuế FCT của nhà cung cấp |
| Tên nhà cung cấp | Tên nhà cung cấp nước ngoài |
| Ngày cấp | Ngày cấp mã số thuế (định dạng `DD/MM/YYYY`) |

### Phân trang

- Hiển thị **50 bản ghi / trang**.
- Thanh phân trang với nút **Trước / Sau** và tối đa **5 nút số trang** (kèm dấu `...` khi cần).
- Thông tin `[từ] - [đến] / [tổng]` hiển thị ngay trên thanh phân trang.
- Tự động về trang 1 khi thay đổi từ khóa tìm kiếm hoặc bộ lọc.

---

## Bảo mật & Accessibility

### Bảo mật

| Biện pháp | Chi tiết |
|---|---|
| **Content Security Policy** | `<meta http-equiv="Content-Security-Policy">` giới hạn `script-src 'self'`, chặn inline script và nguồn ngoài trừ Google Fonts. |
| **XSS Prevention** | Hàm `escapeHtml()` xử lý đầy đủ 5 ký tự nguy hiểm (`&`, `<`, `>`, `"`, `'`) cho mọi dữ liệu hiển thị từ JSON. |
| **Data Validation** | Dữ liệu JSON được kiểm tra cấu trúc (`Array.isArray`) trước khi xử lý, ngăn crash khi file bị hỏng. |
| **External Links** | Tất cả liên kết ngoài đều có `rel="noopener noreferrer"` để ngăn tab-napping và bảo vệ referrer. |

### Accessibility (WCAG 2.1)

| Tiêu chí | Chi tiết |
|---|---|
| **Tương phản văn bản** | `--text-muted` đạt tỷ lệ ≥ 6:1 trên cả Light và Dark Mode, vượt WCAG AA cho cỡ chữ nhỏ (0.85rem). |
| **Focus Visible** | Tất cả phần tử tương tác (nút, input, dropdown, phân trang) đều có `:focus-visible` outline theo WCAG 2.4.7. |
| **ARIA Labels** | `aria-label` được cập nhật động khi chuyển ngôn ngữ cho các nút chức năng. |
| **Dark Mode Dropdown** | Mũi tên SVG của dropdown sử dụng màu riêng cho Dark Mode (`#aaa`) để đảm bảo tương phản ≥ 6:1. |
| **Semantic HTML** | Sử dụng `<header>`, `<main>`, `<footer>`, `<section>`, `<table>` đúng ngữ nghĩa, với `aria-label` cho các section. |

---

## Tính năng Crawler

File: [`crawler.js`](crawler.js)

Bot sử dụng **Playwright** (Chromium headless) để điều hướng và thu thập dữ liệu từ cổng eTax VN.

### Hai chế độ chạy

| Chế độ | Lệnh | Hành vi |
|---|---|---|
| **Bổ sung (append)** | `npm run crawl` | Chỉ thêm nhà cung cấp mới chưa có trong file CSV. Bỏ qua các MST đã tồn tại. |
| **Cập nhật toàn bộ (full)** | `npm run crawl:full` | Duyệt toàn bộ danh sách, cập nhật tên nếu thay đổi, thêm mới nếu chưa có. |

### Quy trình thu thập

1. **Tải trang chủ** eTax VN (`etaxvn.gdt.gov.vn/nccnn/Request`).
2. **Điều hướng** đến trang tra cứu nhà cung cấp nước ngoài trong iframe `mainframe`.
3. **Kích hoạt tìm kiếm** – thử nhiều selector để nhấn nút "Search / Tra cứu".
4. **Thu thập dữ liệu** – duyệt qua **toàn bộ các trang kết quả** (pagination), trích xuất `MST`, `Tên`, `Ngày cấp` từ bảng HTML.
5. **Xử lý & merge** dữ liệu mới với dữ liệu cũ theo chế độ append hoặc full.
6. **Xuất file** CSV (UTF-8 BOM, tương thích Excel) và JSON.

### Xử lý dữ liệu

- **Đọc CSV hiện có**: hỗ trợ parse CSV phức tạp (trường có dấu phẩy, nháy kép, xuống dòng) và hỗ trợ cơ chế tự động migrate các dữ liệu cũ có trường `Company Name` sang trường mới `Provider Name`.
- **Sắp xếp**: danh sách cuối cùng được sắp xếp theo `Ngày cấp` và `Giờ cấp` (Issuance Time) tăng dần trước khi lưu.
- **Đánh số lại STT** sau mỗi lần lưu (dữ liệu STT gốc chỉ phục vụ kiểm tra tính toàn vẹn integrity).
- **Định dạng ngày và giờ**: chuẩn hóa ngày cấp thành `DD/MM/YYYY` và trích xuất giờ cấp thành `HH:MM:SS` lưu vào cột `Issuance Time`.
- **User Agent**: giả lập Chrome 120 trên Windows để tránh bị chặn.

---

## Tự động hóa (GitHub Actions)

File: [`.github/workflows/crawler.yml`](.github/workflows/crawler.yml)

### Lịch chạy tự động

| Lịch | Chế độ |
|---|---|
| Hàng ngày lúc **00:00 UTC** (từ ngày 2 đến 31) | `append` – chỉ bổ sung nhà cung cấp mới |
| Ngày **1 hàng tháng** lúc 00:00 UTC | `full` – cập nhật toàn bộ, đồng bộ tên |

### Chạy thủ công (workflow_dispatch)

Có thể kích hoạt thủ công từ tab **Actions** trên GitHub với lựa chọn chế độ `append` hoặc `full`.

### Luồng tự động

1. Checkout repo.
2. Cài Node.js 24 + `npm ci`.
3. Cài Chromium qua `npx playwright install --with-deps chromium`.
4. Chạy crawler theo lịch/chế độ được chọn.
5. Kiểm tra thay đổi (`git status`).
6. Nếu có thay đổi: commit `registered_contractors.json` và `registered_contractors.csv` với message `Auto-update contractors data 🤖` rồi push.

---

## Cài đặt & Chạy thủ công

### Yêu cầu

- Node.js ≥ 18
- npm

### Cài đặt

```bash
npm install
npx playwright install chromium
```

### Chạy crawler

```bash
# Chế độ bổ sung (mặc định) – chỉ thêm mới
npm run crawl

# Chế độ cập nhật toàn bộ – đồng bộ tên, thêm mới
npm run crawl:full
```

### Chạy web app

Vì là trang tĩnh, chỉ cần mở `index.html` bằng bất kỳ static file server nào:

```bash
# Ví dụ với npx serve
npx serve .

# Hoặc với Python
python -m http.server 8080
```

> **Lưu ý:** Mở trực tiếp `index.html` bằng `file://` có thể bị lỗi CORS khi fetch JSON. Nên dùng local server.

---

## Định dạng dữ liệu

### `registered_contractors.json`

```json
[
  {
    "No.": "1",
    "Tax Code": "9000000001",
    "Provider Name": "ABC Foreign Provider Co., Ltd.",
    "Issuance Date": "01/01/2020",
    "Issuance Time": "10:30:15"
  }
]
```

### `registered_contractors.csv`

```csv
No.,Tax Code,Provider Name,Issuance Date,Issuance Time
1,9000000001,"ABC Foreign Provider Co., Ltd.",01/01/2020,10:30:15
```

- Encoding: **UTF-8 with BOM** (tương thích Microsoft Excel).
- Dấu phân cách: dấu phẩy (`,`).
- Trường có chứa dấu phẩy hoặc nháy kép được bao trong dấu nháy kép (`"`).

---

## Giấy phép

[GPL-3.0](LICENSE)
