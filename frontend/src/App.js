import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Home from './components/Home';
import SellerDashboard from './components/SellerDashboard';
import AdminDashboard from './components/AdminDashboard';
import { authService } from './services/api';
import './styles/index.css';

function App() {
  const [user, setUser] = useState(null);
  const [sellerSessionMode, setSellerSessionMode] = useState('');
  const [sellerEntryMode, setSellerEntryMode] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const savedToken = localStorage.getItem('token');
      const savedSellerSessionMode = localStorage.getItem('sellerSessionMode');

      if (savedSellerSessionMode) {
        const normalizedSellerSessionMode = savedSellerSessionMode === 'DAY' ? 'MORNING' : savedSellerSessionMode;
        localStorage.setItem('sellerSessionMode', normalizedSellerSessionMode);
        setSellerSessionMode(normalizedSellerSessionMode);
      }

      if (!savedToken) {
        setLoading(false);
        return;
      }

      try {
        const response = await authService.getCurrentUser();
        setUser(response.data);
        localStorage.setItem('user', JSON.stringify(response.data));
      } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('sellerSessionMode');
        setUser(null);
        setSellerSessionMode('');
        setSellerEntryMode('');
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('sellerSessionMode');
    setUser(null);
    setSellerSessionMode('');
    setSellerEntryMode('');
  };

  const handleSellerSessionModeSelect = (mode) => {
    localStorage.setItem('sellerSessionMode', mode);
    setSellerSessionMode(mode);
    setSellerEntryMode('session');
  };

  const handleSellerBillSelect = () => {
    localStorage.removeItem('sellerSessionMode');
    setSellerSessionMode('');
    setSellerEntryMode('generate-bill');
  };

  const handleExitSession = () => {
    setSellerSessionMode('');
    setSellerEntryMode('');
    localStorage.removeItem('sellerSessionMode');
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (user.role === 'guest') {
    return <Home user={user} onLogout={handleLogout} />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (!sellerSessionMode && sellerEntryMode !== 'generate-bill') {
    return (
      <div className="session-mode-container">
        <div className="session-mode-box">
          <h1>Choose Session</h1>
          <button type="button" onClick={() => handleSellerSessionModeSelect('MORNING')}>MORNING</button>
          <button type="button" onClick={() => handleSellerSessionModeSelect('NIGHT')}>NIGHT</button>
          <button type="button" onClick={handleSellerBillSelect}>GENERATE BILL</button>
        </div>
      </div>
    );
  }

  return (
    <SellerDashboard
      user={user}
      onLogout={handleLogout}
      sessionMode={sellerSessionMode}
      onExitSession={handleExitSession}
      initialActiveTab={sellerEntryMode === 'generate-bill' ? 'generate-bill' : ''}
      billOnlyMode={sellerEntryMode === 'generate-bill'}
    />
  );
}

export default App;
