
const TOKEN_KEY = 'uzchat_fs_token';
const THEME_KEY = 'uzchat_fs_theme';
const LANG_KEY = 'uzchat_fs_lang';

const I18N = {
  uz: {
    register: "Ro'yxatdan o'tish", login: "Kirish", fullName: "Ismingiz", password: "Parol",
    createAccount: "Hisob yaratish", signIn: "Tizimga kirish", demoHint: "Tayyor demo hisoblar:",
    chats: "💬 Chatlar", hiddenChats: "🔒 Yashirin", searchUsers: "@username qidirish...",
    welcomeTitle: "UzChat Pro — Real-Time Messenger",
    welcomeSub: "Chap tarafdan @username qidiring, guruh oching yoki kompyuter va telefon o'rtasida jonli yozishing.",
    typeMessage: "Xabar yozing...", myProfile: "👤 Mening profilim", online: "tarmoqda", offline: "oflayn", typing: "yozmoqda..."
  },
  ru: {
    register: "Регистрация", login: "Вход", fullName: "Ваше имя", password: "Пароль",
    createAccount: "Создать аккаунт", signIn: "Войти", demoHint: "Демо-аккаунты:",
    chats: "💬 Чаты", hiddenChats: "🔒 Скрытые", searchUsers: "Поиск @username...",
    welcomeTitle: "UzChat Pro — Мессенджер в реальном времени",
    welcomeSub: "Найдите пользователя по @username, создайте группу или общайтесь между ПК и телефоном.",
    typeMessage: "Напишите сообщение...", myProfile: "👤 Мой профиль", online: "в сети", offline: "не в сети", typing: "печатает..."
  },
  en: {
    register: "Sign Up", login: "Log In", fullName: "Full Name", password: "Password",
    createAccount: "Create Account", signIn: "Sign In", demoHint: "Demo accounts:",
    chats: "💬 Chats", hiddenChats: "🔒 Hidden", searchUsers: "Search @username...",
    welcomeTitle: "UzChat Pro — Real-Time Messenger",
    welcomeSub: "Search any @username, create group chats, or message live between your PC and phone.",
    typeMessage: "Write a message...", myProfile: "👤 My Profile", online: "online", offline: "offline", typing: "typing..."
  }
};

const EMOJIS = ['😀','😂','🥰','😎','🔥','👍','❤️','🎉','🙏','🤔','😢','😡','👏','🚀','💯','🛡️','🔒','📌','✨','🤝','🇺🇿','💻','📱','🎵'];

let token = localStorage.getItem(TOKEN_KEY) || null;
let currentUser = null;
let socket = null;
let chatsCache = [];
let usersCache = [];
let activeChatId = null;
let activeMessages = [];
let activePinnedId = null;
let sidebarMode = 'normal';
let isHiddenUnlocked = false;
let vaultActionPending = null;
let composerMode = null;
let pendingDeleteMsgId = null;
let pendingForwardMsgId = null;
let pendingAvatarUrl = undefined;
let soundEnabled = true;
let typingState = {};
let typingTimers = {};
let mediaRecorder = null;
let audioChunks = [];
let currentLang = localStorage.getItem(LANG_KEY) || 'uz';

// --- Sound Notification (Web Audio API) ---
function playNotifySound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1120, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (e) {}
}

// --- API Helper ---
async function api(url, opts = {}) {
  const headers = opts.headers || {};
  if (token) headers['x-auth-token'] = token;
  if (!(opts.body instanceof FormData) && opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}

// --- Utils ---
function escapeHTML(str) { return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }); }
function getInitials(name) { return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase(); }
function showToast(msg) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }, 2800);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-backdrop').forEach(bg => bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); }));

function renderAvatarContent(user, fallbackEmoji = null) {
  if (fallbackEmoji) return fallbackEmoji;
  if (user && user.avatarUrl) return `<img src="${user.avatarUrl}" alt="avatar">`;
  return getInitials(user ? user.name : '?');
}

// --- Theme & Language ---
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light-mode', isLight);
  const tBtn = document.getElementById('themeToggleBtn');
  if (tBtn) tBtn.textContent = isLight ? '🌙' : '☀️';
  const aBtn = document.getElementById('authThemeBtn');
  if (aBtn) aBtn.textContent = isLight ? '🌙 Qora rejim' : '☀️ Oq rejim';
}
function toggleTheme() {
  const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function setLanguage(lang) {
  currentLang = I18N[lang] ? lang : 'uz';
  localStorage.setItem(LANG_KEY, currentLang);
  document.getElementById('authLangSelect').value = currentLang;
  document.getElementById('appLangSelect').value = currentLang;
  const dict = I18N[currentLang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.placeholder = dict[key];
  });
  if (activeChatId) updateChatHeader();
}

// --- Auth ---
function switchAuthTab(tab) {
  document.getElementById('authError').style.display = 'none';
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
}

function quickFill(u) {
  switchAuthTab('login');
  document.getElementById('loginUsername').value = u;
  document.getElementById('loginPassword').value = '1234';
}

let userCheckTimer = null;
function checkUsernameLive(val, hintId, isEdit = false) {
  clearTimeout(userCheckTimer);
  const hint = document.getElementById(hintId);
  if (!val.trim()) { hint.textContent = ''; return; }
  userCheckTimer = setTimeout(async () => {
    try {
      const ex = isEdit && currentUser ? currentUser.id : '';
      const res = await fetch(`/api/check-username?username=${encodeURIComponent(val)}&excludeId=${ex}`).then(r => r.json());
      if (res.available) {
        hint.textContent = `@${res.clean} bo'sh ✓`;
        hint.className = 'field-hint hint-ok';
      } else {
        hint.textContent = res.reason === 'short' ? 'Kamida 3 ta belgi' : `@${res.clean} band!`;
        hint.className = 'field-hint hint-err';
      }
    } catch (e) {}
  }, 220);
}

function showAuthErr(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: {
        name: document.getElementById('regName').value,
        username: document.getElementById('regUsername').value,
        password: document.getElementById('regPassword').value
      }
    });
    enterApp(data.token, data.user);
  } catch (err) { showAuthErr(err.message); }
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: {
        username: document.getElementById('loginUsername').value,
        password: document.getElementById('loginPassword').value
      }
    });
    enterApp(data.token, data.user);
  } catch (err) { showAuthErr(err.message); }
}

async function enterApp(tok, user) {
  token = tok;
  currentUser = user;
  localStorage.setItem(TOKEN_KEY, tok);
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  updateMyHeader();
  connectSocket();
  await refreshAllData();
}

