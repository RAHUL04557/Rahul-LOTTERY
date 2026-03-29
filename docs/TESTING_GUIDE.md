# Testing Guide - Lottery Booking System

## Test Environment Setup

### Prerequisites
- Both backend and frontend running
- MongoDB running and connected
- Default admin user created (admin/admin123)

---

## Unit Test Scenarios

### 1. Authentication Tests

#### Test 1.1: Admin Login
```
Input: username=admin, password=admin123
Expected: 
- Receives valid JWT token
- User role=admin
- Can access admin dashboard
Status: ✓
```

#### Test 1.2: Invalid Credentials
```
Input: username=invalid, password=wrong
Expected:
- Error message: "Invalid username or password"
- No token issued
Status: ✓
```

#### Test 1.3: Seller Login
```
Steps:
1. From admin, create seller1 (pass123)
2. Login with seller1/pass123
Expected:
- Receives valid JWT token
- User role=seller
- Can access seller dashboard
Status: ✓
```

---

### 2. User Management Tests

#### Test 2.1: Create Sub-Seller
```
Setup: Login as seller1
Steps:
1. Click "Add New Seller"
2. Username: seller1.1, Password: pass123
Expected:
- New seller created
- Parent ID = seller1's ID
- Can login as seller1.1
Status: ✓
```

#### Test 2.2: Duplicate Username
```
Steps:
1. Try to create seller with existing username
Expected:
- Error: "Username already exists"
- No duplicate created
Status: ✓
```

#### Test 2.3: View Child Sellers
```
Setup: Login as seller with multiple children
Steps:
1. Go to child sellers
Expected:
- List all direct children
- Doesn't show grandchildren
Status: ✓
```

---

### 3. Lottery Booking Tests

#### Test 3.1: Add Single Entry
```
Setup: Login as seller
Steps:
1. Go to "Book Lottery"
2. Series: Draw1
3. Number: 12345
4. Box: 100
5. Amount: 500
6. Click "Add Entry"
Expected:
- Entry appears in list
- Unique code auto-generated
- Status: pending
- Amount displays correctly
Status: ✓
```

#### Test 3.2: Validation - Invalid Number
```
Steps:
1. Try to add with number: 123 (less than 5 digits)
Expected:
- Error: "Number must be 5 digits"
- Entry not added
Status: ✓
```

#### Test 3.3: Validation - Empty Fields
```
Steps:
1. Try to submit without filling all fields
Expected:
- Error: "All fields are required"
- Entry not added
Status: ✓
```

#### Test 3.4: Multiple Entries & Total
```
Setup: Add multiple entries
Entries:
- Entry1: 500
- Entry2: 250
- Entry3: 750
Expected:
- All entries visible in table
- Total: 1500
- Real-time update on add
Status: ✓
```

#### Test 3.5: Delete Entry
```
Setup: Entry in pending list
Steps:
1. Click Delete on an entry
Expected:
- Entry removed from list
- Total recalculates
- Confirmation (optional)
Status: ✓
```

#### Test 3.6: Send Entries
```
Setup: 3 pending entries totaling 1500
Steps:
1. Click "Send Entries"
Expected:
- All entries sent
- Status changes to "sent"
- Entries visible to parent
- Seller's pending list clears
Status: ✓
```

#### Test 3.7: Send Without Entries
```
Setup: No pending entries
Steps:
1. Click "Send Entries"
Expected:
- Error: "No entries to send"
- No API call made
Status: ✓
```

---

### 4. Time Restriction Tests

#### Test 4.1: Level 1 Before 12:55 PM
```
Setup: Seller directly under admin
Time: Before 12:55 PM
Steps:
1. Add entry
2. Send entries
Expected:
- All operations succeed
Status: ✓
```

#### Test 4.2: Level 1 After 12:55 PM
```
Setup: Seller directly under admin
Time: After 12:55 PM
Steps:
1. Try to add entry
Expected:
- Error: "Time limit exceeded for posting entries"
- Entry not added
Status: ✓
```

#### Test 4.2b: Level 1 Send After 12:55 PM
```
Setup: Level 1 seller with pending entries
Time: After 12:55 PM
Steps:
1. Try to send entries
Expected:
- Error: "Time limit exceeded..."
- Pending entries auto-deleted
Status: ✓
```

#### Test 4.3: Level 2+ Before 12:50 PM
```
Setup: Seller at level 2 or deeper
Time: Before 12:50 PM
Steps:
1. Add entry
2. Send entries
Expected:
- All operations succeed
Status: ✓
```

#### Test 4.4: Level 2+ After 12:50 PM
```
Setup: Level 2+ seller
Time: After 12:50 PM
Steps:
1. Try to add entry
Expected:
- Error: "Time limit exceeded for posting entries"
Status: ✓
```

---

### 5. Price Management Tests

#### Test 5.1: Admin Upload Price
```
Setup: Login as admin
Steps:
1. Go to "Upload Price/Result"
2. Unique Code: a1b2c3d4
3. Price: 5000
4. Click Upload
Expected:
- Success message
- Price visible in "All Results"
- Created with current date
Status: ✓
```

#### Test 5.2: Update Existing Price
```
Setup: Price already exists
Steps:
1. Upload same code with new price
Expected:
- Price updated, not duplicated
- New result date
Status: ✓
```

#### Test 5.3: Check Price - Found
```
Setup: Price uploaded
Steps:
1. Login as any user
2. Go to "Check Price"
3. Enter known code
Expected:
- Price displays
- Shows price value
Status: ✓
```

#### Test 5.4: Check Price - Not Found
```
Setup: Code doesn't exist
Steps:
1. Go to "Check Price"
2. Enter unknown code
Expected:
- Shows "No result"
- No error
Status: ✓
```

