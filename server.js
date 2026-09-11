// Capacity Connect local Node.js server — no extra packages required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const port = 3000;
const databasePath = path.join(__dirname, 'data', 'capacity-connect.json');
const scrypt = promisify(crypto.scrypt);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid data')); }
    });
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function passwordMatches(password, savedPassword) {
  const [salt, savedHash] = savedPassword.split(':');
  const inputHash = (await scrypt(password, salt, 64)).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(savedHash, 'hex'), Buffer.from(inputHash, 'hex'));
}

http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/auth/login') {
    readRequestBody(request).then(async userInput => {
      const name = String(userInput.name || '').trim();
      const email = String(userInput.email || '').trim().toLowerCase();
      const password = String(userInput.password || '');
      const role = ['Learner', 'Trainer', 'Admin', 'Management'].includes(userInput.role)
  ? userInput.role
  : 'Learner';
      if (!name || !email || password.length < 6) return sendJson(response, 400, { error: 'Name, email, and a password of at least 6 characters are required.' });

      const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
      let user = database.users.find(item => item.email === email);
      if (!user) {
        user = { id: Date.now(), name, email, role, password: await hashPassword(password), joinedAt: new Date().toISOString() };
        database.users.push(user);
        fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      } else if (!user.password) {
        user.password = await hashPassword(password);
        fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      } else if (!(await passwordMatches(password, user.password))) {
        return sendJson(response, 401, { error: 'Incorrect password. Please try again.' });
      }
      const { password: hiddenPassword, ...safeUser } = user;
      sendJson(response, 200, { user: safeUser });
    }).catch(() => sendJson(response, 400, { error: 'Please enter valid details.' }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/courses') {
    readRequestBody(request).then(userInput => {
      const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
      const user = database.users.find(item => item.email === String(userInput.email || '').trim().toLowerCase());
      if (!user || !['Admin', 'Trainer'].includes(user.role)) return sendJson(response, 403, { error: 'Only an Admin or Trainer can create a course.' });

      const title = String(userInput.title || '').trim();
      const category = String(userInput.category || '').trim();
      const duration = String(userInput.duration || '').trim();
      const description = String(userInput.description || '').trim();
      if (!title || !category || !duration || !description) return sendJson(response, 400, { error: 'Please complete every course field.' });

      const course = { id: Date.now(), title, category, duration, description, createdBy: user.email, createdAt: new Date().toISOString() };
      database.courses.push(course);
      fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      sendJson(response, 201, { course });
    }).catch(() => sendJson(response, 400, { error: 'Could not save the course.' }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/enrollments') {
    readRequestBody(request).then(userInput => {
      const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
      const email = String(userInput.email || '').trim().toLowerCase();
      const courseId = Number(userInput.courseId);
      const user = database.users.find(item => item.email === email);
      const course = database.courses.find(item => item.id === courseId);
      if (!user || !course) return sendJson(response, 400, { error: 'User or course was not found.' });
      if (database.enrollments.some(item => item.userId === user.id && item.courseId === courseId)) return sendJson(response, 409, { error: 'You are already enrolled in this course.' });
      const enrollment = { id: Date.now(), userId: user.id, courseId, progress: 0, completed: false, enrolledAt: new Date().toISOString() };
      database.enrollments.push(enrollment);
      fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      sendJson(response, 201, { enrollment });
    }).catch(() => sendJson(response, 400, { error: 'Could not enroll in the course.' }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/enrollments/progress') {
    readRequestBody(request).then(userInput => {
      const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
      const user = database.users.find(item => item.email === String(userInput.email || '').trim().toLowerCase());
      const enrollment = user && database.enrollments.find(item => item.userId === user.id && item.courseId === Number(userInput.courseId));
      if (!enrollment) return sendJson(response, 404, { error: 'Enroll in this course before marking it complete.' });
      enrollment.progress = Math.min(100, Math.max(0, Number(userInput.progress) || 0));
      enrollment.completed = enrollment.progress === 100;
      enrollment.updatedAt = new Date().toISOString();
      fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      sendJson(response, 200, { enrollment });
    }).catch(() => sendJson(response, 400, { error: 'Could not update learning progress.' }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/quiz-results') {
    readRequestBody(request).then(userInput => {
      const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
      const user = database.users.find(item => item.email === String(userInput.email || '').trim().toLowerCase());
      const courseId = Number(userInput.courseId);
      const course = database.courses.find(item => item.id === courseId);
      const score = Math.min(100, Math.max(0, Number(userInput.score) || 0));
      if (!user || !course) return sendJson(response, 400, { error: 'User or course was not found.' });
      const result = { id: Date.now(), userId: user.id, courseId, score, passed: score >= 70, completedAt: new Date().toISOString() };
      database.quizResults.push(result);
      let certificate = null;
      if (result.passed) {
        certificate = database.certificates.find(item => item.userId === user.id && item.courseId === courseId);
        if (!certificate) {
          certificate = { id: Date.now() + 1, userId: user.id, courseId, title: course.title, issuedAt: new Date().toISOString() };
          database.certificates.push(certificate);
        }
      }
      fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
      sendJson(response, 201, { result, certificate });
    }).catch(() => sendJson(response, 400, { error: 'Could not save quiz result.' }));
    return;
  }

  if (request.method === 'GET' && request.url.startsWith('/api/certificates')) {
    const email = new URL(request.url, `http://localhost:${port}`).searchParams.get('email');
    const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    const user = database.users.find(item => item.email === String(email || '').toLowerCase());
    sendJson(response, 200, user ? database.certificates.filter(item => item.userId === user.id) : []);
    return;
  }if (request.method === 'GET' && request.url.startsWith('/api/admin/users')) {
  const email = new URL(request.url, `http://localhost:${port}`).searchParams.get('email');

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));

  const admin = database.users.find(
    item => item.email === String(email || '').toLowerCase()
  );

  if (!admin || admin.role !== 'Admin') {
    return sendJson(response, 403, {
      error: 'Administrator access is required.'
    });
  }

  const users = database.users.map(user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status || 'Active',
  joinedAt: user.joinedAt,
  enrolledCourses: user.enrolledCourses || [],
  progress: user.progress || 0,
  certificates: user.certificates || [],
  quizResults: user.quizResults || []
}));
  sendJson(response, 200, users);
  return;
}

  if (request.method === 'GET' && request.url.startsWith('/api/admin/summary')) {
    const email = new URL(request.url, `http://localhost:${port}`).searchParams.get('email');
    const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    const user = database.users.find(item => item.email === String(email || '').toLowerCase());
    if (!user || user.role !== 'Admin') return sendJson(response, 403, { error: 'Administrator access is required.' });
    const completed = database.enrollments.filter(item => item.completed).length;
    sendJson(response, 200, { users: database.users.length, courses: database.courses.length, enrollments: database.enrollments.length, completed, certificates: database.certificates.length });
    return;
  }

  if (request.method === 'GET' && request.url.startsWith('/api/enrollments')) {
    const email = new URL(request.url, `http://localhost:${port}`).searchParams.get('email');
    const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    const user = database.users.find(item => item.email === String(email || '').toLowerCase());
    const enrollments = user ? database.enrollments.filter(item => item.userId === user.id).map(item => ({ ...item, course: database.courses.find(course => course.id === item.courseId) })) : [];
    sendJson(response, 200, enrollments);
    return;
  }

  if (request.url === '/api/health') {
    const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', message: 'Capacity Connect database is connected', courses: database.courses.length }));
    return;
  }

  if (request.url === '/api/courses') {
    const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(database.courses));
    return;
  }

  const requestedPath = request.url === '/' ? '/login.html' : decodeURIComponent(request.url.split('?')[0]);
  const filePath = path.join(__dirname, requestedPath);

  // Prevent requests from reaching outside this project folder.
  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end('Access denied');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Page not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    response.end(content);
  });
}).listen(port, () => {
  console.log(`Capacity Connect is running at http://localhost:${port}`);
});