function handleLogout() {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
  currentUser = null;
  activeChatId = null;
  if (socket) { socket.disconnect(); socket = null; }
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
}

function updateMyHeader() {
  if (!currentUser) return;
  const av = document.getElementById('myAvatar');
  av.style.background = currentUser.color;
  av.innerHTML = renderAvatarContent(currentUser);
  document.getElementById('myDisplayName').textContent = currentUser.name;
  document.getElementById('myDisplayUser').textContent = '@' + currentUser.username;
  document.getElementById('btnAdminPanel').style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
}

// --- Socket.io Real-Time Connection ---
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('message:new', (msg) => {
    if (msg.senderId !== currentUser.id) playNotifySound();
    if (msg.chatId === activeChatId) {
      activeMessages.push(msg);
      renderMessages();
    }
    refreshChats();
  });

  socket.on('message:updated', (msg) => {
    if (msg.chatId === activeChatId) {
      const idx = activeMessages.findIndex(m => m.id === msg.id);
      if (idx >= 0) activeMessages[idx] = msg;
      renderMessages();
    }
    refreshChats();
  });

  socket.on('message:deleted', ({ chatId, msgId }) => {
    if (chatId === activeChatId) {
      activeMessages = activeMessages.filter(m => m.id !== msgId);
      renderMessages();
    }
    refreshChats();
  });

  socket.on('chat:pinned', ({ chatId, pinnedMessageId }) => {
    if (chatId === activeChatId) {
      activePinnedId = pinnedMessageId;
      updatePinnedBar();
    }
  });

  socket.on('typing', ({ chatId, name }) => {
    typingState[chatId] = name;
    if (chatId === activeChatId) updateChatHeader();
    clearTimeout(typingTimers[chatId]);
    typingTimers[chatId] = setTimeout(() => {
      delete typingState[chatId];
      if (chatId === activeChatId) updateChatHeader();
    }, 2200);
  });

  socket.on('presence:update', () => { refreshAllData(); });
  socket.on('users:changed', () => { refreshAllData(); });
  socket.on('chats:refresh', () => { refreshChats(); });

  socket.on('account:banned', () => {
    alert('Hisobingiz admin tomonidan bloklandi!');
    handleLogout();
  });
}

async function refreshAllData() {
  await Promise.all([refreshChats(), refreshUsers()]);
  if (activeChatId) updateChatHeader();
}

async function refreshChats() {
  try {
    const data = await api('/api/chats');
    chatsCache = data.chats || [];
    renderSidebar();
  } catch (e) {}
}