#### Test 5.5: Admin View All Prices
```
Setup: Multiple prices uploaded
Steps:
1. Admin login
2. Go to "All Results"
Expected:
- All prices displayed
- Sorted by date
- Shows code, price, date
Status: ✓
```

---

### 6. Data Flow Tests

#### Test 6.1: Multi-Level Hierarchy
```
Hierarchy:
Admin
  └─ Seller1
      └─ Seller1.1
          └─ Seller1.1.1

Steps:
1. Seller1.1.1 books entries
2. Seller1.1.1 sends to Seller1.1
3. Seller1.1 sees entries from Seller1.1.1
4. Seller1.1 sends to Seller1
5. Seller1 sees entries from Seller1.1
6. Seller1 sends to Admin
7. Data reaches admin via "Sent Entries"

Expected: ✓ All data flows correctly upward
```

#### Test 6.2: Data Isolation
```
Setup: Two separate seller trees under admin
- Seller A with children
- Seller B with children

Steps:
1. Seller A books entries
2. Login as Seller B
Expected:
- Can't see Seller A's entries
- Can only see own entries and children's
Status: ✓
```

---

### 7. Session & Token Tests

#### Test 7.1: Token Persistence
```
Steps:
1. Login
2. Close tab
3. Reopen app
Expected:
- Still logged in
- Can access dashboard without re-login
Status: ✓
```

#### Test 7.2: Token Expiry
```
Setup: Token near expiration
Steps:
1. Make API call after 24 hours
Expected:
- Error: "Invalid or expired token"
- Redirect to login
Status: ✓
```

#### Test 7.3: Logout
```
Steps:
1. Login
2. Click Logout
Expected:
- Token cleared from localStorage
- Redirect to login
- Can't access dashboard
Status: ✓
```

---

### 8. Admin Dashboard Tests

#### Test 8.1: Admin Can't Create Sellers
```
Setup: Login as admin
Expected:
- "Add New Seller" option not available or disabled
Status: ✓
```

#### Test 8.2: Admin View All Sellers
```
Setup: Admin dashboard
Steps:
1. Go to "All Sellers"
Expected:
- List of all sellers in system
- Shows username, role, creation date
Status: ✓
```

#### Test 8.3: Seller Can't Access Admin Features
```
Setup: Seller tries direct API call
Steps:
1. Try POST /admin/prices without admin role
Expected:
- Error: "Access denied"
- Status 403
Status: ✓
```

---

## Integration Test Scenarios

### Scenario 1: Complete Workflow
```
1. Admin logs in (admin/admin123)
2. Admin creates Seller1 (seller1/pass1)
3. Admin creates Seller2 (seller2/pass2)
4. Admin logs out
5. Seller1 logs in
6. Seller1 creates Seller1.1 (seller1.1/pass1.1)
7. Seller1 books 3 lottery entries
8. Seller1 sends to Admin
9. Seller1.1 logs in
10. Seller1.1 books 2 lottery entries
11. Seller1.1 sends to Seller1
12. Seller1 sees entries from Seller1.1
13. Seller1 sends combined entries to Admin
14. Admin logs in
15. Admin sees all entries in "Sent Entries"
16. Admin uploads prices for all codes
17. All users check prices using codes
18. All prices display correctly
```

### Scenario 2: Time Restriction Workflow
```
1. Create level 1 seller (Seller1)
2. Create level 2 seller (Seller1.1)
3. At 12:45 PM:
   - Both Seller1 and Seller1.1 can book
4. At 12:51 PM:
   - Seller1.1 can't book (level 2)
   - Seller1 can still book
5. At 12:56 PM:
   - Seller1 can't book (level 1)
   - Both deleted their pending entries
```

---

## Performance Tests

### Load Test 1: Multiple Entries
```
Add 100 entries to single booking session
Expected:
- UI remains responsive
- All entries display correctly
- Total calculates correctly
- Send operation completes in < 2 seconds
```

### Load Test 2: Large Seller Tree
```
Create 5-level deep hierarchy with 100 total sellers
Expected:
- Login still fast
- Child seller list loads quickly
- No lag in UI
```

---

## Edge Cases

### Edge Case 1: Rapid Submissions
```
Steps:
1. Click "Send Entries" multiple times rapidly
Expected:
- Only one submission succeeds
- No duplicate submissions
```

### Edge Case 2: Back Button After Logout
```
Steps:
1. Login
2. Logout
3. Click browser back button
Expected:
- Dashboard not accessible
- Redirect to login
```

### Edge Case 3: Expired Token Silent Refresh
```
Expected:
- App attempts to refresh token
- If failed, redirect to login
- No unexpected errors
```

---

## Browser Compatibility Tests

Test on:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Expected: All features work consistently

---

## Regression Checklist

- [ ] Login works
- [ ] Seller creation works
- [ ] Lottery booking works
- [ ] Entry sending works
- [ ] Price checking works
- [ ] Admin features work
- [ ] Time restrictions work
- [ ] Logout works
- [ ] Token persists
- [ ] Responsive design works
- [ ] Error messages display
- [ ] Validation works
- [ ] Total calculation correct
- [ ] Unique codes generated
- [ ] Hierarchy maintained
- [ ] No duplicate entries

---

## Test Results Template

```
Date: ____________________
Tester: ____________________
Environment: ____________________

Test Case: ____________________
Status: [✓ Pass] [✗ Fail] [⚠ Partial]
Notes: ____________________

Test Case: ____________________
Status: [✓ Pass] [✗ Fail] [⚠ Partial]
Notes: ____________________

Overall Result: [✓ Pass] [✗ Fail]
Issues Found: 
1. ____________________
2. ____________________

Signature: ____________________
```
