# Lottery Booking System - Setup Guide

## Project Overview

A full-stack multi-level seller tree lottery booking system with admin control, featuring:
- Hierarchical seller structure (multi-level tree)
- Lottery booking with unique codes
- Price/Result checking
- Time-based restrictions
- Admin dashboard for price management

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- MongoDB (local or Atlas)
- Git (optional)

## Project Structure

```
lot/
├── backend/
│   ├── config/
│   │   └── database.js
│   ├── models/
│   │   ├── User.js
│   │   ├── LotteryEntry.js
│   │   └── Price.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── lotteryRoutes.js
│   │   └── priceRoutes.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── lotteryController.js
│   │   └── priceController.js
│   ├── middleware/
│   │   └── auth.js
│   ├── utils/
│   │   └── helpers.js
│   ├── package.json
│   ├── .env.example
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.js
│   │   │   ├── SellerDashboard.js
│   │   │   └── AdminDashboard.js
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── styles/
│   │   │   └── index.css
│   │   ├── App.js
│   │   ├── index.js
│   │   └── ...
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── ...
├── docs/
│   ├── DATABASE_SCHEMA.md
│   ├── API_DOCUMENTATION.md
│   └── SETUP_GUIDE.md
└── README.md
```

---

## Backend Setup

### Step 1: Install MongoDB

#### Option A: Local Installation
- Download from https://www.mongodb.com/try/download/community
- Install and start the MongoDB service
- Verify: `mongod --version`

#### Option B: MongoDB Atlas (Cloud)
- Create account at https://www.mongodb.com/cloud/atlas
- Create a cluster
- Get connection string

### Step 2: Backend Installation

```bash
cd backend

# Install dependencies
npm install

# Create .env file (copy from .env.example)
copy .env.example .env

# Edit .env with your configuration
```

### Step 3: Configure Environment Variables

Create `.env` file in the `backend` folder:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/lottery_booking
JWT_SECRET=your_super_secret_jwt_key_change_this
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
NODE_ENV=development
```

**For MongoDB Atlas**, use connection string format:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/lottery_booking?retryWrites=true&w=majority
```

### Step 4: Start Backend Server

```bash
npm start
# OR for development with auto-reload
npm run dev
```

Backend will run on: `http://localhost:5000`

You should see:
```
MongoDB connected successfully
Admin user created
Server running on port 5000
```

---

## Frontend Setup

### Step 1: Frontend Installation

```bash
cd frontend

# Install dependencies
npm install
```

### Step 2: Update API Base URL (if needed)

In `frontend/src/services/api.js`, update the base URL if your backend is on a different server:

```javascript
const API_BASE_URL = 'http://localhost:5000/api';
```

### Step 3: Start Frontend Application

```bash
npm start
```

Frontend will automatically open at: `http://localhost:3000`

---

## Initial Login Credentials

**Admin Account:**
- Username: `admin`
- Password: `admin123`

**Note:** Change these credentials in production!

---

## Features Overview

### User Roles & Hierarchy