async function refreshUsers(q = '') {
  try {
    const data = await api('/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    usersCache = data.users || [];
    renderSidebar();
  } catch (e) {}
}

let searchDebounce = null;
function handleGlobalSearch() {
  clearTimeout(searchDebounce);
  const q = document.getElementById('globalSearch').value.trim();
  searchDebounce = setTimeout(() => refreshUsers(q), 180);
}

// --- Sidebar Rendering ---
function switchSidebarMode(mode) {
  if (mode === 'hidden') {
    if (isHiddenUnlocked) { sidebarMode = 'hidden'; renderSidebar(); }
    else openVaultPasswordFlow('openHidden');
    return;
  }
  sidebarMode = 'normal';
  renderSidebar();
}

function lockHiddenChats() {
  isHiddenUnlocked = false;
  sidebarMode = 'normal';
  const active = chatsCache.find(c => c.id === activeChatId);
  if (active && active.isHidden) { activeChatId = null; showEmptyChat(); }
  renderSidebar();
  showToast('Yashirin chatlar qulflandi 🔒');
}

function renderSidebar() {
  const listEl = document.getElementById('chatList');
  const query = document.getElementById('globalSearch').value.trim();
  document.getElementById('btnTabAll').classList.toggle('active', sidebarMode === 'normal');
  const hb = document.getElementById('btnTabHidden');
  hb.classList.toggle('active', sidebarMode === 'hidden');
  hb.classList.toggle('unlocked', isHiddenUnlocked);

  let html = '';

  if (query) {
    html += `<div class="section-label">Qidiruv natijalari (${usersCache.length})</div>`;
    usersCache.forEach(u => {
      const isMe = u.id === currentUser.id;
      html += `
        <div class="chat-item" onclick="openDirectChat('${u.id}')">
          <div class="avatar" style="background:${isMe ? '#0ea5e9' : u.color}">
            ${renderAvatarContent(u, isMe ? '🔖' : null)}
            ${!isMe ? `<span class="status-dot ${u.online ? '' : 'offline'}"></span>` : ''}
          </div>
          <div class="chat-item-body">
            <div class="chat-item-name">${isMe ? 'Saqlangan xabarlar' : escapeHTML(u.name)}</div>
            <div class="chat-item-preview" style="color:var(--accent);">@${u.username}</div>
          </div>
        </div>`;
    });
    listEl.innerHTML = html || '<div style="padding:18px; text-align:center; color:var(--text-dim);">Topilmadi</div>';
    return;
  }

  if (sidebarMode === 'hidden') {
    html += `<div class="hidden-banner"><span>🔓 Yashirin chatlar ochiq</span><button class="btn-secondary" style="padding:4px 9px; font-size:12px;" onclick="lockHiddenChats()">Qulflash</button></div>`;
  }

  const visibleChats = chatsCache.filter(c => sidebarMode === 'hidden' ? c.isHidden : !c.isHidden);

  // Saved messages shortcut
  if (sidebarMode === 'normal' && !visibleChats.some(c => c.type === 'saved')) {
    html += `
      <div class="chat-item" onclick="openDirectChat('${currentUser.id}')">
        <div class="avatar" style="background:linear-gradient(135deg,#0ea5e9,#3b82f6);">🔖</div>
        <div class="chat-item-body">
          <div class="chat-item-name">Saqlangan xabarlar</div>
          <div class="chat-item-preview">Shaxsiy bulut xotirasi</div>
        </div>
      </div>`;
  }

  visibleChats.forEach(c => {
    const peer = c.type === 'direct' ? c.members.find(m => m.id !== currentUser.id) : null;
    const title = c.type === 'saved' ? 'Saqlangan xabarlar' : (c.type === 'group' ? c.title : (peer ? peer.name : 'Chat'));
    const avBg = c.type === 'saved' ? '#0ea5e9' : (c.type === 'group' ? '#8b5cf6' : (peer ? peer.color : '#3b82f6'));
    const avHtml = c.type === 'saved' ? '🔖' : (c.type === 'group' ? '👥' : renderAvatarContent(peer));
    const lm = c.lastMessage;
    let preview = c.type === 'group' ? `${c.members.length} a'zo` : (peer ? '@' + peer.username : '');
    if (lm) {
      preview = lm.viewOnce ? '🔥 Bir martalik media' : (lm.msgType === 'image' ? '🖼️ Rasm' : (lm.msgType === 'video' ? '🎬 Video' : (lm.msgType === 'voice' ? '🎤 Ovozli xabar' : (lm.msgType === 'file' ? '📎 ' + lm.fileName : lm.text))));
    }
    html += `
      <div class="chat-item ${activeChatId === c.id ? 'active' : ''}" onclick="openChat('${c.id}')">
        <div class="avatar" style="background:${avBg}">
          ${avHtml}
          ${peer ? `<span class="status-dot ${peer.online ? '' : 'offline'}"></span>` : ''}
        </div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <div class="chat-item-name">${escapeHTML(title)}</div>
            <div class="chat-item-time">${lm ? formatTime(lm.timestamp) : ''}</div>
          </div>
          <div class="chat-item-preview">${escapeHTML(preview)}</div>
        </div>
      </div>`;
  });

  if (sidebarMode === 'normal') {
    const otherUsers = usersCache.filter(u => u.id !== currentUser.id);
    if (otherUsers.length > 0) {
      html += `<div class="section-label" style="margin-top:8px;">Barcha foydalanuvchilar</div>`;
      otherUsers.forEach(u => {
        html += `
          <div class="chat-item" onclick="openDirectChat('${u.id}')">
            <div class="avatar sm" style="background:${u.color}">
              ${renderAvatarContent(u)}
              <span class="status-dot ${u.online ? '' : 'offline'}"></span>
            </div>
            <div class="chat-item-body">
              <div class="chat-item-name" style="font-size:13.5px;">${escapeHTML(u.name)}</div>
              <div class="chat-item-preview" style="color:var(--accent); font-size:12px;">@${u.username}</div>
            </div>
          </div>`;
      });
    }
  }

  listEl.innerHTML = html;
}

// --- Chat Workspace ---
function showEmptyChat() {
  document.getElementById('chatEmpty').style.display = 'flex';
  document.getElementById('chatActiveView').style.display = 'none';
  document.getElementById('appGrid').classList.remove('mobile-chat-open');
}
function closeMobileChat() { document.getElementById('appGrid').classList.remove('mobile-chat-open'); }

async function openDirectChat(targetUserId) {
  try {
    const data = await api('/api/chats/direct', { method: 'POST', body: { targetUserId } });
    document.getElementById('globalSearch').value = '';
    await refreshChats();
    openChat(data.chatId);
  } catch (err) { showToast(err.message); }
}

async function openChat(chatId) {
  activeChatId = chatId;
  cancelComposerMode();
  document.getElementById('chatSearchBar').classList.remove('open');
  document.getElementById('inChatSearchInput').value = '';
  document.getElementById('chatEmpty').style.display = 'none';
  document.getElementById('chatActiveView').style.display = 'flex';
  document.getElementById('appGrid').classList.add('mobile-chat-open');

  try {
    const data = await api(`/api/chats/${chatId}/messages`);
    activeMessages = data.messages || [];
    activePinnedId = data.pinnedMessageId || null;
    updateChatHeader();
    updatePinnedBar();
    renderMessages();
    renderSidebar();
  } catch (err) { showToast(err.message); }
}

function updateChatHeader() {
  const chat = chatsCache.find(c => c.id === activeChatId);
  if (!chat) return;
  const dict = I18N[currentLang];
  const av = document.getElementById('peerAvatar');
  const sub = document.getElementById('peerSub');

  if (chat.type === 'saved') {
    av.style.background = '#0ea5e9'; av.innerHTML = '🔖';
    document.getElementById('peerName').textContent = 'Saqlangan xabarlar';
    sub.textContent = 'Shaxsiy bulut xotirasi';
  } else if (chat.type === 'group') {
    av.style.background = '#8b5cf6'; av.innerHTML = '👥';
    document.getElementById('peerName').textContent = chat.title;
    sub.innerHTML = typingState[activeChatId]
      ? `<span class="typing-text">${escapeHTML(typingState[activeChatId])} ${dict.typing}</span>`
      : `${chat.members.length} a'zo`;
  } else {
    const peer = chat.members.find(m => m.id !== currentUser.id);
    if (peer) {
      av.style.background = peer.color;
      av.innerHTML = renderAvatarContent(peer);
      document.getElementById('peerName').textContent = peer.name;
      sub.innerHTML = typingState[activeChatId]
        ? `<span class="typing-text">${dict.typing}</span>`
        : `@${peer.username} • ${peer.online ? dict.online : dict.offline}`;
    }
  }
  document.getElementById('btnToggleHideChat').classList.toggle('active', !!chat.isHidden);
}

function toggleChatSearch() {
  const bar = document.getElementById('chatSearchBar');
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) document.getElementById('inChatSearchInput').focus();
  else { document.getElementById('inChatSearchInput').value = ''; renderMessages(); }
}

function updatePinnedBar() {
  const bar = document.getElementById('pinnedBar');
  const pinned = activeMessages.find(m => m.id === activePinnedId);
  if (pinned) {
    bar.classList.add('open');
    document.getElementById('pinnedText').textContent = pinned.text || (pinned.msgType === 'image' ? '🖼️ Rasm' : '📎 Fayl');
  } else {
    bar.classList.remove('open');
  }
}

function scrollToPinned() {
  if (!activePinnedId) return;
  const el = document.getElementById('msg_' + activePinnedId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 1800);
  }
}
function unpinCurrent() {
  if (activeChatId && activePinnedId) socket.emit('message:pin', { chatId: activeChatId, msgId: activePinnedId });
}

