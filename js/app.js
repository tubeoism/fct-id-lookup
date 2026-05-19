/**
 * app.js – Frontend logic cho FCT ID Lookup (Static Version)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM Elements ──────────────────────────────────────────────────────────
  const els = {
    themeBtn: document.getElementById('theme-toggle-btn'),
    clockTime: document.getElementById('clock-time'),
    
    // Stats
    statTotal: document.getElementById('stat-total-val'),
    statYear: document.getElementById('stat-year-val'),
    statCurrentYear: document.getElementById('stat-current-year'),
    statUpdated: document.getElementById('stat-updated-val'),
    
    // Search & Filter
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    resultsCount: document.getElementById('results-count'),
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
  
  let currentSort = { key: 'no', dir: 'asc' }; // keys: no, tax, name, date

  // ─── Init ─────────────────────────────────────────────────────────────────
  initTheme();
  startClock();
  
  const currentYear = new Date().getFullYear();
  els.footerYear.textContent = currentYear;
  els.statCurrentYear.textContent = currentYear;
  
  fetchContractors();
  setupEventListeners();

  // ─── Theme Management ─────────────────────────────────────────────────────
  function initTheme() {
    const manualTheme = localStorage.getItem('manual-theme');
    if (manualTheme) {
      setTheme(manualTheme);
    } else {
      checkAutoTheme();
      // Check periodically
      setInterval(checkAutoTheme, 60000);
    }
  }

  function checkAutoTheme() {
    if (localStorage.getItem('manual-theme')) return; // Ignore if user set manually
    const hour = new Date().getHours();
    // Dark mode between 7 PM (19) and 6 AM (6)
    const shouldBeDark = (hour >= 19 || hour < 6);
    setTheme(shouldBeDark ? 'dark' : 'light');
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  els.themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('manual-theme', newTheme);
    showToast(`Đã chuyển sang giao diện ${newTheme === 'dark' ? 'tối' : 'sáng'}`, 'info');
  });

  // ─── Clock ────────────────────────────────────────────────────────────────
  function startClock() {
    const tick = () => {
      els.clockTime.textContent = new Date().toLocaleTimeString('vi-VN');
    };
    tick();
    setInterval(tick, 1000);
  }

  // ─── Data Fetching & Stats ────────────────────────────────────────────────
  async function fetchContractors() {
    setLoading(true);
    try {
      // Fetch directly from the static JSON file
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
    
    // In a pure static environment, we don't have file modification time from the API.
    // We can infer the last updated date by finding the newest 'Issuance Date' in the data.
    let newestDate = 0;
    contractors.forEach(c => {
        const ts = parseDateForSort(c['Issuance Date']);
        if (ts > newestDate) newestDate = ts;
    });
    
    if (newestDate > 0) {
        const d = new Date(newestDate);
        els.statUpdated.textContent = d.toLocaleDateString('vi-VN');
    } else {
        els.statUpdated.textContent = 'Chưa có';
    }
  }

  // ─── Search, Sort & Pagination ────────────────────────────────────────────
  function applyFilters() {
    const term = els.searchInput.value.toLowerCase().trim();
    
    if (term) {
      filteredData = contractors.filter(c => {
        const name = (c['Company Name'] || '').toLowerCase();
        const tax = (c['Tax Code'] || '').toLowerCase();
        return name.includes(term) || tax.includes(term);
      });
    } else {
      filteredData = [...contractors];
    }
    
    els.resultsCount.textContent = `Hiển thị ${formatNumber(filteredData.length)} kết quả`;
    
    // Sort
    filteredData.sort((a, b) => {
      let valA, valB;
      switch (currentSort.key) {
        case 'no':
          valA = parseInt(a['No.'] || 0, 10);
          valB = parseInt(b['No.'] || 0, 10);
          return currentSort.dir === 'asc' ? valA - valB : valB - valA;
        case 'tax':
          valA = a['Tax Code'] || '';
          valB = b['Tax Code'] || '';
          return currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'name':
          valA = a['Company Name'] || '';
          valB = b['Company Name'] || '';
          return currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'date':
          valA = parseDateForSort(a['Issuance Date']);
          valB = parseDateForSort(b['Issuance Date']);
          return currentSort.dir === 'asc' ? valA - valB : valB - valA;
      }
    });

    currentPage = 1;
    renderTable();
  }

  function parseDateForSort(dateStr) {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return 0;
    return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
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
    
    els.tableBody.innerHTML = pageData.map(c => `
      <tr>
        <td class="col-no" data-label="STT">${c['No.'] || '-'}</td>
        <td class="col-tax" data-label="Mã số thuế">${c['Tax Code'] || '-'}</td>
        <td class="col-name" data-label="Tên công ty">${c['Company Name'] || '-'}</td>
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
      searchTimeout = setTimeout(applyFilters, 300); // debounce
    });

    els.searchClearBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.searchClearBtn.hidden = true;
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
        els.sortSelect.value = `${currentSort.key}-${currentSort.dir}`;
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
