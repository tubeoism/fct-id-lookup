/**
 * app.js – Frontend logic cho FCT ID Lookup (Static Version)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Enforce Dark Mode ────────────────────────────────────────────────────
  document.documentElement.setAttribute('data-theme', 'dark');

  // ─── DOM Elements ──────────────────────────────────────────────────────────
  const els = {
    themeBtn: document.getElementById('theme-toggle-btn'),

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

    footerYear: document.getElementById('footer-year')
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let contractors = [];
  let filteredData = [];
  let currentPage = 1;
  const pageSize = 50;

  // Default: sort by date ascending (oldest first, matching original data order)
  let currentSort = { key: 'date', dir: 'asc' };

  // ─── Init ─────────────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  els.footerYear.textContent = currentYear;
  els.statCurrentYear.textContent = currentYear;

  fetchContractors();
  setupEventListeners();

  // ─── Theme Toggle (still kept for manual use, no toast) ───────────────────
  if (els.themeBtn) {
    els.themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    });
  }

  // ─── Data Fetching & Stats ────────────────────────────────────────────────
  async function fetchContractors() {
    setLoading(true);
    try {
      const res = await fetch('registered_contractors.json');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      contractors = await res.json();

      calculateStats();
      applyFilters();
    } catch (err) {
      console.error('Lỗi lấy danh sách:', err);
      showToast('Không thể tải dữ liệu nhà thầu', 'error');
      els.tableBody.innerHTML = `
        <tr class="empty-state">
          <td colspan="4">
            <span class="material-symbols-rounded">error</span>
            <p>Không thể tải dữ liệu. Vui lòng kiểm tra lại file 'registered_contractors.json'.</p>
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

    const currentYear = new Date().getFullYear();
    const newThisYear = contractors.filter(c => {
      if (!c['Issuance Date']) return false;
      const parts = c['Issuance Date'].split('/');
      if (parts.length !== 3) return false;
      return parseInt(parts[2], 10) === currentYear;
    }).length;

    els.statYear.textContent = formatNumber(newThisYear);

    // Find newest record by date+time
    let newestTs = 0;
    contractors.forEach(c => {
      const ts = parseDateTimeForSort(c['Issuance Date'], c['Issuance Time']);
      if (ts > newestTs) newestTs = ts;
    });

    if (newestTs > 0) {
      els.statUpdated.textContent = new Date(newestTs).toLocaleDateString('vi-VN');
    } else {
      els.statUpdated.textContent = 'Chưa có';
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

    els.resultsCount.textContent = `Hiển thị ${formatNumber(filteredData.length)} kết quả`;

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
            <p>Không tìm thấy kết quả phù hợp</p>
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
        <td class="col-no" data-label="STT">${startIdx + i + 1}</td>
        <td class="col-tax" data-label="Mã số thuế">${c['Tax Code'] || '-'}</td>
        <td class="col-name" data-label="Tên nhà thầu">${c['Contractor Name'] || '-'}</td>
        <td class="col-date" data-label="Ngày cấp">${c['Issuance Date'] || '-'}</td>
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
    return new Intl.NumberFormat('vi-VN').format(num);
  }

  function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ─── Toast System ───────────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
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