function renderMessages() {
  const wrap = document.getElementById('messagesWrap');
  const q = document.getElementById('inChatSearchInput').value.trim().toLowerCase();
  const chat = chatsCache.find(c => c.id === activeChatId);
  const isGroup = chat && chat.type === 'group';
  const now = Date.now();

  let html = `<div class="system-notice">🔒 Barcha xabarlar himoyalangan ulanish orqali uzatiladi</div>`;
  const list = q ? activeMessages.filter(m => (m.text || '').toLowerCase().includes(q) || (m.fileName || '').toLowerCase().includes(q)) : activeMessages;

  list.forEach(m => {
    const isOut = m.senderId === currentUser.id;
    let bodyHtml = '';
    if (m.viewOnce) {
      const label = m.msgType === 'image' ? 'Rasm' : (m.msgType === 'video' ? 'Video' : 'Ovozli xabar');
      if (m.viewedOnce || !m.fileUrl) {
        bodyHtml += `
          <div class="view-once-card opened">
            <div class="vo-badge">✓</div>
            <div>
              <div style="font-weight:700; font-size:13.5px;">🔒 Ko'rildi</div>
              <div style="font-size:11.5px; opacity:0.8;">Bir martalik ${label.toLowerCase()} o'chdi</div>
            </div>
          </div>`;
      } else {
        bodyHtml += `
          <div class="view-once-card" onclick="openViewOnceMedia('${m.id}')">
            <div class="vo-badge">1</div>
            <div>
              <div style="font-weight:700; font-size:13.5px;">🔥 Bir martalik ${label}</div>
              <div style="font-size:11.5px; opacity:0.85;">Ko'rish uchun bosing</div>
            </div>
          </div>`;
      }
    } else if (m.msgType === 'image' && m.fileUrl) {
      bodyHtml += `<img class="msg-img" src="${m.fileUrl}" onclick="openLightbox('${m.fileUrl}')">`;
    } else if (m.msgType === 'video' && m.fileUrl) {
      bodyHtml += `<video class="msg-video" controls playsinline src="${m.fileUrl}"></video>`;
    } else if (m.msgType === 'voice' && m.fileUrl) {
      bodyHtml += `<audio class="msg-audio" controls src="${m.fileUrl}"></audio>`;
    } else if (m.msgType === 'file' && m.fileUrl) {
      bodyHtml += `<a class="msg-file-card" href="${m.fileUrl}" download="${escapeHTML(m.fileName || 'file')}">📄 <span>${escapeHTML(m.fileName || 'Fayl')}</span> ⬇️</a>`;
    }
    if (m.text) bodyHtml += `<div>${escapeHTML(m.text)}</div>`;

    let replyHtml = '';
    if (m.replyTo) {
      const orig = activeMessages.find(x => x.id === m.replyTo);
      if (orig) replyHtml = `<div class="msg-reply-box"><b>${escapeHTML(orig.senderName)}</b><div>${escapeHTML(orig.text || '📎 Media')}</div></div>`;
    }
    const fwdHtml = m.forwardedFrom ? `<div class="msg-forwarded">↪️ ${escapeHTML(m.forwardedFrom)}</div>` : '';
    const timerHtml = m.expiresAt ? `<span class="timer-pill" data-expires="${m.expiresAt}">⏱️ ${Math.max(0, Math.ceil((m.expiresAt - now)/1000))}s</span>` : '';

    let reactHtml = '';
    if (m.reactions && Object.keys(m.reactions).length > 0) {
      reactHtml = `<div class="msg-reactions">` +
        Object.entries(m.reactions).map(([em, arr]) => `<span class="reaction-chip" onclick="sendReact('${m.id}','${em}')">${em} ${arr.length}</span>`).join('') +
        `</div>`;
    }

    html += `
      <div class="msg-row ${isOut ? 'out' : 'in'}" id="msg_${m.id}">
        ${!isOut && isGroup ? `<div class="msg-sender-label">${escapeHTML(m.senderName)} (@${m.senderUsername})</div>` : ''}
        <div class="msg-actions">
          <button class="msg-act-btn" onclick="sendReact('${m.id}','❤️')">❤️</button>
          <button class="msg-act-btn" onclick="sendReact('${m.id}','👍')">👍</button>
          <button class="msg-act-btn" title="Qadash (Pin)" onclick="pinMessage('${m.id}')">📌</button>
          <button class="msg-act-btn" title="Javob" onclick="startReply('${m.id}')">↩️</button>
          <button class="msg-act-btn" title="Uzatish" onclick="openForwardModal('${m.id}')">↪️</button>
          ${isOut && m.msgType === 'text' ? `<button class="msg-act-btn" title="Tahrirlash" onclick="startEdit('${m.id}')">✏️</button>` : ''}
          <button class="msg-act-btn del" title="O'chirish" onclick="openDeleteModal('${m.id}')">🗑️</button>
        </div>
        <div class="msg-bubble">
          ${fwdHtml}${replyHtml}${bodyHtml}
          <div class="msg-meta">
            ${timerHtml}
            ${m.edited ? '<span>tahrirlangan</span>' : ''}
            <span>${formatTime(m.timestamp)}</span>
            ${isOut ? '<span>✓✓</span>' : ''}
          </div>
        </div>
        ${reactHtml}
      </div>`;
  });

  wrap.innerHTML = html;
  wrap.scrollTop = wrap.scrollHeight;
}

// Countdown refresh
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('[data-expires]').forEach(el => {
    const rem = Math.max(0, Math.ceil((Number(el.dataset.expires) - now) / 1000));
    el.textContent = `⏱️ ${rem}s`;
  });
}, 1000);

function openLightbox(url) {
  document.getElementById('lightboxImg').src = url;
  document.getElementById('lightboxOverlay').style.display = 'flex';
}

// --- Sending Messages, Media, Voice, Emoji ---
function initEmojiPicker() {
  const box = document.getElementById('emojiPicker');
  box.innerHTML = EMOJIS.map(em => `<button type="button" class="emoji-btn" onclick="insertEmoji('${em}')">${em}</button>`).join('');
}
function toggleEmojiPicker() { document.getElementById('emojiPicker').classList.toggle('open'); }
function insertEmoji(em) {
  const inp = document.getElementById('messageInput');
  inp.value += em;
  inp.focus();
}

function notifyTyping() {
  if (socket && activeChatId) socket.emit('typing', { chatId: activeChatId });
}

function sendTextMessage() {
  if (!activeChatId) return;
  const inp = document.getElementById('messageInput');
  const text = inp.value.trim();
  if (!text) return;

  if (composerMode && composerMode.type === 'edit') {
    socket.emit('message:edit', { chatId: activeChatId, msgId: composerMode.msgId, text });
    cancelComposerMode();
  } else {
    socket.emit('message:send', {
      chatId: activeChatId,
      text,
      msgType: 'text',
      replyTo: composerMode && composerMode.type === 'reply' ? composerMode.msgId : null,
      destructSec: Number(document.getElementById('destructTimer').value)
    });
    cancelComposerMode();
  }
  inp.value = '';
  document.getElementById('emojiPicker').classList.remove('open');
}

