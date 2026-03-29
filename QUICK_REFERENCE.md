# Lottery Booking System - Quick Reference

## Quick Commands

### Backend
```bash
# Install dependencies
cd backend && npm install

# Start server (development)
npm run dev

# Start server (production)
npm start
```

### Frontend
```bash
# Install dependencies
cd frontend && npm install

# Start React app
npm start

# Build for production
npm run build
```

## Default Credentials
- Admin Username: `admin`
- Admin Password: `admin123`

## MongoDB Connection
Local: `mongodb://localhost:27017/lottery_booking`
Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/lottery_booking`

## Environment Variables (backend/.env)
```
PORT=5000
MONGODB_URI=YOUR_MONGODB_URI
JWT_SECRET=your_secret_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
NODE_ENV=development
```

## API Base URL
Frontend should use: `http://localhost:5000/api`

## Useful MongoDB Commands
```bash
# Connect
mongo

# Select database
use lottery_booking

# View collections
show collections

# Count documents
db.users.countDocuments()
db.lotteryentries.countDocuments()

# Find all sellers
db.users.find({ role: 'seller' })
```

## File Locations
- Backend Controllers: `backend/controllers/`
- Backend Models: `backend/models/`
- Frontend Components: `frontend/src/components/`
- Database Schema: `docs/DATABASE_SCHEMA.md`
- API Docs: `docs/API_DOCUMENTATION.md`
- Setup Guide: `docs/SETUP_GUIDE.md`

## Common Issues

### Port 5000 in Use
Change PORT in `backend/.env`

### MongoDB Connection Error
- Check MongoDB is running
- Verify connection string
- For Atlas: whitelist your IP

### CORS Error
- Ensure backend is running
- Check API base URL in frontend
- Restart both servers

### Login Fails
- Check credentials
- Verify MongoDB is connected
- Clear browser localStorage

## Test Workflow
1. Login as admin
2. Create seller1
3. Logout and login as seller1
4. Create seller1.1
5. Book lottery entries as seller1.1
6. Send entries to seller1
7. Admin uploads prices
8. Check prices
