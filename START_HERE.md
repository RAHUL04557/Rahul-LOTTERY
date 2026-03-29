# 🚀 START HERE - Get Running in 5 Steps

Welcome! Follow these simple steps to get the Lottery Booking System running on your computer.

---

## ⏱️ Time Required: 15 minutes

### Prerequisites (Install if needed)
- **Node.js** (download: https://nodejs.org/) - Choose LTS version
- **MongoDB** (download: https://www.mongodb.com/try/download/community) OR use MongoDB Atlas (cloud)

---

## Step 1: Download and Navigate (2 minutes)

```bash
# Navigate to the project folder
cd lot

# You should see these folders:
# - backend/
# - frontend/
# - docs/
# - README.md
```

---

## Step 2: Setup Backend (5 minutes)

```bash
# Open first terminal/command prompt
cd backend

# Install dependencies
npm install

# Create .env file with settings
# Windows:
copy .env.example .env

# Mac/Linux:
cp .env.example .env

# Edit .env and update MongoDB connection if needed
# (Default uses local MongoDB: mongodb://localhost:27017/lottery_booking)

# Start the backend server
npm start
```

**You should see:**
```
MongoDB connected successfully
Admin user created
Server running on port 5000
```

✅ Keep this terminal running

---

## Step 3: Setup Frontend (5 minutes)

```bash
# Open SECOND terminal/command prompt
cd frontend

# Install dependencies
npm install

# Start the frontend
npm start
```

**Browser will automatically open**
- If not, go to: http://localhost:3000

✅ Keep this terminal running

---

## Step 4: First Login (2 minutes)

**Login with default credentials:**
- Username: `admin`
- Password: `admin123`

**You should see:**
- Admin Dashboard with three tabs
- Option to upload prices, view results, view sellers

✅ You're logged in!

---

## Step 5: Test the Features (1 minute)

### Test as Admin:
1. Go to "Upload Price/Result"
2. Enter any code: `TEST123`
3. Enter any price: `5000`
4. Click Upload

✅ Price uploaded!

### Create a Test Seller:
1. (Still as admin) Go to "Add New Seller"
2. Username: `seller1`
3. Password: `pass123`
4. Click Create

✅ Seller created!

### Test as Seller:
1. Logout (top right button)
2. Login with credentials:
   - Username: `seller1`
   - Password: `pass123`
3. You should see Seller Dashboard (different from Admin)

✅ You're logged in as seller!

---

## 🎉 Done! You're Running!

The application is now running locally with:
- Backend API: http://localhost:5000
- Frontend UI: http://localhost:3000
- Sample data with admin and seller accounts

---

## 📚 Next Steps

### Learn More
- Read [README.md](../README.md) - Overview and features
- See [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Detailed installation guide
- Check [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - API endpoints

### Test Features
- Read [TESTING_GUIDE.md](./TESTING_GUIDE.md) - How to test everything
- Try creating hierarchies of sellers
- Book lottery entries
- Check prices

### Deploy to Production
- See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - How to deploy

### Something Wrong?
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Fix common issues

---

## 🚨 Quick Troubleshooting

### "MongoDB connection failed"
```bash
# Start MongoDB
# Windows: net start MongoDB
# Mac: brew services start mongodb-community
# Linux: sudo systemctl start mongod
```

### "Port 5000 already in use"
```bash
# Change port in backend/.env
# PORT=5001
# Then restart backend
```

### "Can't login"
- Check MongoDB is running
- Verify credentials (admin/admin123)
- Clear browser cache and refresh

### "Frontend won't connect"
- Ensure backend is running (see message in terminal 1)
- Check http://localhost:5000/api/auth/me in browser
- It should show an error (that's normal without login)

---

## 📞 Default Credentials

```
Username: admin
Password: admin123
```

⚠️ **Change these in production!**

---

## 🎯 What Can You Do Now?

### As Admin:
- [ ] Create sellers
- [ ] Upload lottery prices
- [ ] View all sellers
- [ ] View all prices

### As Seller:
- [ ] Create sub-sellers
- [ ] Book lottery tickets
- [ ] Send entries to parent
- [ ] Check prices
- [ ] See entries from children

---

## 📁 What You Have

- ✅ Complete backend API
- ✅ Complete React frontend
- ✅ MongoDB database
- ✅ User authentication
- ✅ Admin & Seller dashboards
- ✅ Lottery booking system
- ✅ Price management
- ✅ Complete documentation

---

## 🔗 Important Files

- **Backend**: `backend/server.js`
- **Frontend**: `frontend/src/App.js`
- **Settings**: `backend/.env`
- **API Guide**: `docs/API_DOCUMENTATION.md`
- **Full Setup**: `docs/SETUP_GUIDE.md`

---

## ✨ Features Overview

### Check Price
- Enter unique code
- See price if available
- Shows "No result" if not found

### Add New Seller
- Create accounts under you
- New sellers can create their own sub-sellers
- Multi-level hierarchy possible

### Book Lottery
- Select series (Draw1, Draw2, etc.)
- Enter 5-digit number
- Choose box value (10-500)
- Set amount (in rupees)
- Auto-generates unique code
- Sends all entries to parent

---

## 📊 Hierarchy Example

```
Admin (you logged in as admin)
├── Seller1 (create this now)
│   ├── Seller1.1 (Seller1 can create this)
│   └── Seller1.2
└── Seller2
```

---

## 🕐 Time Limits

- **Level 1** (directly under admin): Can book until **12:55 PM**
- **Level 2+** (deeper): Can book until **12:50 PM**
- After limit: Entries auto-deleted

---

## 💾 Database

Your data is stored in MongoDB:
- Database: `lottery_booking`
- Collections: `users`, `lotteryentries`, `prices`

No data is lost between restarts (stored in database)

---

## 🎓 Learning Path

1. **Right Now** (5 min): You're here! ✅
2. **Explore** (15 min): Try all 3 seller features
3. **Create Hierarchy** (10 min): Make multiple sellers
4. **Read Docs** (1 hour): Understand how it works
5. **Develop** (as needed): Build custom features
6. **Deploy** (when ready): Put on server

---

## 🆘 Still Need Help?

### Check Documentation
- Quick commands: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- Full setup guide: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- API reference: [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- Troubleshooting: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

### Check Terminal Output
- Backend terminal: Has error messages
- Frontend terminal: Has connection errors
- Browser console (F12): Has frontend errors

### Common Issues
1. **Blank page**: Clear browser cache (Ctrl+Shift+Delete)
2. **Won't login**: Restart both servers
3. **Connection error**: Check if MongoDB is running
4. **Port in use**: Change PORT in .env

---

## 🎊 Congratulations!

You now have a fully functional lottery booking system running locally!

### What's Next?
- [ ] Explore the admin features
- [ ] Create test sellers
- [ ] Book lottery entries
- [ ] Upload some prices
- [ ] Read [README.md](../README.md) for overview
- [ ] Read [SETUP_GUIDE.md](./SETUP_GUIDE.md) for details
- [ ] Plan your next feature

---

## 📞 Terminal Layout

Keep these two terminals open while developing:

```
Terminal 1                    Terminal 2
┌─────────────────┐          ┌─────────────────┐
│ Backend Server  │          │ Frontend Server │
│ npm start       │          │ npm start       │
│ Port 5000       │          │ Port 3000       │
│ Keep running ✓  │          │ Keep running ✓  │
└─────────────────┘          └─────────────────┘
```

---

## 🚀 Ready? Let's Go!

1. Make sure both terminals say "running" ✅
2. Visit http://localhost:3000 ✅
3. Login as admin/admin123 ✅
4. Start exploring! ✅

**Enjoy your lottery booking system!** 🎉

---

**Questions?** Check [docs/INDEX.md](./INDEX.md) for all documentation.

**Version:** 1.0.0  
**Last Updated:** March 23, 2024  
**Status:** ✅ Ready to Use