async function handleFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !activeChatId) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    showToast('Yuklanmoqda...');
    const res = await api('/api/upload', { method: 'POST', body: fd });
    let msgType = 'file';
    if (file.type.startsWith('image/')) msgType = 'image';
    else if (file.type.startsWith('video/')) msgType = 'video';
    else if (file.type.startsWith('audio/')) msgType = 'voice';
    socket.emit('message:send', {
      chatId: activeChatId,
      msgType,
      fileUrl: res.url,
      fileName: res.originalName,
      viewOnce: isViewOnceMode && ['image', 'video', 'voice'].includes(msgType),
      destructSec: Number(document.getElementById('destructTimer').value)
    });
    if (isViewOnceMode) toggleViewOnceMode(false);
  } catch (err) { showToast(err.message); }
}

async function toggleVoiceRecording() {
  if (!activeChatId) return;
  const btn = document.getElementById('voiceRecBtn');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    btn.classList.remove('recording');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('file', blob, 'voice_' + Date.now() + '.webm');
      try {
        const res = await api('/api/upload', { method: 'POST', body: fd });
        socket.emit('message:send', {
          chatId: activeChatId,
          msgType: 'voice',
          fileUrl: res.url,
          fileName: 'Ovozli xabar',
          viewOnce: isViewOnceMode,
          destructSec: Number(document.getElementById('destructTimer').value)
        });
        if (isViewOnceMode) toggleViewOnceMode(false);
      } catch (err) { showToast(err.message); }
    };
    mediaRecorder.start();
    btn.classList.add('recording');
    showToast('Ovoz yozilmoqda... To‘xtatish uchun 🎤 ni qayta bosing');
  } catch (err) {
    showToast('Mikrofonga ruxsat berilmadi (HTTPS yoki localhost talab qilinadi)');
  }
}

function sendReact(msgId, emoji) { socket.emit('message:react', { chatId: activeChatId, msgId, emoji }); }
function pinMessage(msgId) { socket.emit('message:pin', { chatId: activeChatId, msgId }); }

function startReply(msgId) {
  const m = activeMessages.find(x => x.id === msgId);
  if (!m) return;
  composerMode = { type: 'reply', msgId };
  document.getElementById('bannerTitle').textContent = `↩️ ${m.senderName} ga javob`;
  document.getElementById('bannerText').textContent = m.text || '📎 Media';
  document.getElementById('composerBanner').style.display = 'flex';
  document.getElementById('messageInput').focus();
}
function startEdit(msgId) {
  const m = activeMessages.find(x => x.id === msgId);
  if (!m) return;
  composerMode = { type: 'edit', msgId };
  document.getElementById('bannerTitle').textContent = '✏️ Xabarni tahrirlash';
  document.getElementById('bannerText').textContent = m.text;
  document.getElementById('composerBanner').style.display = 'flex';
  document.getElementById('messageInput').value = m.text;
  document.getElementById('messageInput').focus();
}
function cancelComposerMode() {
  composerMode = null;
  document.getElementById('composerBanner').style.display = 'none';
}

function openDeleteModal(msgId) {
  pendingDeleteMsgId = msgId;
  const m = activeMessages.find(x => x.id === msgId);
  document.getElementById('btnDelEveryone').style.display = (m && m.senderId === currentUser.id) ? 'block' : 'none';
  openModal('deleteModal');
}
function confirmDeleteMessage(scope) {
  socket.emit('message:delete', { chatId: activeChatId, msgId: pendingDeleteMsgId, scope });
  closeModal('deleteModal');
}

function openForwardModal(msgId) {
  pendingForwardMsgId = msgId;
  const el = document.getElementById('forwardList');
  el.innerHTML = usersCache.map(u => `
    <div class="member-check" onclick="executeForward('${u.id}')">
      <div class="avatar sm" style="background:${u.color}">${renderAvatarContent(u)}</div>
      <div><b>${u.id === currentUser.id ? 'Saqlangan xabarlar' : escapeHTML(u.name)}</b> <span style="color:var(--accent); font-size:12px;">@${u.username}</span></div>
    </div>`).join('');
  openModal('forwardModal');
}
async function executeForward(targetUserId) {
  const orig = activeMessages.find(x => x.id === pendingForwardMsgId);
  if (!orig) return;
  try {
    const res = await api('/api/chats/direct', { method: 'POST', body: { targetUserId } });
    socket.emit('message:send', {
      chatId: res.chatId,
      text: orig.text,
      msgType: orig.msgType,
      fileUrl: orig.fileUrl,
      fileName: orig.fileName,
      forwardedFrom: `${orig.senderName} (@${orig.senderUsername})`
    });
    closeModal('forwardModal');
    showToast('Xabar uzatildi ↪️');
  } catch (err) { showToast(err.message); }
}

// --- Group Creation ---
function openGroupModal() {
  document.getElementById('groupTitleInput').value = '';
  const list = document.getElementById('groupMembersList');
  list.innerHTML = usersCache.filter(u => u.id !== currentUser.id).map(u => `
    <label class="member-check">
      <input type="checkbox" value="${u.id}" class="grp-chk">
      <div class="avatar sm" style="background:${u.color}">${renderAvatarContent(u)}</div>
      <span><b>${escapeHTML(u.name)}</b> <small style="color:var(--accent);">@${u.username}</small></span>
    </label>`).join('');
  openModal('groupModal');
}
async function submitCreateGroup(e) {
  e.preventDefault();
  const title = document.getElementById('groupTitleInput').value.trim();
  const memberIds = Array.from(document.querySelectorAll('.grp-chk:checked')).map(c => c.value);
  try {
    const res = await api('/api/chats/group', { method: 'POST', body: { title, memberIds } });
    closeModal('groupModal');
    await refreshChats();
    openChat(res.chatId);
    showToast(`"${title}" guruhi yaratildi 👥`);
  } catch (err) { showToast(err.message); }
}

