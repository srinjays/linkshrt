/**
 * LinkShrt — Auth System
 * SHA-256 hashing via Web Crypto API · localStorage persistence
 */
'use strict';

const USERS_KEY = 'linkshrt_users_v1';
const SESSION_KEY = 'linkshrt_session_v1';

// ─── Password Hashing (real SHA-256, no library) ─────────────────────────────
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + '_linkshrt_2026_salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Users ───────────────────────────────────────────────────────────────────
function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
    catch { return []; }
}
function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// ─── Session ─────────────────────────────────────────────────────────────────
function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch { return null; }
}
function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
        id: user.id,
        username: user.username,
        email: user.email,
        loginAt: new Date().toISOString(),
    }));
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function isLoggedIn() { return getSession() !== null; }

// ─── Register ────────────────────────────────────────────────────────────────
async function registerUser(username, email, password) {
    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
        throw new Error('An account with this email already exists.');
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
        throw new Error('This username is already taken.');

    const user = {
        id: crypto.randomUUID(),
        username: username.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    return user;
}

// ─── Login ───────────────────────────────────────────────────────────────────
async function loginUser(email, password) {
    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) throw new Error('No account found with this email address.');
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error('Incorrect password. Please try again.');
    return user;
}

// ─── Logout ──────────────────────────────────────────────────────────────────
function logout() {
    clearSession();
    window.location.replace('auth.html');
}

// Expose globally
window.Auth = { getSession, setSession, clearSession, isLoggedIn, logout, registerUser, loginUser };
