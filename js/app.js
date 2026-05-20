/**
 * app.js – Frontend logic cho FCT ID Lookup (Static Version)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Theme Helper (GMT+7 Auto-switching) ──────────────────────────────────
  function applyAutoTheme() {
    const manualTheme = localStorage.getItem('fct_manual_theme');
    if (manualTheme) {
      document.documentElement.setAttribute('data-theme', manualTheme);
      return;
    }
    const hour = parseInt(new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: 'numeric',
      hour12: false
    }), 10);
    const targetTheme = (hour >= 19 || hour < 6) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', targetTheme);
  }

  applyAutoTheme();
  const _autoThemeInterval = setInterval(applyAutoTheme, 10000);

  // ─── DOM Elements ──────────────────────────────────────────────────────────
  const els = {
    themeBtn: document.getElementById('theme-toggle-btn'),
    langBtn: document.getElementById('lang-toggle-btn'),
    langText: document.getElementById('lang-text'),

    // Stats
    statTotal: document.getElementById('stat-total-val'),
    statYear: document.getElementById('stat-year-val'),
    statCurrentYear: document.getElementById('stat-current-year'),
    statUpdated: document.getElementById('stat-updated-val'),

    // Search & Filter
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    resultsCount: document.getElementById('results-count'),
    typeSelect: document.getElementById('type-select'),
    sortSelect: document.getElementById('sort-select'),

    // Table & Pagination
    tableBody: document.getElementById('contractor-body'),
    pagBar: document.getElementById('pagination-bar'),
    pagPrev: document.getElementById('pag-prev'),
    pagNext: document.getElementById('pag-next'),
    pagPages: document.getElementById('pag-pages'),
    pagInfo: document.getElementById('pag-info'),
    thSortables: document.querySelectorAll('th[data-sort]'),

    footerYear: document.getElementById('footer-year'),
    toastContainer: document.getElementById('toast-container')
  };

  // ─── Translations & State ──────────────────────────────────────────────────
  const translations = {
    vi: {
      app_title: "Tra cứu MST nhà thầu nước ngoài",
      app_subtitle: "eTax VN – Cục Thuế",
      stat_total_label: "Số lượng nhà thầu đã cấp mã",
      stat_year_label: "Cấp mới trong năm ",
      stat_updated_label: "Thông tin cấp mới nhất",
      stat_none: "Chưa có",
      search_placeholder: "Tìm theo tên nhà thầu hoặc mã số thuế...",
      search_clear: "Xóa tìm kiếm",
      label_type: "Loại:",
      label_sort: "Sắp xếp:",
      opt_all: "Tất cả",
      opt_company: "Công ty",
      opt_individual: "Cá nhân",
      opt_date_asc: "Cũ nhất",
      opt_date_desc: "Mới nhất",
      opt_name_asc: "Tên A→Z",
      opt_name_desc: "Tên Z→A",
      opt_tax_asc: "MST A→Z",
      opt_tax_desc: "MST Z→A",
      results_count: "Hiển thị {count} kết quả",
      results_loading: "Đang tải...",
      th_no: "STT",
      th_tax: "Mã số thuế",
      th_name: "Tên nhà thầu",
      th_date: "Ngày cấp",
      empty_no_match: "Không tìm thấy kết quả phù hợp",
      empty_error: "Không thể tải dữ liệu. Vui lòng kiểm tra lại file 'registered_contractors.json'.",
      err_load: "Không thể tải dữ liệu nhà thầu",
      pag_prev: "Trang trước",
      pag_next: "Trang sau",
      footer_source: "Nguồn dữ liệu:",
      toggle_lang_title: "Chuyển sang tiếng Anh",
      toggle_theme_title: "Chuyển đổi chủ đề sáng/tối",
      footer_data_link: "eTax VN – Cục Thuế"
    },
    en: {
      app_title: "Foreign Contractor Tax Code Lookup",
      app_subtitle: "eTax VN – Tax Department",
      stat_total_label: "Total Registered Contractors",
      stat_year_label: "Newly Registered in ",
      stat_updated_label: "Latest Registration Info",
      stat_none: "N/A",
      search_placeholder: "Search by contractor name or tax code...",
      search_clear: "Clear search",
      label_type: "Type:",
      label_sort: "Sort:",
      opt_all: "All",
      opt_company: "Company",
      opt_individual: "Individual",
      opt_date_asc: "Oldest First",
      opt_date_desc: "Newest First",
      opt_name_asc: "Name A→Z",
      opt_name_desc: "Name Z→A",
      opt_tax_asc: "Tax Code A→Z",
      opt_tax_desc: "Tax Code Z→A",
      results_count: "Showing {count} results",
      results_loading: "Loading...",
      th_no: "No.",
      th_tax: "Tax Code",
      th_name: "Contractor Name",
      th_date: "Issuance Date",
      empty_no_match: "No matching results found",
      empty_error: "Unable to load data. Please check 'registered_contractors.json'.",
      err_load: "Failed to load contractor data",
      pag_prev: "Previous Page",
      pag_next: "Next Page",
      footer_source: "Data Source:",
      toggle_lang_title: "Switch to Vietnamese",
      toggle_theme_title: "Toggle dark/light mode",
      footer_data_link: "eTax VN – Tax Department"
    }
  };

  let contractors = [];
  let filteredData = [];
  let currentPage = 1;
  const pageSize = 50;
  let currentLang = localStorage.getItem('fct_lang') || 'vi';

  // Default: sort by date ascending (oldest first, matching original data order)
  let currentSort = { key: 'date', dir: 'asc' };

  // ─── Translation Engine ───────────────────────────────────────────────────
  function t(key, replacements = {}) {
    let text = (translations[currentLang] && translations[currentLang][key]) || (translations['vi'][key]) || key;
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replace(`{${k}}`, v);
    }
    return text;
  }

  function updateLanguageUI() {
    localStorage.setItem('fct_lang', currentLang);
    document.documentElement.setAttribute('lang', currentLang);

    // Static text
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });

    // Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });

    document.title = t('app_title');

    if (els.langBtn && els.langText) {
      els.langText.textContent = currentLang === 'vi' ? 'EN' : 'VI';
      els.langBtn.title = t('toggle_lang_title');
    }

    if (els.themeBtn) {
      els.themeBtn.title = t('toggle_theme_title');
    }

    if (els.pagPrev) els.pagPrev.setAttribute('aria-label', t('pag_prev'));
    if (els.pagNext) els.pagNext.setAttribute('aria-label', t('pag_next'));
    if (els.searchClearBtn) {
      els.searchClearBtn.title = t('search_clear');
      els.searchClearBtn.setAttribute('aria-label', t('search_clear'));
    }
    if (els.langBtn) {
      els.langBtn.setAttribute('aria-label', currentLang === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt');
    }

    if (contractors.length > 0) {
      calculateStats();
      applyFilters();
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  els.footerYear.textContent = currentYear;
  if (els.statCurrentYear) els.statCurrentYear.textContent = currentYear;

  updateLanguageUI();

  fetchContractors();
  setupEventListeners();

  // ─── Theme Toggle & Language Toggle ───────────────────────────────────────
  if (els.themeBtn) {
    els.themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('fct_manual_theme', newTheme);
    });
  }

  if (els.langBtn) {
    els.langBtn.addEventListener('click', () => {
      currentLang = currentLang === 'vi' ? 'en' : 'vi';
      updateLanguageUI();
    });
  }

  // ─── Data Fetching & Stats ────────────────────────────────────────────────
  async function fetchContractors() {
    setLoading(true);
    try {
      const res = await fetch('registered_contractors.json');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      contractors = await res.json();
      if (!Array.isArray(contractors)) throw new Error('Invalid data format: expected JSON array');

      calculateStats();
      applyFilters();
    } catch (err) {
      console.error('Lỗi lấy danh sách:', err);
      showToast(t('err_load'), 'error');
      els.tableBody.innerHTML = `
        <tr class="empty-state">
          <td colspan="4">
            <span class="material-symbols-rounded">error</span>
            <p>${t('empty_error')}</p>
          </td>
        </tr>
      `;
    } finally {
      setLoading(false);
    }
  }

  function calculateStats() {
    const total = contractors.length;
    els.statTotal.textContent = formatNumber(total);

    const thisYear = new Date().getFullYear(); // local var avoids shadowing outer currentYear
    const newThisYear = contractors.filter(c => {
      if (!c['Issuance Date']) return false;
      const parts = c['Issuance Date'].split('/');
      if (parts.length !== 3) return false;
      return parseInt(parts[2], 10) === thisYear;
    }).length;

    els.statYear.textContent = formatNumber(newThisYear);

    // Find newest record by date+time
    let newestTs = 0;
    contractors.forEach(c => {
      const ts = parseDateTimeForSort(c['Issuance Date'], c['Issuance Time']);
      if (ts > newestTs) newestTs = ts;
    });

    if (newestTs > 0) {
      els.statUpdated.textContent = new Date(newestTs).toLocaleDateString(currentLang === 'vi' ? 'vi-VN' : 'en-US');
    } else {
      els.statUpdated.textContent = t('stat_none');
    }
  }

  // ─── Search, Sort & Pagination ────────────────────────────────────────────
  function applyFilters() {
    const term = els.searchInput.value.toLowerCase().trim();
    const typeFilter = els.typeSelect.value;

    filteredData = contractors.filter(c => {
      const name = (c['Contractor Name'] || '').toLowerCase();
      const tax = (c['Tax Code'] || '').toLowerCase();

      if (typeFilter === 'company' && !tax.startsWith('9')) return false;
      if (typeFilter === 'individual' && !tax.startsWith('8')) return false;

      if (term) {
        return name.includes(term) || tax.includes(term);
      }
      return true;
    });

    els.resultsCount.textContent = t('results_count', { count: formatNumber(filteredData.length) });

    // Sort
    filteredData.sort((a, b) => {
      let valA, valB;
      switch (currentSort.key) {
        case 'tax':
          valA = a['Tax Code'] || '';
          valB = b['Tax Code'] || '';
          return currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'name':
          valA = a['Contractor Name'] || '';
          valB = b['Contractor Name'] || '';
          return currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'date':
        default: {
          valA = parseDateTimeForSort(a['Issuance Date'], a['Issuance Time']);
          valB = parseDateTimeForSort(b['Issuance Date'], b['Issuance Time']);
          if (valA !== valB) {
            return currentSort.dir === 'asc' ? valA - valB : valB - valA;
          }
          // Tie-break by original No. to keep stable order
          const noA = parseInt(a['No.'] || 0, 10);
          const noB = parseInt(b['No.'] || 0, 10);
          return noA - noB;
        }
      }
    });

    currentPage = 1;
    renderTable();
  }

  /**
   * Parse date "DD/MM/YYYY" and optional time "HH:MM:SS" into a timestamp.
   * Falls back gracefully if time is absent.
   */
  function parseDateTimeForSort(dateStr, timeStr) {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return 0;
    const [d, mo, y] = parts.map(Number);

    let h = 0, min = 0, s = 0;
    if (timeStr) {
      const tp = timeStr.split(':').map(Number);
      h = tp[0] || 0;
      min = tp[1] || 0;
      s = tp[2] || 0;
    }
    return new Date(y, mo - 1, d, h, min, s).getTime();
  }

  function renderTable() {
    if (filteredData.length === 0) {
      els.tableBody.innerHTML = `
        <tr class="empty-state">
          <td colspan="4">
            <span class="material-symbols-rounded">search_off</span>
            <p>${t('empty_no_match')}</p>
          </td>
        </tr>
      `;
      els.pagBar.hidden = true;
      return;
    }

    const totalPages = Math.ceil(filteredData.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredData.length);

    const pageData = filteredData.slice(startIdx, endIdx);

    // STT always shows sequential row number in current filtered+sorted result
    els.tableBody.innerHTML = pageData.map((c, i) => `
      <tr>
        <td class="col-no" data-label="${t('th_no')}">${startIdx + i + 1}</td>
        <td class="col-tax" data-label="${t('th_tax')}">${escapeHtml(c['Tax Code'] || '-')}</td>
        <td class="col-name" data-label="${t('th_name')}">${escapeHtml(c['Contractor Name'] || '-')}</td>
        <td class="col-date" data-label="${t('th_date')}">${escapeHtml(c['Issuance Date'] || '-')}</td>
      </tr>
    `).join('');

    renderPagination(totalPages, startIdx, endIdx);
  }

  function renderPagination(totalPages, startIdx, endIdx) {
    if (totalPages <= 1) {
      els.pagBar.hidden = true;
      return;
    }

    els.pagBar.hidden = false;
    els.pagPrev.disabled = currentPage === 1;
    els.pagNext.disabled = currentPage === totalPages;

    els.pagInfo.textContent = `${startIdx + 1} - ${endIdx} / ${filteredData.length}`;

    // Page buttons logic (max 5 buttons)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    let html = '';
    if (startPage > 1) html += `<button class="pag-page-btn" data-page="1">1</button>${startPage > 2 ? '<span style="opacity:0.5">...</span>' : ''}`;

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="pag-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) html += `${endPage < totalPages - 1 ? '<span style="opacity:0.5">...</span>' : ''}<button class="pag-page-btn" data-page="${totalPages}">${totalPages}</button>`;

    els.pagPages.innerHTML = html;
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────
  function setupEventListeners() {
    // Search
    let searchTimeout;
    els.searchInput.addEventListener('input', () => {
      els.searchClearBtn.hidden = els.searchInput.value.length === 0;
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(applyFilters, 300);
    });

    els.searchClearBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.searchClearBtn.hidden = true;
      applyFilters();
    });

    // Type Filter Select
    els.typeSelect.addEventListener('change', () => {
      applyFilters();
    });

    // Mobile Sort Select
    els.sortSelect.addEventListener('change', (e) => {
      const [key, dir] = e.target.value.split('-');
      currentSort = { key, dir };
      updateTableHeaderSortUI();
      applyFilters();
    });

    // Desktop Table Header Sort
    els.thSortables.forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (currentSort.key === key) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = { key, dir: 'asc' };
        }
        // Sync with mobile select
        const selectVal = `${currentSort.key}-${currentSort.dir}`;
        if (els.sortSelect.querySelector(`option[value="${selectVal}"]`)) {
          els.sortSelect.value = selectVal;
        }
        updateTableHeaderSortUI();
        applyFilters();
      });
    });

    // Pagination clicks
    els.pagPrev.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderTable(); }
    });

    els.pagNext.addEventListener('click', () => {
      const max = Math.ceil(filteredData.length / pageSize);
      if (currentPage < max) { currentPage++; renderTable(); }
    });

    els.pagPages.addEventListener('click', (e) => {
      if (e.target.classList.contains('pag-page-btn')) {
        currentPage = parseInt(e.target.dataset.page, 10);
        renderTable();
      }
    });
  }

  function updateTableHeaderSortUI() {
    els.thSortables.forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === currentSort.key) {
        th.classList.add(`sort-${currentSort.dir}`);
      }
    });
  }

  // ─── Utils ──────────────────────────────────────────────────────────────────
  function setLoading(isLoading) {
    if (isLoading) {
      els.tableBody.innerHTML = `
        <tr class="skeleton-row"><td colspan="4"><div class="skeleton-wrap">
          <div class="skeleton-line" style="width:40px"></div>
          <div class="skeleton-line" style="width:130px"></div>
          <div class="skeleton-line" style="width:280px"></div>
          <div class="skeleton-line" style="width:100px"></div>
        </div></td></tr>
        <tr class="skeleton-row"><td colspan="4"><div class="skeleton-wrap">
          <div class="skeleton-line" style="width:40px"></div>
          <div class="skeleton-line" style="width:130px"></div>
          <div class="skeleton-line" style="width:280px"></div>
          <div class="skeleton-line" style="width:100px"></div>
        </div></td></tr>
      `;
      els.pagBar.hidden = true;
    }
  }

  function formatNumber(num) {
    return new Intl.NumberFormat(currentLang === 'vi' ? 'vi-VN' : 'en-US').format(num);
  }

  function escapeHtml(unsafe) {
    return (unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Toast System ───────────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = els.toastContainer;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check_circle';
    if (type === 'error') icon = 'error';

    toast.innerHTML = `
      <span class="material-symbols-rounded">${icon}</span>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  }

  // Initialize sorting UI
  els.sortSelect.value = `${currentSort.key}-${currentSort.dir}`;
  updateTableHeaderSortUI();
});
