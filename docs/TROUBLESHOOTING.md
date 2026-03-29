# Troubleshooting Guide

## Common Issues and Solutions

---

## Installation Issues

### Issue 1: npm install fails

**Problem:** `npm ERR! code ERR_OVERBROAD_REJECTION` or similar

**Solutions:**
```bash
# Clear npm cache
npm cache clean --force

# Try installing again
npm install

# If still fails, try
npm install --legacy-peer-deps
```

### Issue 2: Node.js version incompatible

**Problem:** Error about Node.js version

**Solutions:**
```bash
# Check your Node.js version
node --version

# Should be 14.0.0 or higher
# Download from https://nodejs.org/

# Update Node.js
# Windows: Use installer from nodejs.org
# Mac: brew install node
# Linux: apt-get install nodejs
```

### Issue 3: MongoDB not installed

**Problem:** `MongoNetworkOpenError` or connection refused

**Solutions:**
```bash
# Option A: Install MongoDB locally
# Windows: https://www.mongodb.com/try/download/community
# Mac: brew install mongodb-community
# Linux: apt-get install mongodb-server

# Option B: Use MongoDB Atlas (cloud)
# 1. Go to https://www.mongodb.com/cloud/atlas
# 2. Create account and cluster
# 3. Get connection string
# 4. Update MONGODB_URI in .env
```

---

## Backend Issues

### Issue 1: Backend won't start

**Error:** `Error: connect ECONNREFUSED 127.0.0.1:27017`

**Cause:** MongoDB not running

**Solutions:**
```bash
# Windows: Start MongoDB service
net start MongoDB

# Mac: Start MongoDB
brew services start mongodb-community

# Linux: Start MongoDB
sudo systemctl start mongod

# Verify MongoDB is running
mongosh  # or mongo
```

### Issue 2: Port 5000 already in use

**Error:** `Error: listen EADDRINUSE: address already in use :::5000`

**Solutions:**
```bash
# Option A: Change the port
# Edit backend/.env
PORT=5001

# Option B: Kill process using port 5000
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -i :5000
kill -9 <PID>
```

### Issue 3: JWT Secret not set

**Error:** `Error: JWT_SECRET is not defined`

**Solutions:**
```bash
# Check that .env file exists
# backend/.env should contain:
JWT_SECRET=your_secret_key

# If file missing, create from example:
copy .env.example .env

# Edit .env and set JWT_SECRET
```

### Issue 4: CORS errors in console

**Error:** `Access to XMLHttpRequest blocked by CORS policy`

**Cause:** Frontend and backend not communicating

**Solutions:**
```bash
# 1. Ensure backend is running on port 5000
# 2. Check API base URL in frontend/src/services/api.js
const API_BASE_URL = 'http://localhost:5000/api';

# 3. Verify CORS is enabled in backend/server.js
const cors = require('cors');
app.use(cors());

# 4. Restart both services
```

### Issue 5: Admin user not created

**Error:** Admin login fails on first run

**Solutions:**
```bash
# The admin user should auto-create on first server start
# If not, check backend logs for errors

# Manually create admin (optional):
# Connect to MongoDB and run:
db.users.insertOne({
  username: "admin",
  password: "admin123",
  role: "admin",
  parentId: null,
  createdAt: new Date()
})
```

### Issue 6: .env file not found

**Error:** `Error: .env file not found`

**Solutions:**
```bash
# Backend folder
cd backend

# Copy example to actual .env
# Windows:
copy .env.example .env

# Mac/Linux:
cp .env.example .env

# Then edit .env with your settings
```

---

## Frontend Issues

### Issue 1: Frontend won't start

**Error:** `Error: react-scripts: command not found`

**Solutions:**
```bash
cd frontend
npm install
npm start
```

### Issue 2: Can't connect to backend

**Error:** API calls fail, CORS error in console

