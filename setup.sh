#!/bin/bash

echo "======================================"
echo "Lottery Booking System - Quick Start"
echo "======================================"
echo ""

echo "Installing backend dependencies..."
cd backend
npm install
if [ $? -ne 0 ]; then
  echo "Error installing backend dependencies"
  exit 1
fi

echo "Creating .env file from example..."
cp .env.example .env
echo "Backend setup complete!"
echo ""
echo "IMPORTANT: Edit backend/.env and update MONGODB_URI with your MongoDB connection string"
echo ""

cd ..

echo "Installing frontend dependencies..."
cd frontend
npm install
if [ $? -ne 0 ]; then
  echo "Error installing frontend dependencies"
  exit 1
fi

cd ..

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Edit backend/.env with your MongoDB URI"
echo "2. Start MongoDB service"
echo "3. Run: cd backend && npm start"
echo "4. In another terminal: cd frontend && npm start"
echo ""
echo "Default Admin Credentials:"
echo "Username: admin"
echo "Password: admin123"
echo ""
echo "Documentation:"
echo "- Setup Guide: docs/SETUP_GUIDE.md"
echo "- API Docs: docs/API_DOCUMENTATION.md"
echo ""
