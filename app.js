/**
 * LinkShrt — App Logic
 * URL Shortener with localStorage persistence, analytics, and redirection
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'linkshort_links_v2';
const BASE_URL = window.location.origin + window.location.pathname.replace(/\/?$/, '');
const SHORT_ID_LEN = 6;
const REDIRECT_DELAY = 2600; // ms
const TOAST_DURATION = 3000; // ms

// ─── State ───────────────────────────────────────────────────────────────────
let links = [];
let deleteTarget = null;  // slug pending deletion
let toastTimer = null;

// ─── Utils ───────────────────────────────────────────────────────────────────

/** Generate a random alphanumeric string of given length */
function generateId(length = SHORT_ID_LEN) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  arr.forEach(n => (result += chars[n % chars.length]));
  return result;
}

/** Format a number with commas */
function fmtNum(n) {
  return n.toLocaleString();
}

/** Format ISO date string to readable form */
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

/** Truncate a string to maxLen chars */
function truncate(str, maxLen = 60) {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/** Basic URL validation */
function isValidUrl(str) {
  if (!str || !str.trim()) return false;
  try {
    const u = new URL(str.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/** Make sure alias only has safe chars */
function isValidAlias(alias) {
  return /^[a-zA-Z0-9_-]{1,20}$/.test(alias);
}

/** Build the full "short" URL from a slug */
function buildShortUrl(slug) {
  return `${BASE_URL}?ls=${encodeURIComponent(slug)}`;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function loadLinks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) links = JSON.parse(raw);
  } catch (e) {
    console.warn('LinkShrt: Failed to load from localStorage', e);
    links = [];
  }
}

function saveLinks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showToast('Storage quota exceeded. Delete some links to continue.', 'error');
    }
  }
}

function findLink(slug) {
  return links.find(l => l.slug === slug);
}

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const form = $('shorten-form');
const urlInput = $('url-input');
const aliasInput = $('alias-input');
const urlError = $('url-error');
const inputWrapper = $('input-wrapper');
const inputClearBtn = $('input-clear');
const resultCard = $('result-card');
const resultShortUrl = $('result-short-url');
const resultOrigUrl = $('result-original-url');
const btnCopy = $('btn-copy');
const statTotalLinks = $('stat-total-links');
const statTotalClicks = $('stat-total-clicks');
const statTopLink = $('stat-top-link');
const linksGrid = $('links-grid');
const emptyState = $('empty-state');
const noResults = $('no-results');
const searchInput = $('search-input');
const sortSelect = $('sort-select');
const btnClearAll = $('btn-clear-all');
const toast = $('toast');
const confirmModal = $('confirm-modal');
const modalCancel = $('modal-cancel');
const modalConfirm = $('modal-confirm');
const redirectOverlay = $('redirect-overlay');
const redirectDest = $('redirect-dest');
const redirectBar = $('redirect-bar');
const redirectLink = $('redirect-link');

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, TOAST_DURATION);
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateNavStat() {
  const el = document.getElementById('nav-stat-count');
  if (el) el.textContent = fmtNum(links.length);
}

function updateStats() {
  const totalClicks = links.reduce((acc, l) => acc + l.clicks, 0);
  const topClicks = links.length ? Math.max(...links.map(l => l.clicks)) : 0;

  animateCount(statTotalLinks, links.length);
  animateCount(statTotalClicks, totalClicks);
  animateCount(statTopLink, topClicks);
  updateNavStat();
}


function animateCount(el, target) {
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let count = 0;
  const id = setInterval(() => {
    count++;
    const val = Math.round(current + stepSize * count);
    el.textContent = fmtNum(val);
    if (count >= steps) {
      el.textContent = fmtNum(target);
      clearInterval(id);
    }
  }, 30);
}