**Solutions:**
```bash
# 1. Check if backend is running
# Terminal 1: Should show "Server running on port 5000"

# 2. Update API URL if needed
# frontend/src/services/api.js line 4:
const API_BASE_URL = 'http://localhost:5000/api';

# 3. If backend on different machine:
const API_BASE_URL = 'http://your-backend-ip:5000/api';

# 4. Restart frontend
npm start
```

### Issue 3: Login page stuck loading

**Error:** Page loads but nothing happens

**Solutions:**
```bash
# 1. Check if backend is running
# 2. Open browser console (F12)
# 3. Look for error messages
# 4. Check Network tab to see API calls
# 5. Ensure API_BASE_URL is correct
# 6. Check if MongoDB is connected
```

### Issue 4: Page shows blank

**Error:** White page with no content

**Solutions:**
```bash
# 1. Open browser console (F12)
# 2. Look for JavaScript errors
# 3. Check if node_modules exist:
ls frontend/node_modules

# If not:
cd frontend
npm install

# 4. Clear browser cache (Ctrl+Shift+Delete)
# 5. Hard refresh (Ctrl+F5)
# 6. Restart npm start
```

### Issue 5: Styles not loading

**Error:** UI looks unstyled

**Solutions:**
```bash
# 1. Check CSS files exist:
frontend/src/styles/index.css

# 2. Verify CSS is imported in App.js:
import './styles/index.css';

# 3. Clear browser cache
# 4. Hard refresh page (Ctrl+F5)
# 5. Restart frontend
npm start
```

---

## Authentication Issues

### Issue 1: Login fails with any credentials

**Error:** "Invalid username or password" for every attempt

**Cause:** 
- MongoDB not connected
- No admin user exists
- Password hashing issue

**Solutions:**
```bash
# 1. Check MongoDB connection
# 2. Verify admin user exists:
mongo
use lottery_booking
db.users.findOne({ role: 'admin' })

# 3. Check backend logs for errors
# 4. Ensure JWT_SECRET is set in .env

# If needed, create admin user manually:
db.users.insertOne({
  username: "admin",
  password: "$2a$10$...", // bcrypt hash must be pre-computed
  role: "admin",
  parentId: null,
  createdAt: new Date()
})
```

### Issue 2: Token expires immediately

**Error:** Can't stay logged in

**Solutions:**
```bash
# 1. Check JWT_SECRET is same on every restart
# The secret in .env should not change

# 2. Check token expiry time in authController.js:
{ expiresIn: '24h' }

# 3. Clear browser localStorage
# Open DevTools > Application > Storage > LocalStorage > Clear

# 4. Re-login
```

### Issue 3: Can't login as seller

**Error:** Seller creation succeeded but can't login

**Cause:** Seller not created or password issue

**Solutions:**
```bash
# 1. Verify seller exists:
mongo
db.users.find({ username: "seller1" })

# 2. Check if password was hashed
# 3. Try creating seller again
# 4. Verify you're using correct password (case-sensitive)
# 5. Check backend logs
```

---

## Database Issues

### Issue 1: Database connection fails

**Error:** `MongoNetworkError` or `connection refused`

**Solutions:**
```bash
# 1. Verify MongoDB is running
mongosh  # or mongo

# 2. Check connection string in .env
MONGODB_URI=mongodb://localhost:27017/lottery_booking

# 3. If using MongoDB Atlas, update connection string
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/database?retryWrites=true

# 4. Whitelist your IP in MongoDB Atlas
# Go to Atlas > Security > Network Access

# 5. Test connection:
mongo "mongodb://localhost:27017/lottery_booking"
```

### Issue 2: Database corrupted

**Error:** Random database errors

**Solutions:**
```bash
# 1. Check database integrity:
mongosh

# 2. View collections:
show collections

# 3. Clear database (development only!):
db.dropDatabase()

# 4. Restart backend (will recreate collections)
npm start

# 5. For production, restore from backup
```

### Issue 3: Out of disk space

**Error:** Write operations fail

**Solutions:**
```bash
# 1. Check disk space:
# Windows: Check C: drive
# Mac/Linux: df -h

# 2. Delete old backups:
rm -rf /backups/old_backup_*

# 3. Archive old logs:
gzip *.log

# 4. Upgrade storage
```

