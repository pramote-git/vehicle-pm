/**
 * api.js — ตัวเชื่อมกับ GAS Web App
 *  - POST JSON เป็น text/plain เพื่อเลี่ยง CORS preflight
 *  - เก็บ token / user ใน localStorage
 */
const API = (() => {
  const TOKEN_KEY = 'pk_token';
  const USER_KEY = 'pk_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
  function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
  function setUser(u) { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); }

  async function call(action, params = {}) {
    if (!window.PK_CONFIG || PK_CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
      throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js');
    }
    const body = Object.assign({ action, token: getToken() }, params);
    let res;
    try {
      res = await fetch(PK_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('คำตอบจากเซิร์ฟเวอร์ไม่ถูกต้อง'); }
    return data;
  }

  // คืน data ตรงๆ ถ้า success=false จะ throw error message
  async function callOrThrow(action, params) {
    const d = await call(action, params);
    if (d && d.success === false) {
      if ((d.error || '').indexOf('เซสชัน') >= 0) { logoutLocal(); location.reload(); }
      throw new Error(d.error || 'เกิดข้อผิดพลาด');
    }
    return d;
  }

  async function login(empId, password) {
    const d = await call('login', { empId, password });
    if (d.success === false) throw new Error(d.error);
    setToken(d.token); setUser(d.user);
    return d.user;
  }
  async function logout() { try { await call('logout', {}); } catch {} logoutLocal(); }
  function logoutLocal() { setToken(''); setUser(null); }

  return { call, callOrThrow, login, logout, logoutLocal, getToken, getUser, setUser };
})();
