const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(session({ secret: 'universal_secret_key', resave: false, saveUninitialized: true }));

const db = new sqlite3.Database('data.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    service_name TEXT,
    extra_option TEXT,
    status TEXT DEFAULT 'new',
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Создание администратора по умолчанию с выводом в консоль
  db.get(`SELECT * FROM users WHERE login = 'Admin'`, (err, row) => {
    if (!row) {
      bcrypt.hash('admin123', 10, (err, hash) => {
        db.run(`INSERT INTO users (login, password, full_name, phone, email, role) VALUES (?, ?, 'Администратор', '+0(000)000-00-00', 'admin@example.com', 'admin')`, 
          ['Admin', hash]);
        console.log('Администратор создан: логин=Admin, пароль=admin123');
      });
    } else {
      console.log('Администратор уже существует (логин=Admin)');
    }
  });
});

// Регистрация
app.post('/api/register', (req, res) => {
  const { login, password, full_name, phone, email } = req.body;
  if (!login.match(/^[a-zA-Z0-9]{6,}$/)) return res.json({ success: false, error: 'Логин должен содержать минимум 6 символов латиницы и цифр' });
  if (password.length < 8) return res.json({ success: false, error: 'Пароль должен быть не менее 8 символов' });
  if (!full_name.match(/^[A-Za-zА-Яа-яЁё\s]+$/)) return res.json({ success: false, error: 'ФИО может содержать только буквы и пробелы' });
  if (!phone.match(/^[\+\d\s\(\)-]+$/)) return res.json({ success: false, error: 'Неверный формат телефона' });
  if (!email.match(/^\S+@\S+\.\S+$/)) return res.json({ success: false, error: 'Неверный email' });

  db.get(`SELECT id FROM users WHERE login = ?`, [login], (err, row) => {
    if (row) return res.json({ success: false, error: 'Логин уже занят' });
    bcrypt.hash(password, 10, (err, hash) => {
      db.run(`INSERT INTO users (login, password, full_name, phone, email) VALUES (?, ?, ?, ?, ?)`, 
        [login, hash, full_name, phone, email], function(err) {
          if (err) return res.json({ success: false, error: 'Ошибка базы данных' });
          req.session.userId = this.lastID;
          req.session.role = 'user';
          res.json({ success: true });
        });
    });
  });
});

// Авторизация
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  db.get(`SELECT * FROM users WHERE login = ?`, [login], (err, user) => {
    if (!user) return res.json({ success: false, error: 'Неверный логин или пароль' });
    bcrypt.compare(password, user.password, (err, match) => {
      if (!match) return res.json({ success: false, error: 'Неверный логин или пароль' });
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({ success: true, role: user.role });
    });
  });
});

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Текущий пользователь
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  db.get(`SELECT id, login, full_name, role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
    res.json({ user });
  });
});

// Заявки
app.post('/api/requests', (req, res) => {
  if (!req.session.userId) return res.json({ success: false, error: 'Не авторизован' });
  const { service_name, extra_option } = req.body;
  const allowedServices = ['Услуга 1', 'Услуга 2', 'Услуга 3'];
  if (!allowedServices.includes(service_name)) return res.json({ success: false, error: 'Выберите услугу из списка' });
  if (!extra_option) return res.json({ success: false, error: 'Дополнительная опция обязательна' });

  db.run(`INSERT INTO requests (user_id, service_name, extra_option) VALUES (?, ?, ?)`,
    [req.session.userId, service_name, extra_option], function(err) {
      if (err) return res.json({ success: false, error: 'Ошибка базы данных' });
      res.json({ success: true });
    });
});

app.get('/api/my-requests', (req, res) => {
  if (!req.session.userId) return res.json([]);
  db.all(`SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC`, [req.session.userId], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/review/:id', (req, res) => {
  if (!req.session.userId) return res.json({ success: false, error: 'Не авторизован' });
  const { review } = req.body;
  db.get(`SELECT * FROM requests WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], (err, row) => {
    if (!row) return res.json({ success: false, error: 'Не ваша заявка' });
    if (row.status !== 'completed') return res.json({ success: false, error: 'Отзыв можно оставить только после завершения' });
    db.run(`UPDATE requests SET review = ? WHERE id = ?`, [review, req.params.id], () => {
      res.json({ success: true });
    });
  });
});

// Админ-панель
const isAdmin = (req, res, next) => {
  if (!req.session.userId) return res.json({ error: 'Не авторизован' });
  db.get(`SELECT role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
    if (user && user.role === 'admin') next();
    else res.json({ error: 'Доступ запрещён' });
  });
};

app.get('/api/admin/requests', isAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;
  const status = req.query.status === 'all' ? null : req.query.status;
  let sql = `SELECT r.*, u.full_name FROM requests r JOIN users u ON r.user_id = u.id`;
  let params = [];
  if (status) { sql += ` WHERE r.status = ?`; params.push(status); }
  sql += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  db.all(sql, params, (err, rows) => {
    let countSql = `SELECT COUNT(*) as total FROM requests r`;
    let countParams = [];
    if (status) { countSql += ` WHERE r.status = ?`; countParams.push(status); }
    db.get(countSql, countParams, (err, countRow) => {
      res.json({ requests: rows || [], total: countRow ? countRow.total : 0, page, limit });
    });
  });
});

app.put('/api/admin/requests/:id/status', isAdmin, (req, res) => {
  const { status } = req.body;
  if (!['new', 'in_progress', 'completed'].includes(status)) return res.json({ success: false, error: 'Неверный статус' });
  db.run(`UPDATE requests SET status = ? WHERE id = ?`, [status, req.params.id], () => {
    res.json({ success: true });
  });
});

// Маршруты для страниц
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'views', 'home.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'views', 'create.html')));
app.get('/my-requests', (req, res) => res.sendFile(path.join(__dirname, 'views', 'my-requests.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.listen(3000, () => console.log('Сервер запущен на http://localhost:3000'));