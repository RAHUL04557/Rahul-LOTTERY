# Database Schema

## Users Collection

```json
{
  "_id": "ObjectId",
  "username": "String (unique)",
  "password": "String (hashed with bcrypt)",
  "role": "String (admin/seller)",
  "parentId": "ObjectId (ref: Users) or null",
  "createdAt": "Date"
}
```

### Indexes
- `username`: unique

### Notes
- Admin has `parentId = null`
- Sellers have `parentId` pointing to their parent user
- Password is automatically hashed before saving

---

## Lottery Entries Collection

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId (ref: Users)",
  "series": "String",
  "number": "String (5 digits)",
  "boxValue": "String",
  "uniqueCode": "String (unique)",
  "amount": "Number",
  "status": "String (pending/sent/expired)",
  "sentToParent": "ObjectId (ref: Users) or null",
  "createdAt": "Date",
  "sentAt": "Date or null"
}
```

### Indexes
- `uniqueCode`: unique
- `userId`: for querying user entries
- `status`: for filtering

### Notes
- `uniqueCode` is auto-generated using UUID
- Status changes: pending → sent → (if after time limit: deleted)
- `sentToParent` is populated when entry is sent to parent

---

## Prices Collection

```json
{
  "_id": "ObjectId",
  "uniqueCode": "String (unique)",
  "price": "Number",
  "resultDate": "Date",
  "createdAt": "Date"
}
```

### Indexes
- `uniqueCode`: unique

### Notes
- Stores price results mapped to unique codes
- Admin uploads these results
- Used for "Check Price" feature
