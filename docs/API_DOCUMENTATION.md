# API Documentation

## Base URL
`http://localhost:5000/api`

## Authentication

All endpoints (except login) require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

---

## Authentication Endpoints

### POST /auth/login

Login user and receive JWT token.

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response (200):**
```json
{
  "message": "Admin login successful|Seller login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "admin",
    "role": "admin"
  }
}
```

**Response (401):**
```json
{
  "message": "Invalid username or password"
}
```

---

### GET /auth/me

Get current authenticated user details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "admin",
  "password": "$2a$10$...",
  "role": "admin",
  "parentId": null,
  "createdAt": "2024-03-23T10:00:00.000Z"
}
```

---

## User Management Endpoints

### POST /users/create-seller

Create a new seller (current user becomes parent).

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "username": "newseller",
  "password": "securepass123"
}
```

**Response (201):**
```json
{
  "message": "Seller created successfully",
  "seller": {
    "id": "507f1f77bcf86cd799439012",
    "username": "newseller",
    "role": "seller"
  }
}
```

**Response (400):**
```json
{
  "message": "Username already exists"
}
```

---

### GET /users/child-sellers

Get all child sellers of current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
    "username": "seller1",
    "role": "seller",
    "parentId": "507f1f77bcf86cd799439011",
    "createdAt": "2024-03-23T10:00:00.000Z"
  },
  {
    "_id": "507f1f77bcf86cd799439013",
    "username": "seller2",
    "role": "seller",
    "parentId": "507f1f77bcf86cd799439011",
    "createdAt": "2024-03-23T11:00:00.000Z"
  }
]
```

---

### GET /users/all-sellers

Get all sellers in system (Admin only).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
    "username": "seller1",
    "role": "seller",
    "parentId": "507f1f77bcf86cd799439011",
    "createdAt": "2024-03-23T10:00:00.000Z"
  },
  ...
]
```

**Response (403):**
```json
{
  "message": "Access denied"
}
```

---

## Lottery Endpoints

### POST /lottery/add-entry

Add a new lottery entry (seller only).

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "series": "Draw1",
  "number": "12345",
  "boxValue": "100",
  "amount": 500.00
}
```

**Response (201):**
```json
{
  "message": "Entry added successfully",
  "entry": {
    "_id": "507f1f77bcf86cd799439014",
    "userId": "507f1f77bcf86cd799439012",
    "series": "Draw1",
    "number": "12345",
    "boxValue": "100",
    "uniqueCode": "a1b2c3d4",
    "amount": 500.00,
    "status": "pending",
    "createdAt": "2024-03-23T11:30:00.000Z"
  }
}
```

**Response (400):**
```json
{
  "message": "Time limit exceeded for posting entries"
}
```

---

### GET /lottery/pending-entries

Get all pending entries for current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439014",
    "userId": "507f1f77bcf86cd799439012",
    "series": "Draw1",
    "number": "12345",
    "boxValue": "100",
    "uniqueCode": "a1b2c3d4",
    "amount": 500.00,
    "status": "pending",
    "createdAt": "2024-03-23T11:30:00.000Z"
  }
]
```

---

### DELETE /lottery/pending-entries/:entryId

Delete a pending entry.

**Headers:**
```
Authorization: Bearer <token>
```

**URL Parameters:**
```
entryId: 507f1f77bcf86cd799439014
```

**Response (200):**
```json
{
  "message": "Entry deleted successfully"
}
```

**Response (404):**
```json
{
  "message": "Entry not found"
}
```

---

### POST /lottery/send-entries

Send all pending entries to parent user.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)
```json
{}
```

**Response (200):**
```json
{
  "message": "Entries sent successfully to parent",
  "entriesSent": 5
}
```

**Response (400):**
```json
{
  "message": "Time limit exceeded. Pending entries have been deleted."
}
```

---

### GET /lottery/sent-entries