// --- Profile & Avatar ---
function openProfileModal() {
  pendingAvatarUrl = undefined;
  document.getElementById('editName').value = currentUser.name;
  document.getElementById('editUsername').value = currentUser.username;
  document.getElementById('editBio').value = currentUser.bio || '';
  document.getElementById('editUserHint').textContent = '';
  const av = document.getElementById('profilePreviewAvatar');
  av.style.background = currentUser.color;
  av.innerHTML = renderAvatarContent(currentUser);
  openModal('profileModal');
}
async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api('/api/upload', { method: 'POST', body: fd });
    pendingAvatarUrl = res.url;
    document.getElementById('profilePreviewAvatar').innerHTML = `<img src="${res.url}">`;
    showToast('Rasm yuklandi, Saqlash tugmasini bosing');
  } catch (err) { showToast(err.message); }
}
async function saveProfile(e) {
  e.preventDefault();
  try {
    const res = await api('/api/profile', {
      method: 'PUT',
      body: {
        name: document.getElementById('editName').value,
        username: document.getElementById('editUsername').value,
        bio: document.getElementById('editBio').value,
        avatarUrl: pendingAvatarUrl
      }
    });
    currentUser = res.user;
    updateMyHeader();
    closeModal('profileModal');
    showToast('Profil yangilandi ✓');
  } catch (err) { showToast(err.message); }
}

// --- Hidden Vault, Security & Lock ---
async function toggleHideCurrentChat() {
  if (!activeChatId) return;
  if (!currentUser.hasHiddenPassword) {
    openVaultPasswordFlow('hideChat');
    return;
  }
  try {
    const res = await api(`/api/chats/${activeChatId}/toggle-hide`, { method: 'POST' });
    await refreshChats();
    if (res.isHidden && !isHiddenUnlocked) { activeChatId = null; showEmptyChat(); }
    else updateChatHeader();
    showToast(res.isHidden ? 'Chat yashirildi 🔒' : 'Chat asosiy ro‘yxatga qaytarildi');
  } catch (err) { showToast(err.message); }
}

function openVaultPasswordFlow(action) {
  vaultActionPending = action;
  const isSetup = !currentUser.hasHiddenPassword || action === 'changePass';
  document.getElementById('vaultPassInput1').value = '';
  document.getElementById('vaultPassInput2').value = '';
  document.getElementById('vaultPassErr').style.display = 'none';
  document.getElementById('vaultModalTitle').textContent = isSetup ? '🔐 Shaxsiy yashirin parol' : '🔒 Yashirin chatlarni ochish';
  document.getElementById('vaultModalDesc').textContent = isSetup ? 'Yashirin chatlaringiz uchun o‘zingiz xohlagan parol yarating.' : 'Shaxsiy yashirin chat parolingizni kiriting.';
  document.getElementById('vaultConfirmGroup').style.display = isSetup ? 'block' : 'none';
  openModal('vaultPassModal');
}

async function submitVaultPassword(e) {
  e.preventDefault();
  const p1 = document.getElementById('vaultPassInput1').value;
  const p2 = document.getElementById('vaultPassInput2').value;
  const errEl = document.getElementById('vaultPassErr');
  const isSetup = !currentUser.hasHiddenPassword || vaultActionPending === 'changePass';
  try {
    if (isSetup) {
      if (p1 !== p2) throw new Error('Parollar mos kelmadi!');
      await api('/api/security/vault-password', { method: 'POST', body: { password: p1 } });
      currentUser.hasHiddenPassword = true;
      if (vaultActionPending === 'hideChat' && activeChatId) {
        await api(`/api/chats/${activeChatId}/toggle-hide`, { method: 'POST' });
        activeChatId = null; showEmptyChat();
      } else if (vaultActionPending === 'openHidden') {
        isHiddenUnlocked = true; sidebarMode = 'hidden';
      }
      showToast('Shaxsiy parol saqlandi 🔐');
    } else {
      await api('/api/security/verify-vault', { method: 'POST', body: { password: p1 } });
      isHiddenUnlocked = true; sidebarMode = 'hidden';
      showToast('Yashirin chatlar ochildi 🔓');
    }
    closeModal('vaultPassModal');
    await refreshChats();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    const box = document.getElementById('vaultPassBox');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  }
}

async function openSecurityModal() {
  document.getElementById('vaultPassStatusText').textContent = currentUser.hasHiddenPassword ? 'O‘rnatilgan ✓' : 'O‘rnatilmagan';
  const sdBtn = document.getElementById('btnSaveDeletedToggle');
  if (sdBtn) sdBtn.textContent = currentUser.saveDeleted ? 'Yoqilgan ✓' : 'O‘chirilgan';
  try {
    const res = await api('/api/security/logs');
    document.getElementById('securityLogList').innerHTML = (res.logs || []).map(l =>
      `<div class="log-item"><span>${escapeHTML(l.text)}</span><span style="color:var(--text-dim);">${formatTime(l.time)}</span></div>`
    ).join('');
  } catch (e) {}
  openModal('securityModal');
}
function openChangeVaultPassword() { closeModal('securityModal'); openVaultPasswordFlow('changePass'); }
function togglePrivacyBlur() {
  document.body.classList.toggle('privacy-blur');
  document.getElementById('btnPrivacyToggle').textContent = document.body.classList.contains('privacy-blur') ? 'O‘chirish' : 'Yoqish';
}
function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('btnSoundToggle').textContent = soundEnabled ? 'Yoqilgan 🔊' : 'O‘chirilgan 🔇';
}

function lockEntireApp() {
  document.getElementById('appLockInput').value = '';
  document.getElementById('appLockErr').style.display = 'none';
  document.getElementById('appLockOverlay').style.display = 'flex';
}
async function unlockEntireApp(e) {
  e.preventDefault();
  try {
    await api('/api/security/verify-lock', { method: 'POST', body: { password: document.getElementById('appLockInput').value } });
    document.getElementById('appLockOverlay').style.display = 'none';
  } catch (err) {
    const el = document.getElementById('appLockErr');
    el.textContent = err.message; el.style.display = 'block';
  }
}