---

## Time Restriction Issues

### Issue 1: Time restriction not working

**Error:** Can book entries after cutoff time

**Cause:** Backend time check failed or time zone issue

**Solutions:**
```bash
# 1. Check server time:
# Windows: time /t
# Mac/Linux: date

# 2. Verify time zone is correct
# Update server time if needed

# 3. Verify time restriction logic in helpers.js:
// Should be: level 1 = 12:55, level 2+ = 12:50

# 4. Check server logs for time check messages

# 5. Force test (edit helpers.js temporarily):
// Change time limit for testing
getTimeRestriction = (userLevel) => {
  return { hour: 23, minute: 59 };
};
```

### Issue 2: Entries deleted unexpectedly

**Error:** Pending entries disappear

**Cause:** Time limit exceeded and auto-delete triggered

**Solutions:**
```bash
# This is expected behavior
# After time cutoff, entries are auto-deleted

# To avoid this:
# 1. Book entries before cutoff time
# 2. Send entries before cutoff time
# 3. Check time limit in documentation
```

---

## Data Issues

### Issue 1: Can't see sent entries

**Error:** Parent user doesn't see entries from children

**Cause:** Entries not marked as sent or parent relationship wrong

**Solutions:**
```bash
# 1. Verify parent-child relationship
mongo
db.users.findOne({ username: "seller1" })
// Check if parentId is correct

# 2. Verify entries are sent:
db.lotteryentries.findOne({ status: "sent" })
// Should show sentToParent = parent's ID

# 3. Check "Sent Entries" tab
// Go to lottery/sent-entries API endpoint
// Verify sentToParent matches current user's ID

# 4. Restart frontend
# 5. Re-login parent user
```

### Issue 2: Missing entries

**Error:** Entries disappeared

**Cause:** 
- Auto-deleted after time limit
- Browser cache issue
- Network issue during send

**Solutions:**
```bash
# 1. Check MongoDB directly:
db.lotteryentries.find({ status: "pending" })
db.lotteryentries.find({ status: "sent" })

# 2. If gone from DB, likely time-limit deletion (expected)

# 3. Refresh page to reload from server
# 4. Check browser console for errors
# 5. Ensure you have internet connection
```

### Issue 3: Duplicate entries

**Error:** Same entry appears twice

**Cause:** Form submitted twice (double-click)

**Solutions:**
```bash
# 1. Delete duplicate manually:
mongo
db.lotteryentries.deleteOne({ _id: ObjectId("...") })

# 2. Verify frontend prevents double-submit
// Button should disable after click

# 3. Don't rapid-click buttons
# 4. Wait for success message before clicking again
```

---

## Performance Issues

### Issue 1: App is slow

**Error:** Page loads slowly, interactions lag

**Cause:** 
- Large number of entries
- Slow internet
- Server slow

**Solutions:**
```bash
# 1. Check network speed
# F12 > Network tab > See response times

# 2. Check server load:
# Windows: Task Manager > Performance
# Mac: Activity Monitor

# 3. Reduce entries in view
# 4. Upgrade server resources
# 5. Enable pagination (future feature)
# 6. Add caching (Redis)
```

### Issue 2: Database query slow

**Error:** API takes > 1 second to respond

**Solutions:**
```bash
# 1. Add database indexes:
db.users.createIndex({ username: 1 })
db.lotteryentries.createIndex({ userId: 1 })
db.prices.createIndex({ uniqueCode: 1 })

# 2. Check if too many documents:
db.lotteryentries.countDocuments()

# 3. Archive old entries:
db.lotteryentries.deleteMany({ createdAt: { $lt: new Date("2024-01-01") } })

# 4. Optimize MongoDB settings
```

---

## Security Issues

### Issue 1: Admin credentials exposed

**Problem:** Admin password in .env file

**Solutions:**
```bash
# 1. Change password immediately
# 2. Update in .env
# 3. Restart backend

# 4. Change default admin:
db.users.updateOne(
  { username: "admin" },
  { $set: { password: "$2a$10$..." } } // bcrypt hash
)
```

