/**
 * theme-init.js – Chạy trước khi CSS được render để ngăn FOUC (Flash of Unstyled Content).
 * Đặt data-theme dựa trên giờ GMT+7 hoặc lựa chọn thủ công đã lưu.
 * Lựa chọn thủ công dùng sessionStorage: giữ nguyên khi refresh (F5) trong cùng
 * tab, nhưng bị bỏ qua ở mỗi lần load trang mới (tab mới / phiên mới) để cơ chế
 * tự động theo giờ được áp dụng lại.
 */
(function () {
  try {
    var manual = sessionStorage.getItem('fct_manual_theme');
    if (manual === 'dark' || manual === 'light') {
      document.documentElement.setAttribute('data-theme', manual);
      return;
    }
    var hour = parseInt(new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: 'numeric',
      hour12: false
    }), 10);
    document.documentElement.setAttribute('data-theme',
      (hour >= 19 || hour < 6) ? 'dark' : 'light'
    );
  } catch (e) {
    // Fallback an toàn: dark mode
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
