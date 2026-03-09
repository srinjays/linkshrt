/**
 * LinkShrt — Round 2 App Logic
 * Features: URL shortening, click limits, enable/disable, edit URL,
 *           creation timestamps, last accessed tracking, click analytics
 */
'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'linkshort_links_v2';
const TOAST_DURATION = 3000;
const SEARCH_DEBOUNCE = 200;

// ─── State ───────────────────────────────────────────────────────────────────
let links = [];
let pendingDelete = null;   // slug to delete
let pendingEdit = null;   // slug being edited
let searchTimer = null;

// ─── DOM Refs ────────────────────────────────────────────────────────────────
const shortenForm = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const aliasInput = document.getElementById('alias-input');
const limitInput = document.getElementById('limit-input');
const inputClear = document.getElementById('input-clear');
const inputWrapper = document.getElementById('input-wrapper');
const urlError = document.getElementById('url-error');
const resultCard = document.getElementById('result-card');
const resultShortUrl = document.getElementById('result-short-url');
const resultOrigUrl = document.getElementById('result-original-url');
const btnCopy = document.getElementById('btn-copy');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const filterSelect = document.getElementById('filter-select');
const linksGrid = document.getElementById('links-grid');
const emptyState = document.getElementById('empty-state');
const noResults = document.getElementById('no-results');
const toast = document.getElementById('toast');
const statTotalLinks = document.getElementById('stat-total-links');
const statTotalClicks = document.getElementById('stat-total-clicks');
const statActiveLinks = document.getElementById('stat-active-links');
const statTopLink = document.getElementById('stat-top-link');
const redirectOverlay = document.getElementById('redirect-overlay');

// Redirect state divs
const redirectNormal = document.getElementById('redirect-state-normal');
const redirectDisabled = document.getElementById('redirect-state-disabled');
const redirectExpired = document.getElementById('redirect-state-expired');

// Delete modal
const confirmModal = document.getElementById('confirm-modal');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

// Edit modal
const editModal = document.getElementById('edit-modal');
const editUrlInput = document.getElementById('edit-url-input');
const editLimitInput = document.getElementById('edit-limit-input');
const editError = document.getElementById('edit-error');
const editCancel = document.getElementById('edit-cancel');
const editConfirm = document.getElementById('edit-confirm');
const editInputWrapper = document.getElementById('edit-input-wrapper');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateId(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return [...arr].map(n => chars[n % chars.length]).join('');
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  } catch { return '—'; }
}

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (secs < 10) return 'Just now';
  if (secs < 60) return `${secs}s ago`;
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

function getBaseUrl() {
  return window.location.origin + window.location.pathname;
}

function getLinkStatus(link) {
  if (link.clickLimit && link.clicks >= link.clickLimit) return 'expired';
  if (!link.enabled) return 'disabled';
  return 'active';
}

// ─── Storage ─────────────────────────────────────────────────────────────────
function saveLinks() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(links)); }
  catch (e) {
    if (e.name === 'QuotaExceededError') showToast('Storage full — delete old links to make room.', 'error');
  }
}

function loadLinks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Migrate old links: add new fields with defaults if missing
      links = JSON.parse(raw).map(link => ({
        enabled: true,
        clickLimit: null,
        lastAccessedAt: null,
        ...link,
      }));
    }
  } catch (e) {
    console.warn('LinkShrt: Failed to load from localStorage', e);
    links = [];
  }
}

function findLink(slug) {
  return links.find(l => l.slug === slug) || null;
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'default') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, TOAST_DURATION);
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateNavStat() {
  const el = document.getElementById('nav-stat-count');
  if (el) el.textContent = fmtNum(links.length);
}