// --- Admin Panel ---
async function openAdminModal() {
  try {
    const data = await api('/api/admin/overview');
    const s = data.stats;
    document.getElementById('adminStatsGrid').innerHTML = `
      <div class="stat-card"><div class="stat-val">${s.totalUsers}</div><div class="stat-lbl">Foydalanuvchilar</div></div>
      <div class="stat-card"><div class="stat-val" style="color:var(--success);">${s.onlineUsers}</div><div class="stat-lbl">Tarmoqda (Online)</div></div>
      <div class="stat-card"><div class="stat-val">${s.totalMessages}</div><div class="stat-lbl">Jami xabarlar</div></div>
      <div class="stat-card"><div class="stat-val">${s.totalGroups}</div><div class="stat-lbl">Guruhlar</div></div>
    `;
    document.getElementById('adminUsersBody').innerHTML = data.users.map(u => `
      <tr>
        <td><b>${escapeHTML(u.name)}</b></td>
        <td style="color:var(--accent);">@${u.username}</td>
        <td>${u.isBanned ? '<span class="ban-badge">Bloklangan</span>' : (u.online ? '🟢 Online' : '⚪ Oflayn')}</td>
        <td><span class="role-badge">${u.role}</span></td>
        <td>
          ${u.id !== currentUser.id ? `
            <button class="btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="adminToggleBan('${u.id}')">${u.isBanned ? 'Blokdan chiqarish' : 'Bloklash'}</button>
            <button class="btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="adminToggleRole('${u.id}')">${u.role === 'admin' ? 'User qilish' : 'Admin qilish'}</button>
          ` : '<small style="color:var(--text-dim);">Siz</small>'}
        </td>
      </tr>`).join('');
    openModal('adminModal');
  } catch (err) { showToast(err.message); }
}
async function adminToggleBan(uid) {
  try { await api(`/api/admin/users/${uid}/ban`, { method: 'POST' }); openAdminModal(); } catch (err) { showToast(err.message); }
}
async function adminToggleRole(uid) {
  try { await api(`/api/admin/users/${uid}/role`, { method: 'POST' }); openAdminModal(); } catch (err) { showToast(err.message); }
}

// --- Bootstrap ---
(async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  setLanguage(currentLang);
  initEmojiPicker();
  if (token) {
    try {
      const data = await api('/api/me');
      enterApp(token, data.user);
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      token = null;
    }
  }
})();


// --- PWA Registration & Install Prompt ---
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const b1 = document.getElementById('btnInstallApp');
  const b2 = document.getElementById('btnInstallAppMain');
  if (b1) b1.style.display = 'inline-flex';
  if (b2) b2.style.display = 'inline-flex';
});

async function installPWA() {
  if (!deferredInstallPrompt) {
    showToast('Brauzer menyusidan "Bosh ekranga qo‘shish" (Add to Home Screen) ni bosing');
    return;
  }
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('UzChat Pro ilovasi o‘rnatildi! 📲');
    const b1 = document.getElementById('btnInstallApp');
    const b2 = document.getElementById('btnInstallAppMain');
    if (b1) b1.style.display = 'none';
    if (b2) b2.style.display = 'none';
  }
  deferredInstallPrompt = null;
}


// ==================== WALLPAPERS (TELEGRAM STYLE) ====================
const WP_KEY = 'uzchat_fs_wallpaper';
const WP_CUSTOM_KEY = 'uzchat_fs_wallpaper_custom';

function applyWallpaper() {
  const wrap = document.getElementById('messagesWrap');
  if (!wrap) return;
  const wp = localStorage.getItem(WP_KEY) || 'wp-default';
  wrap.className = 'messages-wrap';
  wrap.style.backgroundImage = '';
  if (wp === 'wp-custom') {
    const customUrl = localStorage.getItem(WP_CUSTOM_KEY);
    if (customUrl) {
      wrap.style.backgroundImage = `linear-gradient(rgba(15,23,42,0.35), rgba(15,23,42,0.35)), url("${customUrl}")`;
      wrap.style.backgroundSize = 'cover';
      wrap.style.backgroundPosition = 'center';
    } else {
      wrap.classList.add('wp-default');
    }
  } else {
    wrap.classList.add(wp);
  }
  document.querySelectorAll('.wp-option').forEach(el => {
    el.classList.toggle('active', el.dataset.wp === wp);
  });
}

function openWallpaperModal() {
  applyWallpaper();
  openModal('wallpaperModal');
}

function selectWallpaper(wpName) {
  localStorage.setItem(WP_KEY, wpName);
  applyWallpaper();
  showToast('Chat orqa foni o‘zgartirildi 🖼️');
}

