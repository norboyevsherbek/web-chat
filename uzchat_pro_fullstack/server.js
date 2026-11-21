const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const initSqlJs = require('sql.js');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'uzchat.sqlite');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// File Upload Config (Images, Videos, Voice Audio, Files — up to 50MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const safeName = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function hashPass(pass) {
  return crypto.createHash('sha256').update('uzchat_salt_2026:' + String(pass)).digest('hex');
}

function makeDirectChatId(u1, u2) {
  if (u1 === u2) return 'saved_' + u1;
  return [u1, u2].sort().join('__');
}

function normalizeUsername(val) {
  return String(val || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
}

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'];

const onlineUsers = new Map(); // userId -> Set(socketId)
const sessions = new Map();    // token -> userId

let db;

function saveDatabase() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function addLog(userId, text) {
  runSql('INSERT INTO security_logs (user_id, text, created_at) VALUES (?, ?, ?)', [userId, text, Date.now()]);
}

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    bio: u.bio || '',
    color: u.color,
    avatarUrl: u.avatar_url || null,
    role: u.role || 'user',
    isBanned: !!u.is_banned,
    hasHiddenPassword: !!u.hidden_password,
    saveDeleted: u.save_deleted === undefined ? true : !!u.save_deleted,
    online: onlineUsers.has(u.id),
    lastSeen: u.last_seen
  };
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  const uid = sessions.get(token);
  if (!uid) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  const user = queryOne('SELECT * FROM users WHERE id = ?', [uid]);
  if (!user) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
  if (user.is_banned) return res.status(403).json({ error: 'Hisobingiz admin tomonidan bloklangan!' });
  req.user = user;
  next();
}

// ==================== API ROUTES ====================

app.get('/api/check-username', (req, res) => {
  const clean = normalizeUsername(req.query.username);
  const excludeId = req.query.excludeId || '';
  if (clean.length < 3) return res.json({ available: false, reason: 'short' });
  const existing = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [clean, excludeId]);
  res.json({ available: !existing, clean });
});

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');

  if (!name || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Ism, @username (kamida 3 belgi) va parol (kamida 4 belgi) kiriting.' });
  }
  const exists = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json({ error: `@${username} allaqachon band.` });

  const count = queryOne('SELECT COUNT(*) as c FROM users').c;
  const uid = 'u_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const role = count === 0 ? 'admin' : 'user';
  const color = AVATAR_COLORS[count % AVATAR_COLORS.length];

  runSql(
    'INSERT INTO users (id, name, username, password, bio, color, role, is_banned, save_deleted, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)',
    [uid, name, username, hashPass(password), 'UzChat Pro foydalanuvchisi', color, role, Date.now(), Date.now()]
  );
  addLog(uid, 'Yangi hisob yaratildi');

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, uid);
  const user = queryOne('SELECT * FROM users WHERE id = ?', [uid]);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || user.password !== hashPass(password)) {
    return res.status(401).json({ error: 'Username yoki parol noto‘g‘ri!' });
  }
  if (user.is_banned) {
    return res.status(403).json({ error: 'Hisobingiz admin tomonidan bloklangan!' });
  }
  runSql('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), user.id]);
  addLog(user.id, 'Tizimga muvaffaqiyatli kirildi');
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.id);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.put('/api/profile', authMiddleware, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  const username = normalizeUsername(req.body.username);
  const bio = String(req.body.bio || '').trim().slice(0, 100);
  const avatarUrl = req.body.avatarUrl !== undefined ? req.body.avatarUrl : req.user.avatar_url;

  if (!name || username.length < 3) return res.status(400).json({ error: 'Ism va @username to‘g‘ri kiritilishi shart' });
  const taken = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id]);
  if (taken) return res.status(409).json({ error: `@${username} allaqachon band` });

  runSql('UPDATE users SET name = ?, username = ?, bio = ?, avatar_url = ? WHERE id = ?', [name, username, bio, avatarUrl, req.user.id]);
  addLog(req.user.id, `Profil yangilandi (@${username})`);
  const updated = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  io.emit('users:changed');
  res.json({ user: sanitizeUser(updated) });
});

// File / Image / Video / Voice Upload
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl tanlanmadi' });
  res.json({
    url: '/uploads/' + req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size
  });
});