function updateStats() {
  const totalClicks = links.reduce((acc, l) => acc + l.clicks, 0);
  const topClicks = links.length ? Math.max(...links.map(l => l.clicks)) : 0;
  const activeCount = links.filter(l => getLinkStatus(l) === 'active').length;

  animateCount(statTotalLinks, links.length);
  animateCount(statTotalClicks, totalClicks);
  animateCount(statActiveLinks, activeCount);
  animateCount(statTopLink, topClicks);
  updateNavStat();
}

function animateCount(el, target) {
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const step = diff / steps;
  let count = 0;
  const id = setInterval(() => {
    count++;
    el.textContent = fmtNum(Math.round(current + step * count));
    if (count >= steps) { el.textContent = fmtNum(target); clearInterval(id); }
  }, 30);
}

// ─── Dashboard Render ─────────────────────────────────────────────────────────
function getFilteredLinks() {
  const query = searchInput.value.toLowerCase().trim();
  const sort = sortSelect.value;
  const filter = filterSelect.value;

  let result = [...links];

  // Filter by status
  if (filter !== 'all') {
    result = result.filter(l => getLinkStatus(l) === filter);
  }

  // Filter by search query
  if (query) {
    result = result.filter(l =>
      l.slug.toLowerCase().includes(query) ||
      l.originalUrl.toLowerCase().includes(query)
    );
  }

  // Sort
  switch (sort) {
    case 'oldest': result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
    case 'most-clicks': result.sort((a, b) => b.clicks - a.clicks); break;
    case 'least-clicks': result.sort((a, b) => a.clicks - b.clicks); break;
    default: result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return result;
}

function renderDashboard() {
  const filtered = getFilteredLinks();
  const hasLinks = links.length > 0;
  const hasResults = filtered.length > 0;
  const isFiltered = searchInput.value.trim() !== '' || filterSelect.value !== 'all';

  emptyState.classList.toggle('hidden', hasLinks);
  noResults.classList.toggle('hidden', !hasLinks || hasResults || !isFiltered);
  linksGrid.classList.toggle('hidden', !hasResults);

  if (!hasResults) { linksGrid.innerHTML = ''; updateStats(); return; }

  const maxClicks = Math.max(...filtered.map(l => l.clicks), 1);

  linksGrid.innerHTML = filtered.map((link, i) => {
    const shortUrl = `${getBaseUrl()}?ls=${link.slug}`;
    const status = getLinkStatus(link);
    const hasLimit = link.clickLimit && link.clickLimit > 0;
    const pct = hasLimit
      ? Math.min((link.clicks / link.clickLimit) * 100, 100)
      : (link.clicks / maxClicks) * 100;
    const isNearLimit = hasLimit && pct >= 70 && pct < 100;
    const isAtLimit = hasLimit && link.clicks >= link.clickLimit;
    const barClass = isAtLimit ? 'at-limit-fill' : isNearLimit ? 'near-limit' : '';

    const clicksLabel = hasLimit
      ? `${fmtNum(link.clicks)} / ${fmtNum(link.clickLimit)}`
      : `${fmtNum(link.clicks)} clicks`;

    const toggleLabel = link.enabled ? 'Enabled' : 'Enable';
    const toggleClass = link.enabled ? 'is-enabled' : 'is-disabled';

    return `
    <article class="link-card status-${status}" role="listitem" style="animation-delay:${i * 0.04}s">
      <div class="link-card-top">
        <div class="link-card-left">
          <div class="link-meta-row">
            <a href="${escapeHtml(shortUrl)}" class="link-short-url mono"
               target="_blank" rel="noopener noreferrer"
               aria-label="Short link: ls/${escapeHtml(link.slug)}">
              ls/${escapeHtml(link.slug)}
            </a>
            <span class="status-badge ${status}" aria-label="Status: ${status}">
              ${status}
            </span>
            <span class="link-badge-clicks ${isAtLimit ? 'at-limit' : ''}" aria-label="${clicksLabel}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              ${clicksLabel}
            </span>
          </div>
          <div class="link-original" title="${escapeHtml(link.originalUrl)}">
            ${escapeHtml(link.originalUrl)}
          </div>
          <div class="link-timestamps">
            <span class="link-ts">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Created ${fmtDate(link.createdAt)}
            </span>
            <span class="ts-dot">·</span>
            <span class="link-ts">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Last accessed: ${timeAgo(link.lastAccessedAt)}
            </span>
          </div>
        </div>
        <div class="link-card-actions">
          <button class="btn-toggle ${toggleClass}"
            onclick="window.toggleEnabled('${escapeHtml(link.slug)}')"
            title="${link.enabled ? 'Disable this link' : 'Enable this link'}"
            aria-label="${link.enabled ? 'Disable' : 'Enable'} link ls/${escapeHtml(link.slug)}">
            ${link.enabled
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
      }
            <span>${toggleLabel}</span>
          </button>
          <button class="btn-card edit-card"
            onclick="window.openEditModal('${escapeHtml(link.slug)}')"
            title="Edit destination URL" aria-label="Edit link">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-card copy-card"
            onclick="window.copyCardUrl('${escapeHtml(shortUrl)}', this)"
            title="Copy short URL" aria-label="Copy short URL">
            <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="btn-card delete-card"
            onclick="window.confirmDelete('${escapeHtml(link.slug)}')"
            title="Delete link" aria-label="Delete link ls/${escapeHtml(link.slug)}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>

      ${hasLimit || link.clicks > 0 ? `
      <div class="click-bar-wrapper">
        ${hasLimit ? `<div class="click-bar-meta"><span>${fmtNum(link.clicks)} used</span><span>${fmtNum(link.clickLimit)} limit</span></div>` : ''}
        <div class="click-bar-track">
          <div class="click-bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </div>` : ''}
    </article>`;
  }).join('');

  updateStats();
}

// ─── URL Shortening ───────────────────────────────────────────────────────────
function clearError() {
  urlError.textContent = '';
  inputWrapper.classList.remove('error');
}

function setError(msg) {
  urlError.textContent = msg;
  inputWrapper.classList.add('error');
}

shortenForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();

  const rawUrl = urlInput.value.trim();
  const rawAlias = aliasInput.value.trim();
  const rawLimit = limitInput.value.trim();

  if (!rawUrl) { setError('Please enter a URL.'); urlInput.focus(); return; }
  if (!isValidUrl(rawUrl)) { setError('Please enter a valid URL starting with http:// or https://'); urlInput.focus(); return; }

  // Alias validation
  let slug = rawAlias;
  if (slug) {
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(slug)) {
      setError('Alias must be 1–20 characters: letters, numbers, hyphens, underscores only.');
      aliasInput.focus(); return;
    }
    if (findLink(slug)) {
      setError(`Alias "ls/${slug}" is already taken. Choose another.`);
      aliasInput.focus(); return;
    }
  } else {
    do { slug = generateId(6); } while (findLink(slug));
  }

  // Click limit validation
  let clickLimit = null;
  if (rawLimit) {
    clickLimit = parseInt(rawLimit, 10);
    if (isNaN(clickLimit) || clickLimit < 1) {
      setError('Click limit must be a positive number.');
      limitInput.focus(); return;
    }
  }

  const link = {
    slug,
    originalUrl: rawUrl,
    clicks: 0,
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
    enabled: true,
    clickLimit,
  };

  links.unshift(link);
  saveLinks();
  renderDashboard();
  showToast('✓ Short link created!', 'success');

  // Show result card
  const shortUrl = `${getBaseUrl()}?ls=${slug}`;
  resultShortUrl.textContent = shortUrl;
  resultShortUrl.href = shortUrl;
  resultOrigUrl.textContent = rawUrl;
  resultCard.classList.remove('hidden');

  // Reset form
  urlInput.value = '';
  aliasInput.value = '';
  limitInput.value = '';
  inputClear.classList.remove('visible');
  clearError();
});

// ─── Copy ────────────────────────────────────────────────────────────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

btnCopy.addEventListener('click', async () => {
  const ok = await copyText(resultShortUrl.textContent);
  if (ok) {
    btnCopy.classList.add('copied');
    btnCopy.querySelector('.copy-icon').classList.add('hidden');
    btnCopy.querySelector('.check-icon').classList.remove('hidden');
    btnCopy.querySelector('span:last-child') && (btnCopy.lastChild.textContent = '');
    setTimeout(() => {
      btnCopy.classList.remove('copied');
      btnCopy.querySelector('.copy-icon').classList.remove('hidden');
      btnCopy.querySelector('.check-icon').classList.add('hidden');
    }, 2000);
    showToast('Copied to clipboard!', 'success');
  }
});

window.copyCardUrl = async (url, btn) => {
  const ok = await copyText(url);
  if (ok) {
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>';
    btn.style.color = 'var(--accent-green)';
    setTimeout(() => {
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      btn.style.color = '';
    }, 2000);
    showToast('Copied to clipboard!', 'success');
  }
};

// ─── Input Clear Button ───────────────────────────────────────────────────────
urlInput.addEventListener('input', () => {
  inputClear.classList.toggle('visible', urlInput.value.length > 0);
  clearError();
});
inputClear.addEventListener('click', () => {
  urlInput.value = '';
  inputClear.classList.remove('visible');
  clearError();
  urlInput.focus();
});

// ─── Toggle Enable/Disable ───────────────────────────────────────────────────
window.toggleEnabled = (slug) => {
  const link = findLink(slug);
  if (!link) return;
  link.enabled = !link.enabled;
  saveLinks();
  renderDashboard();
  showToast(
    link.enabled ? `✓ Link ls/${slug} enabled.` : `⏸ Link ls/${slug} disabled.`,
    link.enabled ? 'success' : 'default'
  );
};

// ─── Delete ──────────────────────────────────────────────────────────────────
window.confirmDelete = (slug) => {
  pendingDelete = slug;
  document.getElementById('modal-body').textContent =
    `Short link "ls/${slug}" will be permanently removed.`;
  confirmModal.classList.remove('hidden');
};

modalCancel.addEventListener('click', () => {
  pendingDelete = null;
  confirmModal.classList.add('hidden');
});

modalConfirm.addEventListener('click', () => {
  if (pendingDelete) {
    links = links.filter(l => l.slug !== pendingDelete);
    saveLinks();
    renderDashboard();
    showToast(`Link ls/${pendingDelete} deleted.`);
    pendingDelete = null;
  }
  confirmModal.classList.add('hidden');
});

// Clear All
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (links.length === 0) { showToast('Nothing to clear.'); return; }
  pendingDelete = '__ALL__';
  document.getElementById('modal-title').textContent = 'Clear all links?';
  document.getElementById('modal-body').textContent =
    `This will permanently delete all ${links.length} link${links.length > 1 ? 's' : ''} and their analytics.`;
  confirmModal.classList.remove('hidden');
});

// Override confirm for clear all
const origConfirm = modalConfirm.onclick;
modalConfirm.addEventListener('click', () => {
  if (pendingDelete === '__ALL__') {
    links = [];
    saveLinks();
    renderDashboard();
    resultCard.classList.add('hidden');
    showToast('All links cleared.');
    document.getElementById('modal-title').textContent = 'Delete this link?';
    pendingDelete = null;
    confirmModal.classList.add('hidden');
  }
});

// ─── Edit Link ────────────────────────────────────────────────────────────────
window.openEditModal = (slug) => {
  const link = findLink(slug);
  if (!link) return;
  pendingEdit = slug;
  editUrlInput.value = link.originalUrl;
  editLimitInput.value = link.clickLimit || '';
  editError.textContent = '';
  editInputWrapper.classList.remove('error');
  editModal.classList.remove('hidden');
  setTimeout(() => editUrlInput.focus(), 50);
};

editCancel.addEventListener('click', () => {
  pendingEdit = null;
  editModal.classList.add('hidden');
});

editConfirm.addEventListener('click', () => {
  const link = findLink(pendingEdit);
  if (!link) return;

  const newUrl = editUrlInput.value.trim();
  const newLimit = editLimitInput.value.trim();

  if (!newUrl) {
    editError.textContent = 'URL cannot be empty.';
    editInputWrapper.classList.add('error');
    editUrlInput.focus(); return;
  }
  if (!isValidUrl(newUrl)) {
    editError.textContent = 'Please enter a valid URL (http:// or https://).';
    editInputWrapper.classList.add('error');
    editUrlInput.focus(); return;
  }

  let clickLimit = null;
  if (newLimit) {
    clickLimit = parseInt(newLimit, 10);
    if (isNaN(clickLimit) || clickLimit < 1) {
      editError.textContent = 'Click limit must be a positive number, or leave blank to remove.';
      editLimitInput.focus(); return;
    }
  }

  link.originalUrl = newUrl;
  link.clickLimit = clickLimit;
  saveLinks();
  renderDashboard();
  showToast(`✓ Link ls/${pendingEdit} updated.`, 'success');
  pendingEdit = null;
  editModal.classList.add('hidden');
});

// Close edit modal on overlay click
editModal.addEventListener('click', (e) => { if (e.target === editModal) editCancel.click(); });
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) modalCancel.click(); });

// ─── Search & Sort ────────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderDashboard, SEARCH_DEBOUNCE);
});
sortSelect.addEventListener('change', renderDashboard);
filterSelect.addEventListener('change', renderDashboard);

// ─── Redirect Handler ─────────────────────────────────────────────────────────
function showRedirectState(state) {
  // Show overlay
  redirectOverlay.classList.remove('hidden');
  // Show correct state, hide others
  redirectNormal.classList.toggle('hidden', state !== 'normal');
  redirectDisabled.classList.toggle('hidden', state !== 'disabled');
  redirectExpired.classList.toggle('hidden', state !== 'expired');
}

function checkRedirect() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('ls');
  if (!slug) return;

  const link = findLink(slug);

  if (!link) {
    showToast(`Short link "ls/${slug}" not found.`, 'error');
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  // ── Check: link disabled ──
  if (!link.enabled) {
    showRedirectState('disabled');
    return;
  }

  // ── Check: click limit reached ──
  if (link.clickLimit && link.clicks >= link.clickLimit) {
    showRedirectState('expired');
    return;
  }

  // ── Normal redirect ──
  link.clicks++;
  link.lastAccessedAt = new Date().toISOString();
  saveLinks();

  const dest = link.originalUrl;
  document.getElementById('redirect-dest').textContent = dest;
  document.getElementById('redirect-link').href = dest;
  showRedirectState('normal');

  // Animate progress bar
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('redirect-bar').style.width = '100%';
    });
  });

  setTimeout(() => { window.location.href = dest; }, 2600);
}

// ─── Nav Active Pills ─────────────────────────────────────────────────────────
function initNavPills() {
  const pills = document.querySelectorAll('.nav-pill');
  const dashboard = document.getElementById('dashboard');

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active-pill'));
      pill.classList.add('active-pill');
    });
  });

  if (dashboard) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const homeP = document.getElementById('nav-home');
        const dashP = document.getElementById('nav-dash');
        if (!homeP || !dashP) return;
        if (entry.isIntersecting) {
          dashP.classList.add('active-pill');
          homeP.classList.remove('active-pill');
        } else {
          homeP.classList.add('active-pill');
          dashP.classList.remove('active-pill');
        }
      });
    }, { threshold: 0.15 });
    observer.observe(dashboard);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  loadLinks();
  checkRedirect();
  renderDashboard();
  initNavPills();
}

init();
