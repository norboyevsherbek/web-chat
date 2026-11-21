# UzChat Pro — Real-Time Xavfsiz Web Messenger (Full-Stack)

**Texnologiyalar:** Node.js, Express.js, Socket.io, SQLite (`sql.js`), HTML5, CSS3, JavaScript.

## Ishga tushirish bo'yicha yo'riqnoma

1. Kompyuteringizda **Node.js** o'rnatilgan bo'lishi kerak (`https://nodejs.org`).
2. Ushbu papkani terminal (yoki VS Code terminali) orqali oching va kutubxonalarni o'rnating:
   ```bash
   npm install
   ```
3. Serverni ishga tushiring:
   ```bash
   npm start
   ```
4. Terminalda ikkita manzil chiqadi:
   - **Kompyuterda ochish:** `http://localhost:3000`
   - **Telefonda ochish:** `http://192.168.x.x:3000` (kompyuter va telefon bitta Wi-Fi tarmog'ida bo'lishi kerak).

## Demo hisoblar
- **Admin:** `@sherbek` / parol: `1234`
- **Oddiy foydalanuvchi:** `@madina_uz` / parol: `1234`

## Barcha imkoniyatlar
- Real-vaqtda kompyuter va telefon o'rtasida xabar almashish (Socket.io + SQLite)
- Ro'yxatdan o'tish, takrorlanmas `@username` va global qidiruv
- Guruh chatlari yaratish (`👥+`)
- Rasm, fayl, ovozli xabar (`🎤`), profil avatari va Emoji paneli
- Xabarlarni tahrirlash, o'chirish (hamma uchun / o'zim uchun), uzatish (Forward), reaksiya, qadash (Pin) va chat ichida qidirish
- O'z-o'zidan o'chadigan xabarlar taymeri (`10s / 30s / 60s`)
- Har bir foydalanuvchining o'z shaxsiy yashirin chat paroli, ilovani qulflash, Maxfiylik (Blur) va xavfsizlik jurnali
- Oq / Qora rejim (`☀️/🌙`), 3 ta til (`UZ / RU / EN`) va ovozli bildirishnoma
- Admin paneli (`👑`): statistika, foydalanuvchilarni real-vaqtda bloklash (Ban) va rol boshqaruvi