Get entries sent from child users (seller only).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439014",
    "userId": {
      "_id": "507f1f77bcf86cd799439012",
      "username": "seller1"
    },
    "series": "Draw1",
    "number": "12345",
    "boxValue": "100",
    "uniqueCode": "a1b2c3d4",
    "amount": 500.00,
    "status": "sent",
    "sentToParent": "507f1f77bcf86cd799439011",
    "sentAt": "2024-03-23T11:35:00.000Z"
  }
]
```

---

## Price Endpoints

### POST /prices/upload

Upload a price result (Admin only).

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "uniqueCode": "a1b2c3d4",
  "price": 5000
}
```

**Response (201):**
```json
{
  "message": "Price uploaded successfully",
  "price": {
    "_id": "507f1f77bcf86cd799439015",
    "uniqueCode": "a1b2c3d4",
    "price": 5000,
    "resultDate": "2024-03-23T12:00:00.000Z",
    "createdAt": "2024-03-23T12:00:00.000Z"
  }
}
```

**Response (200 - Update):**
```json
{
  "message": "Price updated successfully",
  "price": {
    "_id": "507f1f77bcf86cd799439015",
    "uniqueCode": "a1b2c3d4",
    "price": 5500,
    "resultDate": "2024-03-23T12:05:00.000Z",
    "createdAt": "2024-03-23T12:00:00.000Z"
  }
}
```

---

### GET /prices/:uniqueCode

Get price for a unique code.

**Headers:**
```
Authorization: Bearer <token>
```

**URL Parameters:**
```
uniqueCode: a1b2c3d4
```

**Response (200 - Found):**
```json
{
  "price": {
    "_id": "507f1f77bcf86cd799439015",
    "uniqueCode": "a1b2c3d4",
    "price": 5000,
    "resultDate": "2024-03-23T12:00:00.000Z",
    "createdAt": "2024-03-23T12:00:00.000Z"
  }
}
```

**Response (200 - Not Found):**
```json
{
  "message": "No result",
  "price": null
}
```

---

### GET /prices

Get all prices (Admin only).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439015",
    "uniqueCode": "a1b2c3d4",
    "price": 5000,
    "resultDate": "2024-03-23T12:00:00.000Z",
    "createdAt": "2024-03-23T12:00:00.000Z"
  },
  {
    "_id": "507f1f77bcf86cd799439016",
    "uniqueCode": "e5f6g7h8",
    "price": 3000,
    "resultDate": "2024-03-23T12:10:00.000Z",
    "createdAt": "2024-03-23T12:10:00.000Z"
  }
]
```

---

## Error Responses

### 400 Bad Request
```json
{
  "message": "All fields required"
}
```

### 401 Unauthorized
```json
{
  "message": "No token provided|Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "message": "Access denied"
}
```

### 404 Not Found
```json
{
  "message": "Entry not found"
}
```

### 500 Server Error
```json
{
  "message": "Server error",
  "error": "Detailed error message"
}
```

---

## Request/Response Examples

### Example 1: Complete Lottery Booking Flow

```bash
# 1. Login as Seller
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"seller1","password":"pass123"}'

# Response includes token

# 2. Add Lottery Entry
curl -X POST http://localhost:5000/api/lottery/add-entry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "series":"Draw1",
    "number":"12345",
    "boxValue":"100",
    "amount":500
  }'

# 3. Get Pending Entries
curl -X GET http://localhost:5000/api/lottery/pending-entries \
  -H "Authorization: Bearer <token>"

# 4. Send Entries to Parent
curl -X POST http://localhost:5000/api/lottery/send-entries \
  -H "Authorization: Bearer <token>" \
  -d '{}'

# 5. Parent user Get Sent Entries
curl -X GET http://localhost:5000/api/lottery/sent-entries \
  -H "Authorization: Bearer <parent-token>"
```

---

## Rate Limiting

No rate limiting implemented. Consider adding in production.

## Pagination

Not implemented. Consider adding for large datasets.

## Filtering

Not fully implemented. Advanced filtering can be added to collection endpoints.

## Sorting

Basic sorting implemented by creation date for prices.