### Issue 2: JWT secret weak

**Problem:** "secret" is not a secure JWT secret

**Solutions:**
```bash
# 1. Generate strong secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Update in .env:
JWT_SECRET=<generated-string>

# 3. Restart backend

# 4. All existing tokens become invalid (expected on first change)
```

---

## Browser Issues

### Issue 1: LocalStorage cleared

**Error:** Login persisted but now gone

**Cause:** Browser cleared storage

**Solutions:**
```bash
# 1. Login again
# 2. Ensure browser doesn't auto-clear on exit
# 3. Use LocalStorage settings: Settings > Privacy
```

### Issue 2: Works on Chrome, not Firefox

**Error:** Different behavior on different browsers

**Solutions:**
```bash
# 1. Check browser console (F12)
# 2. Look for CORS errors
# 3. Ensure API base URL has correct http://

# 4. Check cookie/storage settings per browser
# 5. Try incognito mode (disables extensions)
# 6. Update browser to latest version
```

---

## Network Issues

### Issue 1: Can't reach backend from outside network

**Error:** API calls fail from different machine

**Cause:** Backend only listening on localhost

**Solutions:**
```bash
# 1. Check server is listening on 0.0.0.0:
// In server.js, ensure:
app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on 0.0.0.0:5000');
});

# 2. Update frontend API URL:
const API_BASE_URL = 'http://your-server-ip:5000/api';

# 3. Open firewall port:
# Windows: Windows Defender > Allow app through firewall
# Mac: System Preferences > Security & Privacy
# Linux: sudo ufw allow 5000

# 4. Ensure server has static IP
```

### Issue 2: Timeout on slow connection

**Error:** Request takes too long and times out

**Solutions:**
```bash
# 1. Increase timeout in api.js:
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000  // 30 seconds
});

# 2. Optimize API responses
# 3. Add pagination for large datasets
# 4. Use compression (gzip)
```

---

## Deployment Issues

### Issue 1: Works locally but not on production

**Error:** App works on localhost but fails on server

**Cause:** Configuration differences

**Solutions:**
```bash
# 1. Check .env file on production
# 2. Verify MongoDB connection on production
# 3. Check API base URL in frontend
# 4. Ensure ports are open
# 5. Review production logs
# 6. Verify SSL certificates if using HTTPS

# SSH to server and check logs:
ssh user@server
pm2 logs
```

### Issue 2: Database won't connect on server

**Error:** ECONNREFUSED on production

**Solutions:**
```bash
# 1. Verify MongoDB is running:
sudo systemctl status mongod

# 2. Check if MongoDB listening on correct port:
sudo netstat -tulpn | grep mongo

# 3. Verify connection string:
echo $MONGODB_URI  # Check environment variable

# 4. Test connection directly:
mongo "$MONGODB_URI"

# 5. If using MongoDB Atlas:
# Whitelist server IP in Atlas console
```

---

## Getting Help

### Before asking for help:
1. Check this troubleshooting guide
2. Check browser console (F12)
3. Check server logs
4. Check MongoDB logs
5. Search error message online

### Information to provide:
1. Full error message
2. Steps to reproduce
3. System info (OS, Node version)
4. Which part of app (login, lottery, etc.)
5. Browser and version
6. Recent changes to code

### Resources
- [Node.js Docs](https://nodejs.org/docs/)
- [MongoDB Docs](https://docs.mongodb.com/)
- [React Docs](https://react.dev/)
- [Express Docs](https://expressjs.com/)

---

## Quick Debugging Checklist

- [ ] MongoDB running?
- [ ] Backend running? (npm start in backend folder)
- [ ] Frontend running? (npm start in frontend folder)
- [ ] .env file exists and configured?
- [ ] API URL correct in frontend?
- [ ] Ports 5000 and 3000 not in use?
- [ ] Browser console clear of errors?
- [ ] Network tab shows successful API calls?
- [ ] LocalStorage has token?
- [ ] Server time correct?