app.get('/api/users', authMiddleware, (req, res) => {
  const q = normalizeUsername(req.query.q || '');
  const rawQ = String(req.query.q || '').trim().toLowerCase();
  const all = queryAll('SELECT * FROM users WHERE is_banned = 0');
  const filtered = rawQ
    ? all.filter(u => u.username.includes(q) || u.name.toLowerCase().includes(rawQ))
    : all;
  res.json({ users: filtered.map(sanitizeUser) });
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const hiddenRows = queryAll('SELECT chat_id FROM hidden_chats WHERE user_id = ?', [uid]);
  const hiddenSet = new Set(hiddenRows.map(r => r.chat_id));

  const chatRows = queryAll(`
    SELECT c.* FROM chats c
    JOIN chat_members cm ON c.id = cm.chat_id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `, [uid]);

  const chats = chatRows.map(c => {
    const members = queryAll(`
      SELECT u.* FROM users u
      JOIN chat_members cm ON u.id = cm.user_id
      WHERE cm.chat_id = ?
    `, [c.id]).map(sanitizeUser);

    const lastMsg = queryOne(`
      SELECT * FROM messages
      WHERE chat_id = ? AND (deleted_for NOT LIKE ?)
      ORDER BY created_at DESC LIMIT 1
    `, [c.id, `%"${uid}"%`]);

    return {
      id: c.id,
      type: c.type,
      title: c.title,
      pinnedMessageId: c.pinned_message_id,
      updatedAt: c.updated_at,
      isHidden: hiddenSet.has(c.id),
      members,
      lastMessage: lastMsg ? formatMessageRow(lastMsg) : null
    };
  });

  res.json({ chats });
});