1. **Admin**
   - Can upload price results
   - View all sellers
   - View all price results
   - Cannot create sellers (only sellers under admin's tree)

2. **Seller**
   - Can create sub-sellers
   - Can book lottery tickets
   - Can check price results
   - Can send entries to parent

### Seller Dashboard Features

#### 1. Check Price
- Enter a unique code
- System shows if price/result exists
- Display "No result" if not found

#### 2. Add New Seller
- Create sub-sellers
- New seller linked as child
- Password automatically hashed

#### 3. Book Lottery
- Select series from dropdown
- Enter 5-digit number
- Choose box value (10, 20, 50, 100, 200, 500)
- Enter amount
- Add to pending list
- Send all entries to parent at once

### Admin Dashboard Features

#### 1. Upload Price/Result
- Enter unique code
- Enter price
- Save to database

#### 2. View All Results
- See all uploaded prices with dates

#### 3. View All Sellers
- List of all sellers in system
- View creation dates

### Time Restrictions

- **Level 1 Sellers** (directly under admin): Until **12:55 PM**
- **Level 2+ Sellers** (deeper hierarchy): Until **12:50 PM**
- After time limit: Pending entries are automatically deleted

---

## API Endpoints

### Authentication

```
POST /api/auth/login
GET  /api/auth/me
```

### Users

```
POST /api/users/create-seller
GET  /api/users/child-sellers
GET  /api/users/all-sellers (admin only)
```

### Lottery

```
POST /api/lottery/add-entry
GET  /api/lottery/pending-entries
DELETE /api/lottery/pending-entries/:entryId
POST /api/lottery/send-entries
GET  /api/lottery/sent-entries
```

### Prices

```
POST /api/prices/upload (admin only)
GET  /api/prices/:uniqueCode
GET  /api/prices (admin only)
```

---

## Testing the Application

### 1. Test Admin Login
- Go to login page
- Enter: username=`admin`, password=`admin123`
- Should see Admin Dashboard

### 2. Test Seller Creation
- Login as admin
- Go to "Add New Seller" tab
- Create a seller with username: `seller1`, password: `pass123`

### 3. Test Seller Dashboard
- Logout
- Login as `seller1` / `pass123`
- Try all three features:
  - Check Price (will show no result initially)
  - Add New Seller (create sub-seller)
  - Book Lottery (add entries)

### 4. Test Lottery Booking
- Go to "Book Lottery" tab
- Add multiple entries
- Check total amount calculation
- Click "Send Entries"

### 5. Test Admin Price Upload
- Login as admin
- Copy a unique code from sent entries
- Go to "Upload Price/Result"
- Enter the code and a price
- Save

### 6. Test Price Checking
- Login as seller
- Go to "Check Price"
- Enter the code you just uploaded
- Should see the price

---

## Troubleshooting

### Backend Issues

**Port 5000 already in use:**
```bash
# Change port in .env
PORT=5001
```

**MongoDB Connection Error:**
- Ensure MongoDB is running
- Check connection string in .env
- For Atlas: whitelist your IP address

**JWT Secret Issues:**
- Change `JWT_SECRET` in .env
- Clear localStorage in browser

### Frontend Issues

**CORS Error:**
- Ensure backend is running on port 5000
- Check API_BASE_URL in `api.js`

**Login Fails:**
- Ensure backend is running
- Check browser console for errors
- Verify credentials

**Token Expires:**
- Re-login to get new token
- Token lasts 24 hours by default

---

## Database Management

### MongoDB Commands

```bash
# Connect to MongoDB
mongo

# List databases
show dbs

# Use lottery database
use lottery_booking

# List collections
show collections

# View sample document
db.users.findOne()

# View all sellers
db.users.find({ role: 'seller' })

# Count entries
db.lotteryentries.countDocuments()
```

---

## Production Deployment

### Before Deploying:

1. **Change Admin Credentials**
   ```env
   ADMIN_USERNAME=your_secure_admin
   ADMIN_PASSWORD=your_strong_password
   ```

2. **Update JWT Secret**
   ```env
   JWT_SECRET=generate-long-random-secret-string
   ```

3. **Use Secure Database**
   - Use MongoDB Atlas with IP whitelisting
   - Enable authentication

4. **Update API Base URL**
   - Change frontend API_BASE_URL to production server

5. **Enable HTTPS**
   - Use SSL certificates
   - Update CORS settings

---

## File Organization

### Models (Backend)
- Define data structure
- Include validation
- Add helper methods

### Controllers (Backend)
- Business logic
- Database operations
- Response handling

### Routes (Backend)
- API endpoints
- Middleware integration

### Components (Frontend)
- React components
- UI logic
- API integration

### Services (Frontend)
- API calls
- Data management

---

## Common Operations

### Create a New Seller Hierarchy

```
Admin
└── Seller1
    ├── Seller1.1
    │   └── Seller1.1.1
    └── Seller1.2
└── Seller2
```

### Workflow

1. Admin logs in
2. Creates Seller1
3. Seller1 logs in
4. Seller1 creates Seller1.1
5. Seller1.1 logs in
6. Seller1.1 books lottery
7. Seller1.1 sends entries to Seller1
8. Seller1 sends entries to Admin
9. Admin uploads prices
10. All can check prices

---

## Support & Documentation

- See `API_DOCUMENTATION.md` for detailed API specs
- See `DATABASE_SCHEMA.md` for schema details
- Check validation requirements in controllers

---

## Security Notes

- Passwords are hashed with bcrypt (10 salt rounds)
- JWT tokens expire after 24 hours
- All sensitive routes require authentication
- Role-based access control implemented
- Time restrictions enforced on backend
