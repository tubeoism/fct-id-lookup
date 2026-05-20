# FCT ID Lookup

**Tra cứu danh sách Nhà thầu Nước ngoài đã đăng ký Mã số Thuế tại Việt Nam**

Công cụ gồm hai thành phần chính:
- **Web app tĩnh** – giao diện tra cứu, tìm kiếm và lọc danh sách nhà thầu ngay trên trình duyệt.
- **Crawler** – bot tự động thu thập dữ liệu từ cổng eTax VN (Tổng cục Thuế) và lưu về dạng CSV + JSON.

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Tính năng Web App](#tính-năng-web-app)
- [Tính năng Crawler](#tính-năng-crawler)
- [Tự động hóa (GitHub Actions)](#tự-động-hóa-github-actions)
- [Cài đặt & Chạy thủ công](#cài-đặt--chạy-thủ-công)
- [Định dạng dữ liệu](#định-dạng-dữ-liệu)
- [Giấy phép](#giấy-phép)

---

## Tổng quan

Nguồn dữ liệu: [eTax VN – Tổng cục Thuế](https://etaxvn.gdt.gov.vn/nccnn/Request)

Dự án lấy dữ liệu từ cổng eTax VN, lưu trữ dưới dạng tĩnh (`registered_contractors.json` và `registered_contractors.csv`), và phục vụ tra cứu thông qua một trang HTML thuần – không cần backend hay database.

---

## Cấu trúc dự án

```
fct-id-lookup/
├── index.html                    # Giao diện web app chính
├── css/
│   └── style.css                 # Toàn bộ stylesheet (theme, layout, components)
├── js/
│   └── app.js                    # Logic frontend (tìm kiếm, lọc, phân trang, theme)
├── crawler.js                    # Bot thu thập dữ liệu từ eTax VN (Node.js + Playwright)
├── registered_contractors.json   # Dữ liệu nhà thầu (nguồn chính cho web app)
├── registered_contractors.csv    # Dữ liệu nhà thầu dạng CSV (Excel-friendly, UTF-8 BOM)
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
| **Dark / Light mode** | Chuyển đổi thủ công bằng nút trên thanh tiêu đề. Tự động chuyển sang dark mode từ 19:00 đến 06:00 nếu người dùng chưa can thiệp. Trạng thái được lưu vào `localStorage`. |
| **Đồng hồ thời gian thực** | Hiển thị giờ hiện tại (định dạng `vi-VN`) trên thanh tiêu đề, cập nhật mỗi giây. |
| **Skeleton loading** | Hiển thị placeholder animation trong khi đang tải dữ liệu JSON. |
| **Toast notification** | Thông báo nhỏ ở góc màn hình cho các sự kiện (tải lỗi, đổi theme…), tự động biến mất sau 3 giây. |
| **Responsive** | Giao diện tương thích cả desktop lẫn thiết bị di động. |

### Thống kê tổng quan (Stats Cards)

Ba thẻ thống kê hiển thị ngay trên đầu trang:

| Thẻ | Nội dung |
|---|---|
| **Tổng nhà thầu** | Tổng số bản ghi trong danh sách. |
| **Đăng ký năm [năm hiện tại]** | Số nhà thầu được cấp mã trong năm hiện tại. |
| **Cập nhật lần cuối** | Ngày cấp mã số thuế mới nhất trong dữ liệu (ước lượng thời điểm cập nhật). |

### Tìm kiếm

- Ô tìm kiếm hỗ trợ tìm theo **tên công ty** hoặc **mã số thuế** (không phân biệt hoa/thường).
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

1. **Click vào tiêu đề cột** trên bảng (desktop) – click lần đầu: tăng dần, click lại: giảm dần.
2. **Dropdown sắp xếp** (responsive, hoạt động trên cả mobile).

| Cột | Khóa sắp xếp |
|---|---|
| STT | Số thứ tự tăng/giảm |
| Mã số thuế | A→Z / Z→A |
| Tên công ty | A→Z / Z→A |
| Ngày cấp | Mới nhất / Cũ nhất |

### Bảng dữ liệu

Bảng hiển thị 4 cột:

| Cột | Mô tả |
|---|---|
| STT | Số thứ tự theo danh sách gốc |
| Mã số thuế | Mã số thuế FCT của nhà thầu |
| Tên công ty | Tên nhà thầu nước ngoài |
| Ngày cấp | Ngày cấp mã số thuế (định dạng `DD/MM/YYYY`) |

### Phân trang

- Hiển thị **50 bản ghi / trang**.
- Thanh phân trang với nút **Trước / Sau** và tối đa **5 nút số trang** (kèm dấu `...` khi cần).
- Thông tin `[từ] - [đến] / [tổng]` hiển thị ngay trên thanh phân trang.
- Tự động về trang 1 khi thay đổi từ khóa tìm kiếm hoặc bộ lọc.

---

## Tính năng Crawler

File: [`crawler.js`](crawler.js)

Bot sử dụng **Playwright** (Chromium headless) để điều hướng và thu thập dữ liệu từ cổng eTax VN.

### Hai chế độ chạy

| Chế độ | Lệnh | Hành vi |
|---|---|---|
| **Bổ sung (append)** | `npm run crawl` | Chỉ thêm nhà thầu mới chưa có trong file CSV. Bỏ qua các MST đã tồn tại. |
| **Cập nhật toàn bộ (full)** | `npm run crawl:full` | Duyệt toàn bộ danh sách, cập nhật tên nếu thay đổi, thêm mới nếu chưa có. |

### Quy trình thu thập

1. **Tải trang chủ** eTax VN (`etaxvn.gdt.gov.vn/nccnn/Request`).
2. **Điều hướng** đến trang tra cứu nhà thầu nước ngoài trong iframe `mainframe`.
3. **Kích hoạt tìm kiếm** – thử nhiều selector để nhấn nút "Search / Tra cứu".
4. **Thu thập dữ liệu** – duyệt qua **toàn bộ các trang kết quả** (pagination), trích xuất `MST`, `Tên`, `Ngày cấp` từ bảng HTML.
5. **Xử lý & merge** dữ liệu mới với dữ liệu cũ theo chế độ append hoặc full.
6. **Xuất file** CSV (UTF-8 BOM, tương thích Excel) và JSON.

### Xử lý dữ liệu

- **Đọc CSV hiện có**: hỗ trợ parse CSV phức tạp (trường có dấu phẩy, nháy kép, xuống dòng).
- **Sắp xếp**: danh sách cuối cùng được sắp xếp theo `Ngày cấp` tăng dần trước khi lưu.
- **Đánh số lại STT** sau mỗi lần lưu.
- **Định dạng ngày**: chuẩn hóa `DD/MM/YYYY HH:MM:SS` → `DD/MM/YYYY`.
- **User Agent**: giả lập Chrome 120 trên Windows để tránh bị chặn.

---

## Tự động hóa (GitHub Actions)

File: [`.github/workflows/crawler.yml`](.github/workflows/crawler.yml)

### Lịch chạy tự động

| Lịch | Chế độ |
|---|---|
| Hàng ngày lúc **00:00 UTC** (từ ngày 2 đến 31) | `append` – chỉ bổ sung nhà thầu mới |
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
    "Company Name": "ABC Foreign Contractor Co., Ltd.",
    "Issuance Date": "01/01/2020"
  }
]
```

### `registered_contractors.csv`

```csv
No.,Tax Code,Company Name,Issuance Date
1,9000000001,"ABC Foreign Contractor Co., Ltd.",01/01/2020
```

- Encoding: **UTF-8 with BOM** (tương thích Microsoft Excel).
- Dấu phân cách: dấu phẩy (`,`).
- Trường có chứa dấu phẩy hoặc nháy kép được bao trong dấu nháy kép (`"`).

---

## Giấy phép

[GPL-3.0](LICENSE)