app.post('/api/chats/direct', authMiddleware, (req, res) => {
  const targetId = req.body.targetUserId;
  const uid = req.user.id;
  const target = queryOne('SELECT * FROM users WHERE id = ?', [targetId]);
  if (!target) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const cid = makeDirectChatId(uid, targetId);
  const existing = queryOne('SELECT * FROM chats WHERE id = ?', [cid]);
  if (!existing) {
    const type = uid === targetId ? 'saved' : 'direct';
    runSql('INSERT INTO chats (id, type, title, updated_at) VALUES (?, ?, ?, ?)', [cid, type, null, Date.now()]);
    runSql('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [cid, uid]);
    if (uid !== targetId) {
      runSql('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [cid, targetId]);
    }
  }
  res.json({ chatId: cid });
});

app.post('/api/chats/group', authMiddleware, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 50);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  if (!title) return res.status(400).json({ error: 'Guruh nomini kiriting' });

  const cid = 'grp_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const uniqueMembers = Array.from(new Set([req.user.id, ...memberIds]));
  runSql('INSERT INTO chats (id, type, title, created_by, updated_at) VALUES (?, ?, ?, ?, ?)', [cid, 'group', title, req.user.id, Date.now()]);
  uniqueMembers.forEach(mid => {
    runSql('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [cid, mid]);
  });

  uniqueMembers.forEach(mid => emitToUser(mid, 'chats:refresh'));
  res.json({ chatId: cid });
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const uid = req.user.id;
  const member = queryOne('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, uid]);
  if (!member) return res.status(403).json({ error: 'Ruxsat yo‘q' });

  const now = Date.now();
  const rows = queryAll(`
    SELECT * FROM messages
    WHERE chat_id = ? AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at ASC
  `, [chatId, now]);

  const visible = rows.map(formatMessageRow).filter(m => !m.deletedFor.includes(uid));
  const chat = queryOne('SELECT * FROM chats WHERE id = ?', [chatId]);
  res.json({ messages: visible, pinnedMessageId: chat ? chat.pinned_message_id : null });
});

// ==================== DELETED MESSAGES ARCHIVE ====================
app.get('/api/deleted-messages', authMiddleware, (req, res) => {
  const rows = queryAll('SELECT * FROM deleted_messages WHERE user_id = ? ORDER BY deleted_at DESC LIMIT 100', [req.user.id]);
  res.json({ items: rows });
});

app.delete('/api/deleted-messages', authMiddleware, (req, res) => {
  runSql('DELETE FROM deleted_messages WHERE user_id = ?', [req.user.id]);
  addLog(req.user.id, 'O‘chirilgan xabarlar arxivi tozalandi');
  res.json({ ok: true });
});

app.delete('/api/deleted-messages/:id', authMiddleware, (req, res) => {
  runSql('DELETE FROM deleted_messages WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/security/save-deleted', authMiddleware, (req, res) => {
  const nextVal = req.user.save_deleted ? 0 : 1;
  runSql('UPDATE users SET save_deleted = ? WHERE id = ?', [nextVal, req.user.id]);
  addLog(req.user.id, `O‘chirilgan xabarlarni saqlash: ${nextVal ? 'Yoqildi' : 'O‘chirildi'}`);
  res.json({ saveDeleted: !!nextVal });
});

// ==================== SECURITY & VAULT ====================
app.post('/api/security/vault-password', authMiddleware, (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 3) return res.status(400).json({ error: 'Parol kamida 3 ta belgi bo‘lsin' });
  runSql('UPDATE users SET hidden_password = ? WHERE id = ?', [hashPass(password), req.user.id]);
  addLog(req.user.id, 'Yashirin chatlar uchun shaxsiy parol o‘rnatildi / yangilandi');
  res.json({ ok: true });
});

app.post('/api/security/verify-vault', authMiddleware, (req, res) => {
  const password = String(req.body.password || '');
  if (!req.user.hidden_password) return res.status(400).json({ error: 'Parol o‘rnatilmagan' });
  const ok = hashPass(password) === req.user.hidden_password;
  if (!ok) {
    addLog(req.user.id, '⚠️ Yashirin chatga noto‘g‘ri parol kiritildi');
    return res.status(401).json({ error: 'Noto‘g‘ri parol!' });
  }
  addLog(req.user.id, 'Yashirin chatlar bo‘limi ochildi');
  res.json({ ok: true });
});

app.post('/api/security/verify-lock', authMiddleware, (req, res) => {
  const password = String(req.body.password || '');
  const h = hashPass(password);
  const ok = h === req.user.password || (req.user.hidden_password && h === req.user.hidden_password);
  if (!ok) {
    addLog(req.user.id, '⚠️ Ilovani ochishda noto‘g‘ri parol');
    return res.status(401).json({ error: 'Parol noto‘g‘ri!' });
  }
  res.json({ ok: true });
});

app.post('/api/chats/:chatId/toggle-hide', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const uid = req.user.id;
  if (!req.user.hidden_password) return res.status(400).json({ error: 'Avval yashirin parol o‘rnating' });
  const exists = queryOne('SELECT 1 FROM hidden_chats WHERE user_id = ? AND chat_id = ?', [uid, chatId]);
  if (exists) {
    runSql('DELETE FROM hidden_chats WHERE user_id = ? AND chat_id = ?', [uid, chatId]);
    addLog(uid, 'Chat yashirin bo‘limdan chiqarildi');
    res.json({ isHidden: false });
  } else {
    runSql('INSERT INTO hidden_chats (user_id, chat_id) VALUES (?, ?)', [uid, chatId]);
    addLog(uid, 'Chat yashirin bo‘limga qulflandi');
    res.json({ isHidden: true });
  }
});

app.get('/api/security/logs', authMiddleware, (req, res) => {
  const logs = queryAll('SELECT text, created_at as time FROM security_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user.id]);
  res.json({ logs });
});

// ==================== ADMIN PANEL API ====================
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Faqat adminlar uchun!' });
  next();
}

app.get('/api/admin/overview', authMiddleware, adminOnly, (req, res) => {
  const users = queryAll('SELECT * FROM users ORDER BY created_at DESC').map(sanitizeUser);
  const msgCount = queryOne('SELECT COUNT(*) as c FROM messages').c;
  const groupCount = queryOne("SELECT COUNT(*) as c FROM chats WHERE type = 'group'").c;
  res.json({
    stats: {
      totalUsers: users.length,
      onlineUsers: onlineUsers.size,
      totalMessages: msgCount,
      totalGroups: groupCount
    },
    users
  });
});

app.post('/api/admin/users/:targetId/ban', authMiddleware, adminOnly, (req, res) => {
  const { targetId } = req.params;
  if (targetId === req.user.id) return res.status(400).json({ error: 'O‘zingizni bloklay olmaysiz' });
  const target = queryOne('SELECT * FROM users WHERE id = ?', [targetId]);
  if (!target) return res.status(404).json({ error: 'Topilmadi' });
  const nextBan = target.is_banned ? 0 : 1;
  runSql('UPDATE users SET is_banned = ? WHERE id = ?', [nextBan, targetId]);
  addLog(req.user.id, `Admin: @${target.username} ${nextBan ? 'bloklandi' : 'blokdan chiqarildi'}`);
  if (nextBan) {
    emitToUser(targetId, 'account:banned');
    for (const [tok, uid] of sessions.entries()) {
      if (uid === targetId) sessions.delete(tok);
    }
  }
  io.emit('users:changed');
  res.json({ isBanned: !!nextBan });
});

app.post('/api/admin/users/:targetId/role', authMiddleware, adminOnly, (req, res) => {
  const { targetId } = req.params;
  if (targetId === req.user.id) return res.status(400).json({ error: 'O‘z rolingizni o‘zgartira olmaysiz' });
  const target = queryOne('SELECT * FROM users WHERE id = ?', [targetId]);
  if (!target) return res.status(404).json({ error: 'Topilmadi' });
  const nextRole = target.role === 'admin' ? 'user' : 'admin';
  runSql('UPDATE users SET role = ? WHERE id = ?', [nextRole, targetId]);
  res.json({ role: nextRole });
});

// ==================== SOCKET.IO REAL-TIME ====================
function formatMessageRow(row) {
  let reactions = {};
  let deletedFor = [];
  try { reactions = JSON.parse(row.reactions || '{}'); } catch(e) {}
  try { deletedFor = JSON.parse(row.deleted_for || '[]'); } catch(e) {}
  const sender = queryOne('SELECT id, name, username, color, avatar_url FROM users WHERE id = ?', [row.sender_id]);
  const isViewOnce = !!row.view_once;
  const isViewed = !!row.viewed_once;
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    senderName: sender ? sender.name : 'Foydalanuvchi',
    senderUsername: sender ? sender.username : '',
    text: row.text || '',
    msgType: row.msg_type || 'text', // text | image | video | voice | file
    fileUrl: (isViewOnce && isViewed) ? null : (row.file_url || null),
    fileName: row.file_name || null,
    viewOnce: isViewOnce,
    viewedOnce: isViewed,
    replyTo: row.reply_to || null,
    forwardedFrom: row.forwarded_from || null,
    edited: !!row.edited,
    reactions,
    deletedFor,
    expiresAt: row.expires_at || null,
    timestamp: row.created_at
  };
}

function archiveDeletedMessage(msgRow, targetUserIds, deletedByName) {
  const sender = queryOne('SELECT name, username FROM users WHERE id = ?', [msgRow.sender_id]);
  const now = Date.now();
  targetUserIds.forEach(uid => {
    const u = queryOne('SELECT save_deleted FROM users WHERE id = ?', [uid]);
    if (u && u.save_deleted) {
      const aid = 'del_' + now + '_' + crypto.randomBytes(3).toString('hex');
      const fileToSave = (msgRow.view_once && msgRow.viewed_once) ? null : (msgRow.file_url || null);
      runSql(`
        INSERT INTO deleted_messages (id, user_id, chat_id, sender_name, sender_username, text, msg_type, file_url, file_name, deleted_by, deleted_at, original_created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        aid, uid, msgRow.chat_id,
        sender ? sender.name : 'Foydalanuvchi',
        sender ? sender.username : '',
        msgRow.text || '',
        msgRow.msg_type || 'text',
        fileToSave,
        msgRow.file_name || null,
        deletedByName,
        now,
        msgRow.created_at
      ]);
    }
  });
}

function emitToUser(userId, event, payload) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  sockets.forEach(sid => io.to(sid).emit(event, payload));
}

function emitToChatMembers(chatId, event, payload) {
  const members = queryAll('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
  members.forEach(m => emitToUser(m.user_id, event, payload));
}

io.on('connection', (socket) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const uid = sessions.get(token);
  if (!uid) {
    socket.disconnect();
    return;
  }

  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);
  io.emit('presence:update', { userId: uid, online: true });

  socket.on('message:send', (data) => {
    const { chatId, text, msgType, fileUrl, fileName, replyTo, forwardedFrom, destructSec, viewOnce } = data || {};
    const isMember = queryOne('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, uid]);
    if (!isMember) return;

    const mid = 'm_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const now = Date.now();
    const expiresAt = destructSec && Number(destructSec) > 0 ? now + Number(destructSec) * 1000 : null;
    const isVO = viewOnce && ['image', 'video', 'voice'].includes(msgType) ? 1 : 0;

    runSql(`
      INSERT INTO messages (id, chat_id, sender_id, text, msg_type, file_url, file_name, view_once, viewed_once, reply_to, forwarded_from, edited, reactions, deleted_for, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, '{}', '[]', ?, ?)
    `, [mid, chatId, uid, text || '', msgType || 'text', fileUrl || null, fileName || null, isVO, replyTo || null, forwardedFrom || null, expiresAt, now]);

    runSql('UPDATE chats SET updated_at = ? WHERE id = ?', [now, chatId]);
    const row = queryOne('SELECT * FROM messages WHERE id = ?', [mid]);
    emitToChatMembers(chatId, 'message:new', formatMessageRow(row));
  });

  // View-Once media opened -> lock it permanently
  socket.on('message:view_once_opened', ({ chatId, msgId }) => {
    const msg = queryOne('SELECT * FROM messages WHERE id = ? AND chat_id = ?', [msgId, chatId]);
    if (!msg || !msg.view_once || msg.viewed_once) return;
    runSql('UPDATE messages SET viewed_once = 1 WHERE id = ?', [msgId]);
    const updated = queryOne('SELECT * FROM messages WHERE id = ?', [msgId]);
    emitToChatMembers(chatId, 'message:updated', formatMessageRow(updated));
  });

  socket.on('message:edit', ({ chatId, msgId, text }) => {
    const msg = queryOne('SELECT * FROM messages WHERE id = ? AND chat_id = ?', [msgId, chatId]);
    if (!msg || msg.sender_id !== uid) return;
    runSql('UPDATE messages SET text = ?, edited = 1 WHERE id = ?', [String(text || '').trim(), msgId]);
    const updated = queryOne('SELECT * FROM messages WHERE id = ?', [msgId]);
    emitToChatMembers(chatId, 'message:updated', formatMessageRow(updated));
  });

  socket.on('message:delete', ({ chatId, msgId, scope }) => {
    const msg = queryOne('SELECT * FROM messages WHERE id = ? AND chat_id = ?', [msgId, chatId]);
    if (!msg) return;
    const deleter = queryOne('SELECT name, username FROM users WHERE id = ?', [uid]);
    const deleterLabel = deleter ? `${deleter.name} (@${deleter.username})` : 'Foydalanuvchi';

    if (scope === 'everyone' && msg.sender_id === uid) {
      const members = queryAll('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]).map(m => m.user_id);
      archiveDeletedMessage(msg, members, deleterLabel);
      runSql('DELETE FROM messages WHERE id = ?', [msgId]);
      emitToChatMembers(chatId, 'message:deleted', { chatId, msgId, scope: 'everyone' });
    } else {
      archiveDeletedMessage(msg, [uid], deleterLabel);
      let arr = [];
      try { arr = JSON.parse(msg.deleted_for || '[]'); } catch(e) {}
      if (!arr.includes(uid)) arr.push(uid);
      runSql('UPDATE messages SET deleted_for = ? WHERE id = ?', [JSON.stringify(arr), msgId]);
      emitToUser(uid, 'message:deleted', { chatId, msgId, scope: 'me' });
    }
  });

  socket.on('message:react', ({ chatId, msgId, emoji }) => {
    const msg = queryOne('SELECT * FROM messages WHERE id = ? AND chat_id = ?', [msgId, chatId]);
    if (!msg) return;
    let reactions = {};
    try { reactions = JSON.parse(msg.reactions || '{}'); } catch(e) {}
    if (!reactions[emoji]) reactions[emoji] = [];
    const idx = reactions[emoji].indexOf(uid);
    if (idx >= 0) reactions[emoji].splice(idx, 1);
    else reactions[emoji].push(uid);
    if (reactions[emoji].length === 0) delete reactions[emoji];
    runSql('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), msgId]);
    const updated = queryOne('SELECT * FROM messages WHERE id = ?', [msgId]);
    emitToChatMembers(chatId, 'message:updated', formatMessageRow(updated));
  });

  socket.on('message:pin', ({ chatId, msgId }) => {
    const isMember = queryOne('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, uid]);
    if (!isMember) return;
    const chat = queryOne('SELECT pinned_message_id FROM chats WHERE id = ?', [chatId]);
    const nextPin = (chat && chat.pinned_message_id === msgId) ? null : msgId;
    runSql('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [nextPin, chatId]);
    emitToChatMembers(chatId, 'chat:pinned', { chatId, pinnedMessageId: nextPin });
  });

  socket.on('typing', ({ chatId }) => {
    const user = queryOne('SELECT name FROM users WHERE id = ?', [uid]);
    const members = queryAll('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?', [chatId, uid]);
    members.forEach(m => emitToUser(m.user_id, 'typing', { chatId, userId: uid, name: user ? user.name : '' }));
  });

  socket.on('disconnect', () => {
    const set = onlineUsers.get(uid);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        onlineUsers.delete(uid);
        runSql('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), uid]);
        io.emit('presence:update', { userId: uid, online: false });
      }
    }
  });
});

// Self-destruct cleanup interval
setInterval(() => {
  if (!db) return;
  const now = Date.now();
  const expired = queryAll('SELECT * FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?', [now]);
  if (expired.length > 0) {
    expired.forEach(m => {
      runSql('DELETE FROM messages WHERE id = ?', [m.id]);
      emitToChatMembers(m.chat_id, 'message:deleted', { chatId: m.chat_id, msgId: m.id, scope: 'everyone' });
    });
  }
}, 1500);

// ==================== BOOTSTRAP SQLITE & SERVER ====================
async function start() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      bio TEXT,
      color TEXT,
      avatar_url TEXT,
      role TEXT DEFAULT 'user',
      is_banned INTEGER DEFAULT 0,
      hidden_password TEXT,
      save_deleted INTEGER DEFAULT 1,
      last_seen INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      created_by TEXT,
      pinned_message_id TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT,
      msg_type TEXT DEFAULT 'text',
      file_url TEXT,
      file_name TEXT,
      view_once INTEGER DEFAULT 0,
      viewed_once INTEGER DEFAULT 0,
      reply_to TEXT,
      forwarded_from TEXT,
      edited INTEGER DEFAULT 0,
      reactions TEXT DEFAULT '{}',
      deleted_for TEXT DEFAULT '[]',
      expires_at INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS deleted_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender_name TEXT,
      sender_username TEXT,
      text TEXT,
      msg_type TEXT DEFAULT 'text',
      file_url TEXT,
      file_name TEXT,
      deleted_by TEXT,
      deleted_at INTEGER,
      original_created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS hidden_chats (
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      PRIMARY KEY (user_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Safe migrations for older SQLite DBs
  try { db.run('ALTER TABLE users ADD COLUMN save_deleted INTEGER DEFAULT 1'); } catch(e) {}
  try { db.run('ALTER TABLE messages ADD COLUMN view_once INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE messages ADD COLUMN viewed_once INTEGER DEFAULT 0'); } catch(e) {}

  const count = queryOne('SELECT COUNT(*) as c FROM users').c;
  if (count === 0) {
    const now = Date.now();
    db.run(
      'INSERT INTO users (id, name, username, password, bio, color, role, is_banned, save_deleted, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)',
      ['u_admin_1', 'Sherbek Norboyev', 'sherbek', hashPass('1234'), 'Tizim administratori', '#3b82f6', 'admin', now, now]
    );
    db.run(
      'INSERT INTO users (id, name, username, password, bio, color, role, is_banned, save_deleted, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)',
      ['u_demo_2', 'Madina Karimova', 'madina_uz', hashPass('1234'), 'UI/UX dizayner', '#8b5cf6', 'user', now, now]
    );
    saveDatabase();
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================================');
    console.log('🚀 UzChat Pro v4 Server ishga tushdi!');
    console.log(`💻 Kompyuterda ochish:  http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`📱 Telefonda ochish:    http://${net.address}:${PORT}`);
        }
      }
    }
    console.log('=================================================\n');
  });
}

start().catch(err => {
  console.error('Server xatosi:', err);
  process.exit(1);
});