// ─── Dashboard Render ─────────────────────────────────────────────────────────
function getFilteredLinks() {
  const query = searchInput.value.toLowerCase().trim();
  const sort = sortSelect.value;

  let result = query
    ? links.filter(l => l.slug.toLowerCase().includes(query) || l.originalUrl.toLowerCase().includes(query))
    : [...links];

  switch (sort) {
    case 'oldest': result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
    case 'most-clicks': result.sort((a, b) => b.clicks - a.clicks); break;
    case 'least-clicks': result.sort((a, b) => a.clicks - b.clicks); break;
    default: result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return result;
}

function renderDashboard() {
  updateStats();
  const filtered = getFilteredLinks();
  const query = searchInput.value.trim();

  // Show/hide empty states
  const hasLinks = links.length > 0;
  const hasResults = filtered.length > 0;

  emptyState.classList.toggle('hidden', hasLinks || !!query);
  noResults.classList.toggle('hidden', !query || hasResults || !hasLinks);
  linksGrid.classList.toggle('hidden', !hasResults);

  if (!hasResults) {
    linksGrid.innerHTML = '';
    return;
  }

  const maxClicks = Math.max(...filtered.map(l => l.clicks), 1);

  linksGrid.innerHTML = filtered.map((link, i) => {
    const shortUrl = buildShortUrl(link.slug);
    const barWidth = link.clicks > 0 ? Math.max((link.clicks / maxClicks) * 100, 4) : 0;
    const zeroClicks = link.clicks === 0;

    return `
      <article class="link-card" style="animation-delay: ${i * 0.04}s" role="listitem" data-slug="${link.slug}">
        <div class="link-card-left">
          <div class="link-meta-row">
            <a href="${shortUrl}" class="link-short-url mono" target="_blank" rel="noopener noreferrer" 
               title="Open short link" onclick="handleLinkClick(event, '${link.slug}')">
              ${escapeHtml(shortUrl)}
            </a>
            <span class="link-badge-clicks ${zeroClicks ? 'zero' : ''}" aria-label="${link.clicks} clicks">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              ${fmtNum(link.clicks)} click${link.clicks !== 1 ? 's' : ''}
            </span>
          </div>
          <div class="link-original" title="${escapeHtml(link.originalUrl)}">${escapeHtml(truncate(link.originalUrl, 72))}</div>
          <div class="link-date">Created ${fmtDate(link.createdAt)}</div>
          <div class="click-bar-wrapper" aria-hidden="true">
            <div class="click-bar-track">
              <div class="click-bar-fill" style="width: ${barWidth}%"></div>
            </div>
          </div>
        </div>
        <div class="link-card-right">
          <button class="btn-card copy-card" title="Copy short URL" aria-label="Copy short URL for ${escapeHtml(link.slug)}"
                  onclick="copyCardUrl('${link.slug}', this)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="btn-card delete-card" title="Delete link" aria-label="Delete link ${escapeHtml(link.slug)}"
                  onclick="confirmDelete('${link.slug}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

/** Safe HTML escape */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

// ─── Shortening ───────────────────────────────────────────────────────────────
function shortenUrl(originalUrl, customAlias) {
  // Validate URL
  if (!isValidUrl(originalUrl)) {
    showError('Please enter a valid URL starting with http:// or https://');
    return;
  }

  // Validate alias if provided
  let slug = '';
  if (customAlias) {
    if (!isValidAlias(customAlias)) {
      showError('Alias can only contain letters, numbers, hyphens and underscores (max 20 chars).');
      return;
    }
    if (findLink(customAlias)) {
      showError(`The alias "${customAlias}" is already in use. Try a different one.`);
      return;
    }
    slug = customAlias;
  } else {
    // Generate unique slug
    let attempts = 0;
    do {
      slug = generateId(SHORT_ID_LEN);
      attempts++;
      if (attempts > 50) { showError('Could not generate a unique ID. Please try again.'); return; }
    } while (findLink(slug));
  }

  const newLink = {
    slug,
    originalUrl: originalUrl.trim(),
    clicks: 0,
    createdAt: new Date().toISOString(),
  };

  links.unshift(newLink);
  saveLinks();
  renderDashboard();

  // Show result
  const shortUrl = buildShortUrl(slug);
  resultShortUrl.textContent = shortUrl;
  resultShortUrl.href = shortUrl;
  resultOrigUrl.textContent = truncate(originalUrl.trim(), 80);
  resultCard.classList.remove('hidden');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Reset copy button
  resetCopyBtn();

  // Clear form
  urlInput.value = '';
  aliasInput.value = '';
  inputClearBtn.classList.remove('visible');
  clearError();

  showToast(`✓ Link shortened! ls/${slug}`, 'success');
}

function showError(msg) {
  urlError.textContent = msg;
  inputWrapper.classList.add('error');
  urlInput.focus();
}
function clearError() {
  urlError.textContent = '';
  inputWrapper.classList.remove('error');
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}

function resetCopyBtn() {
  btnCopy.querySelector('.copy-icon').classList.remove('hidden');
  btnCopy.querySelector('.check-icon').classList.add('hidden');
  btnCopy.classList.remove('copied');
  btnCopy.childNodes[2].textContent = ' Copy'; // text node
}

btnCopy.addEventListener('click', async () => {
  const url = resultShortUrl.textContent;
  const ok = await copyToClipboard(url);
  if (ok) {
    btnCopy.querySelector('.copy-icon').classList.add('hidden');
    btnCopy.querySelector('.check-icon').classList.remove('hidden');
    btnCopy.classList.add('copied');
    // Update text node
    const textNodes = [...btnCopy.childNodes].filter(n => n.nodeType === 3);
    if (textNodes.length) textNodes[textNodes.length - 1].textContent = ' Copied!';
    showToast('Copied to clipboard!', 'success');
    setTimeout(resetCopyBtn, 2500);
  } else {
    showToast('Could not copy – please select manually.', 'error');
  }
});

// Card copy
window.copyCardUrl = async function (slug, btn) {
  const url = buildShortUrl(slug);
  const ok = await copyToClipboard(url);
  if (ok) {
    const origColor = btn.style.color;
    btn.style.color = 'var(--accent-green)';
    showToast('Copied to clipboard!', 'success');
    setTimeout(() => { btn.style.color = origColor; }, 1500);
  } else {
    showToast('Could not copy.', 'error');
  }
};

// ─── Redirection ──────────────────────────────────────────────────────────────
function checkRedirect() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('ls');
  if (!slug) return;

  const link = findLink(slug);
  if (!link) {
    showToast(`Short link "ls/${slug}" not found.`, 'error');
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  // Increment click count
  link.clicks++;
  saveLinks();

  // Show redirect overlay
  redirectDest.textContent = truncate(link.originalUrl, 80);
  redirectLink.href = link.originalUrl;
  redirectOverlay.classList.remove('hidden');

  // Start progress bar animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      redirectBar.style.width = '100%';
    });
  });

  // Redirect after delay
  const timer = setTimeout(() => {
    window.location.href = link.originalUrl;
  }, REDIRECT_DELAY);

  // Allow manual click
  redirectLink.addEventListener('click', () => clearTimeout(timer));
}

// Intercept link card clicks that are actually redirects (in same tab context)
window.handleLinkClick = function (e, slug) {
  // Let the browser handle it normally (opens in new tab due to target=_blank)
  // The new tab will hit checkRedirect()
};

// ─── Delete ───────────────────────────────────────────────────────────────────
window.confirmDelete = function (slug) {
  deleteTarget = slug;
  confirmModal.classList.remove('hidden');
};

modalCancel.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
  deleteTarget = null;
});

modalConfirm.addEventListener('click', () => {
  if (!deleteTarget) return;

  if (deleteTarget === '__clear_all__') {
    // Clear all links
    links = [];
    saveLinks();
    renderDashboard();
    resultCard.classList.add('hidden');
    confirmModal.classList.add('hidden');
    deleteTarget = null;
    $('modal-title').textContent = 'Delete this link?';
    $('modal-body').textContent = 'This action cannot be undone. The short link will stop working immediately.';
    showToast('All links cleared.', 'error');
  } else {
    // Delete single link
    links = links.filter(l => l.slug !== deleteTarget);
    saveLinks();
    renderDashboard();
    confirmModal.classList.add('hidden');
    deleteTarget = null;
    resultCard.classList.add('hidden');
    showToast('Link deleted.', 'error');
  }
});

// Close modal on backdrop click
confirmModal.addEventListener('click', e => {
  if (e.target === confirmModal) {
    confirmModal.classList.add('hidden');
    deleteTarget = null;
    $('modal-title').textContent = 'Delete this link?';
    $('modal-body').textContent = 'This action cannot be undone. The short link will stop working immediately.';
  }
});

// ─── Clear All ────────────────────────────────────────────────────────────────
btnClearAll.addEventListener('click', () => {
  if (!links.length) { showToast('No links to clear.', 'error'); return; }

  // Reuse modal with clear-all context
  deleteTarget = '__clear_all__';
  $('modal-title').textContent = 'Clear all links?';
  $('modal-body').textContent = `This will permanently delete all ${links.length} link${links.length !== 1 ? 's' : ''} and their analytics.`;
  confirmModal.classList.remove('hidden');
});

// ─── Form Events ──────────────────────────────────────────────────────────────
form.addEventListener('submit', e => {
  e.preventDefault();
  clearError();
  const url = urlInput.value.trim();
  const alias = aliasInput.value.trim();
  shortenUrl(url, alias);
});

urlInput.addEventListener('input', () => {
  clearError();
  inputClearBtn.classList.toggle('visible', urlInput.value.length > 0);
});

inputClearBtn.addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
  inputClearBtn.classList.remove('visible');
  clearError();
  resultCard.classList.add('hidden');
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); form.dispatchEvent(new Event('submit')); }
});

// Paste and auto-strip whitespace
urlInput.addEventListener('paste', e => {
  setTimeout(() => {
    urlInput.value = urlInput.value.trim();
    inputClearBtn.classList.toggle('visible', urlInput.value.length > 0);
  }, 0);
});

// ─── Search & Sort ────────────────────────────────────────────────────────────
let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderDashboard, 200);
});
sortSelect.addEventListener('change', renderDashboard);

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Escape closes modals
  if (e.key === 'Escape') {
    confirmModal.classList.add('hidden');
    deleteTarget = null;
  }
  // Ctrl/Cmd + K focuses URL input
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
  }
});

// ─── Nav Active State ────────────────────────────────────────────────────────
function initNavPills() {
  const pills = document.querySelectorAll('.nav-pill');
  const dashboard = document.getElementById('dashboard');

  // Click: toggle active
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active-pill'));
      pill.classList.add('active-pill');
    });
  });

  // Scroll: switch between Home and Dashboard pill
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

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  loadLinks();
  checkRedirect();
  renderDashboard();
  initNavPills();

  // Trigger progress bar animation if on redirect
  if (!redirectOverlay.classList.contains('hidden')) return;
}

init();