async function handleCustomWallpaper(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    showToast('Orqa fon yuklanmoqda...');
    const res = await api('/api/upload', { method: 'POST', body: fd });
    localStorage.setItem(WP_CUSTOM_KEY, res.url);
    localStorage.setItem(WP_KEY, 'wp-custom');
    applyWallpaper();
    showToast('Shaxsiy orqa fon o‘rnatildi ✓');
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== VIEW-ONCE (BIR MARTALIK MEDIA) ====================
let isViewOnceMode = false;
let currentViewOnceMsg = null;

function toggleViewOnceMode(forceState) {
  isViewOnceMode = (typeof forceState === 'boolean') ? forceState : !isViewOnceMode;
  const btn = document.getElementById('viewOnceBtn');
  if (btn) btn.classList.toggle('view-once-active', isViewOnceMode);
  if (isViewOnceMode) {
    showToast('1️⃣ Bir martalik rejim yoqildi! Endi 📎 (rasm/video) yoki 🎤 (ovozli xabar) yuboring.');
  }
}

function openViewOnceMedia(msgId) {
  const m = activeMessages.find(x => x.id === msgId);
  if (!m || !m.fileUrl || m.viewedOnce) return;
  currentViewOnceMsg = m;
  const box = document.getElementById('voMediaContainer');
  const title = document.getElementById('voModalTitle');
  if (m.msgType === 'image') {
    title.textContent = '🔥 Bir martalik rasm';
    box.innerHTML = `<img src="${m.fileUrl}" style="max-width:100%; max-height:62vh; border-radius:12px;">`;
  } else if (m.msgType === 'video') {
    title.textContent = '🔥 Bir martalik video';
    box.innerHTML = `<video src="${m.fileUrl}" controls autoplay playsinline style="max-width:100%; max-height:62vh; border-radius:12px; background:#000;"></video>`;
  } else if (m.msgType === 'voice') {
    title.textContent = '🔥 Bir martalik ovozli xabar';
    box.innerHTML = `<audio src="${m.fileUrl}" controls autoplay style="width:100%; margin:20px 0;"></audio>`;
  }
  openModal('viewOnceModal');
}

function closeViewOnceModal() {
  const box = document.getElementById('voMediaContainer');
  box.innerHTML = '';
  closeModal('viewOnceModal');
  if (currentViewOnceMsg && socket) {
    socket.emit('message:view_once_opened', { chatId: currentViewOnceMsg.chatId, msgId: currentViewOnceMsg.id });
    currentViewOnceMsg = null;
  }
}

// ==================== DELETED MESSAGES ARCHIVE ====================
async function toggleSaveDeleted() {
  try {
    const res = await api('/api/security/save-deleted', { method: 'POST' });
    currentUser.saveDeleted = res.saveDeleted;
    document.getElementById('btnSaveDeletedToggle').textContent = res.saveDeleted ? 'Yoqilgan ✓' : 'O‘chirilgan';
    showToast(res.saveDeleted ? 'O‘chirilgan xabarlar arxivda saqlanadi ♻️' : 'O‘chirilgan xabarlarni saqlash o‘chirildi');
  } catch (err) { showToast(err.message); }
}

async function openDeletedArchiveModal() {
  try {
    const data = await api('/api/deleted-messages');
    const items = data.items || [];
    const listEl = document.getElementById('deletedArchiveList');
    if (items.length === 0) {
      listEl.innerHTML = '<div style="text-align:center; padding:26px; color:var(--text-dim);">Hozircha o‘chirilgan xabarlar arxivi bo‘sh.</div>';
    } else {
      listEl.innerHTML = items.map(it => {
        let mediaHtml = '';
        if (it.msg_type === 'image' && it.file_url) mediaHtml = `<img src="${it.file_url}" style="max-width:180px; border-radius:8px; margin-top:6px; cursor:pointer;" onclick="openLightbox('${it.file_url}')">`;
        else if (it.msg_type === 'video' && it.file_url) mediaHtml = `<video src="${it.file_url}" controls style="max-width:220px; border-radius:8px; margin-top:6px;"></video>`;
        else if (it.msg_type === 'voice' && it.file_url) mediaHtml = `<audio src="${it.file_url}" controls style="width:220px; margin-top:6px;"></audio>`;
        else if (it.msg_type === 'file' && it.file_url) mediaHtml = `<div style="margin-top:4px;"><a href="${it.file_url}" download style="color:var(--accent);">📎 ${escapeHTML(it.file_name || 'Fayl')}</a></div>`;
        return `
          <div class="archive-item">
            <div class="archive-item-head">
              <span><b>${escapeHTML(it.sender_name)}</b> (@${escapeHTML(it.sender_username)})</span>
              <span>O'chirildi: ${formatTime(it.deleted_at)}</span>
            </div>
            <div class="archive-item-body">
              ${it.text ? escapeHTML(it.text) : ''}
              ${mediaHtml}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim);">
              <span>O'chirgan: ${escapeHTML(it.deleted_by || '')}</span>
              <button class="btn-secondary" style="padding:3px 8px; font-size:11.5px;" onclick="deleteArchiveItem('${it.id}')">O'chirish</button>
            </div>
          </div>`;
      }).join('');
    }
    openModal('deletedArchiveModal');
  } catch (err) { showToast(err.message); }
}

async function deleteArchiveItem(id) {
  try { await api('/api/deleted-messages/' + id, { method: 'DELETE' }); openDeletedArchiveModal(); } catch (err) { showToast(err.message); }
}

async function clearAllDeletedArchive() {
  if (!confirm('Barcha saqlangan o‘chirilgan xabarlarni o‘chirmoqchimisiz?')) return;
  try { await api('/api/deleted-messages', { method: 'DELETE' }); openDeletedArchiveModal(); showToast('Arxiv tozalandi'); } catch (err) { showToast(err.message); }
}

// Apply saved wallpaper on load
window.addEventListener('DOMContentLoaded', applyWallpaper);
applyWallpaper();

// ==================== TELEFON "ORQAGA" (BACK) TUGMASINI BOSHQARISH ====================
(function () {
  const grid = document.getElementById('appGrid');
  if (!grid) return;

  // Chat ochilganda brauzer tarixiga bitta qadam qo'shish
  const observer = new MutationObserver(() => {
    const isChatOpen = grid.classList.contains('mobile-chat-open');
    if (isChatOpen && (!history.state || history.state.view !== 'chat')) {
      history.pushState({ view: 'chat' }, '');
    } else if (!isChatOpen && history.state && history.state.view === 'chat') {
      history.back();
    }
  });
  observer.observe(grid, { attributes: true, attributeFilter: ['class'] });

  // Telefonning "Orqaga" tugmasi bosilganda
  window.addEventListener('popstate', () => {
    // 1. Agar biror oyna (modal) ochiq bo'lsa, avval o'shani yopadi
    const openModal = document.querySelector('.modal-backdrop.open');
    if (openModal) {
      openModal.classList.remove('open');
      return;
    }
    // 2. Agar chat ichida bo'lsa, ilovadan chiqmasdan chatlar ro'yxatiga qaytaradi
    if (grid.classList.contains('mobile-chat-open')) {
      if (typeof closeMobileChat === 'function') {
        closeMobileChat();
      } else {
        grid.classList.remove('mobile-chat-open');
      }
    }
  });
})();

// ==================== YASHIRIN CHATLARNI TO'LIQ HIMOYALASH ====================
(function () {
  // 1. Yashirin chatga qo'shilgan foydalanuvchilarni "Barcha foydalanuvchilar" ro'yxatidan yashirish
  const _origRenderSidebar = renderSidebar;
  renderSidebar = function () {
    _origRenderSidebar();
    const query = document.getElementById('globalSearch').value.trim();
    if (sidebarMode === 'normal' && !query) {
      const hiddenUserIds = new Set();
      chatsCache.forEach(c => {
        if (c.type === 'direct' && c.isHidden) {
          const peer = c.members.find(m => m.id !== currentUser.id);
          if (peer) hiddenUserIds.add(peer.id);
        }
      });

      const listEl = document.getElementById('chatList');
      hiddenUserIds.forEach(uid => {
        const el = listEl.querySelector(`.chat-item[onclick="openDirectChat('${uid}')"]`);
        if (el) el.remove();
      });

      // Agar "Barcha foydalanuvchilar" bo'limida boshqa odam qolmasa, sarlavhasini ham yashirish
      const labels = listEl.querySelectorAll('.section-label');
      labels.forEach(lbl => {
        if (lbl.textContent.trim().toLowerCase() === 'barcha foydalanuvchilar' && !lbl.nextElementSibling) {
          lbl.remove();
        }
      });
    }
  };

  // 2. Qidiruvdan topib ustiga bosilganda ham, yashirin chat bo'lsa parol so'rash
  const _origOpenChat = openChat;
  openChat = async function (chatId) {
    const chat = chatsCache.find(c => c.id === chatId);
    if (chat && chat.isHidden && !isHiddenUnlocked) {
      openVaultPasswordFlow('openHidden');
      showToast('🔒 Bu chat yashirilgan! Ochish uchun parolni kiriting.');
      return;
    }
    return _origOpenChat(chatId);
  };
})();
