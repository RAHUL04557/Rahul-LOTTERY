import React, { useState } from 'react';

const APP_ACCESS_PASSWORD = 'lottery';
const APP_ACCESS_STORAGE_KEY = 'lotteryAppAccessGranted';

export const hasAppAccess = () => sessionStorage.getItem(APP_ACCESS_STORAGE_KEY) === 'true';

const AppAccessGate = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();

    if (password.trim() !== APP_ACCESS_PASSWORD) {
      setError('Incorrect app password');
      return;
    }

    sessionStorage.setItem(APP_ACCESS_STORAGE_KEY, 'true');
    setError('');
    onUnlock();
  };

  return (
    <div className="app-access-container">
      <div className="app-access-box">
        <h1>Lottery Booking</h1>
        <p>Enter app password to continue.</p>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="app-password">Password</label>
            <input
              id="app-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="Enter password"
            />
          </div>
          <button type="submit">Unlock App</button>
        </form>
      </div>
    </div>
  );
};

export default AppAccessGate;
