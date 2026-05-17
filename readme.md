npm install

npm init -y
npm install express sqlite3 bcrypt express-session

npm start
node server.js

Если ничего не работает – сбросьте всё и начните заново
bash
# Удалить зависимости и базу
rm -rf node_modules package-lock.json data.db

# Переустановить
npm install

# Запустить
npm start