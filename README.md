# Lottery Booking System - Multi-Level Seller Tree

A complete full-stack web application for managing a multi-level seller hierarchy with lottery booking capabilities and admin price management.

## 🎯 Features

### Core Features
- **Multi-Level Seller Tree**: Create hierarchical seller structures
- **Lottery Booking**: Book lottery tickets with unique codes
- **Price Management**: Admin uploads and manages lottery results
- **Role-Based Access**: Admin and Seller roles with different permissions
- **Time-Based Restrictions**: Automatic data deletion after cutoff times
- **Secure Authentication**: JWT-based authentication with password hashing

### Seller Dashboard
1. **Check Price** - Query lottery results by unique code
2. **Add New Seller** - Create sub-sellers in the hierarchy
3. **Book Lottery** - Book lottery tickets with series, numbers, and box values
4. **Send Entries** - Submit all entries to parent user

### Admin Dashboard
1. **Upload Prices** - Upload lottery result prices
2. **View Results** - Browse all uploaded results
3. **View Sellers** - Monitor all sellers in system

## 🛠️ Tech Stack

- **Frontend**: React 18, React Router, Axios
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: Bcrypt password hashing

## 📋 Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0
- MongoDB (local or Atlas)
- Modern web browser

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
copy .env.example .env
# Edit .env with your MongoDB URI and other settings

# Start server
npm start
```

Backend runs on: `http://localhost:5000`

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start application
npm start
```

Frontend opens at: `http://localhost:3000`

### 3. Default Admin Credentials

- Username: `admin`
- Password: `admin123`

⚠️ **Change these in production!**

## 📚 Documentation

- [Setup Guide](./docs/SETUP_GUIDE.md) - Detailed installation instructions
- [API Documentation](./docs/API_DOCUMENTATION.md) - Complete API reference
- [Database Schema](./docs/DATABASE_SCHEMA.md) - Schema documentation

## 🏗️ Project Structure

```
lot/
├── backend/                 # Node.js + Express API
│   ├── models/             # MongoDB schemas
│   ├── controllers/        # Business logic
│   ├── routes/            # API endpoints
│   ├── middleware/        # Auth & validation
│   ├── utils/             # Helper functions
│   ├── config/            # Database config
│   ├── server.js          # Main server file
│   └── package.json
├── frontend/              # React application
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── services/      # API service
│   │   ├── styles/        # CSS styles
│   │   ├── App.js        # Main component
│   │   └── index.js      # Entry point
│   ├── public/           # Static files
│   └── package.json
├── docs/                 # Documentation
│   ├── SETUP_GUIDE.md
│   ├── API_DOCUMENTATION.md
│   └── DATABASE_SCHEMA.md
└── README.md            # This file
```

## 🔐 User Hierarchy Example

```
Admin (parent_id = null)
├── Seller1 (parent_id = Admin)
│   ├── Seller1.1 (parent_id = Seller1)
│   │   └── Seller1.1.1 (parent_id = Seller1.1)
│   └── Seller1.2 (parent_id = Seller1)
└── Seller2 (parent_id = Admin)
    └── Seller2.1 (parent_id = Seller2)
```

## ⏰ Time Restrictions

- **Level 1 Sellers** (directly under admin): Booking allowed until **12:55 PM**
- **Level 2+ Sellers**: Booking allowed until **12:50 PM**
- **After Cutoff**: Pending entries automatically deleted

## 🔄 Data Flow

1. Seller books lottery tickets
2. Seller sends entries to parent
3. Parent receives entries from children
4. Parent can forward to their parent
5. Data eventually reaches admin
6. Admin uploads prices/results
7. All users can check prices with unique codes

## 🗄️ Database Collections

### Users
- username, password (hashed), role, parentId, createdAt

### Lottery Entries
- userId, series, number, boxValue, uniqueCode, amount, status, sentToParent, createdAt, sentAt

### Prices
- uniqueCode, price, resultDate, createdAt

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/login | User login |
| GET | /auth/me | Current user info |
| POST | /users/create-seller | Create new seller |
| GET | /users/child-sellers | Get child sellers |
| GET | /users/all-sellers | Get all sellers (admin) |
| POST | /lottery/add-entry | Add lottery entry |
| GET | /lottery/pending-entries | Get pending entries |
| POST | /lottery/send-entries | Send entries to parent |
| GET | /lottery/sent-entries | Get entries from children |
| POST | /prices/upload | Upload price (admin) |
| GET | /prices/:code | Get price by code |

See [API Documentation](./docs/API_DOCUMENTATION.md) for details.

## 🧪 Testing

### Test Admin Account
1. Login with admin/admin123
2. Upload a price result

### Test Seller Account
1. Create a seller from admin account
2. Login as seller
3. Book lottery entries
4. Check uploaded prices

### Test Hierarchical Structure
1. Create multiple levels of sellers
2. Book entries at each level
3. Send entries up the hierarchy

## 🔒 Security Features

- ✅ Password hashing with bcrypt
- ✅ JWT authentication
- ✅ Role-based access control
- ✅ Authorization middleware
- ✅ Time-based data deletion
- ✅ Unique code generation

## 📦 Environment Variables

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/lottery_booking
JWT_SECRET=your_secret_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
NODE_ENV=development
```

## 🐛 Troubleshooting

### Backend Won't Start
- Check MongoDB is running
- Verify connection string
- Check port isn't in use

### Frontend Can't Connect
- Ensure backend is running on port 5000
- Clear browser cache
- Check CORS settings

### Login Fails
- Verify credentials
- Check JWT secret matches
- Clear localStorage

See [Setup Guide](./docs/SETUP_GUIDE.md) for more help.

## 📞 Support

For detailed information:
- [Setup Guide](./docs/SETUP_GUIDE.md) - Installation help
- [API Docs](./docs/API_DOCUMENTATION.md) - API reference
- [Schema Docs](./docs/DATABASE_SCHEMA.md) - Database structure

## 📄 License

MIT License - Feel free to use this project

## 🎓 Learning Resources

This project demonstrates:
- Full-stack JavaScript development
- Database design with MongoDB
- RESTful API design
- React for UI
- JWT authentication
- Hierarchical data structures
- Time-based business logic

---

**Created**: March 2024
**Last Updated**: March 23, 2024
