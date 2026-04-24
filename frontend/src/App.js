import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Home from './components/Home';
import SellerDashboard from './components/SellerDashboard';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import EntrySelectionScreen from './components/EntrySelectionScreen';
import { authService } from './services/api';
import './styles/index.css';

const canUseEntryAmount = (user, amount) => {
  if (!user || user.role === 'admin') {
    return true;
  }

  if (String(amount) === '7') {
    return Number(user.rateAmount6 || 0) > 0;
  }

  if (String(amount) === '12') {
    return Number(user.rateAmount12 || 0) > 0;
  }

  return false;
};

function App() {
  const [user, setUser] = useState(null);
  const [entryConfig, setEntryConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const savedToken = localStorage.getItem('token');
      const savedEntryConfig = localStorage.getItem('entryConfig');

      if (!savedToken) {
        setLoading(false);
        return;
      }

      try {
        const response = await authService.getCurrentUser();
        const currentUser = response.data;
        setUser(currentUser);
        localStorage.setItem('user', JSON.stringify(currentUser));

        if (savedEntryConfig) {
          try {
            const parsedEntryConfig = JSON.parse(savedEntryConfig);
            if (canUseEntryAmount(currentUser, parsedEntryConfig.amount)) {
              setEntryConfig(parsedEntryConfig);
            } else {
              localStorage.removeItem('entryConfig');
              setEntryConfig(null);
            }
          } catch (error) {
            localStorage.removeItem('entryConfig');
            setEntryConfig(null);
          }
        }
      } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('entryConfig');
        setUser(null);
        setEntryConfig(null);
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
    localStorage.removeItem('entryConfig');
    setUser(null);
    setEntryConfig(null);
  };

  const handleEntryConfirm = (config) => {
    if (!canUseEntryAmount(user, config.amount)) {
      localStorage.removeItem('entryConfig');
      setEntryConfig(null);
      return;
    }

    localStorage.setItem('entryConfig', JSON.stringify(config));
    setEntryConfig(config);
  };

  const handleExitSession = () => {
    setEntryConfig(null);
    localStorage.removeItem('entryConfig');
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (user.role === 'superadmin') {
    return <SuperAdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (user.role === 'guest') {
    return <Home user={user} onLogout={handleLogout} />;
  }

  if (!entryConfig) {
    return <EntrySelectionScreen user={user} onConfirm={handleEntryConfirm} onLogout={handleLogout} />;
  }

  if (user.role === 'admin') {
    return (
      <AdminDashboard
        user={user}
        onLogout={handleLogout}
        onExitSession={handleExitSession}
        initialActiveTab={entryConfig.mode === 'generate-bill' ? 'generate-bill' : ''}
        initialSessionMode={entryConfig.sessionMode}
        initialPurchaseCategory={entryConfig.purchaseCategory}
        initialAmount={entryConfig.amount}
        initialBillAmount={entryConfig.mode === 'generate-bill' ? entryConfig.amount : ''}
        initialBookingDate={entryConfig.bookingDate}
        entryCompanyLabel={entryConfig.companyLabel || ''}
      />
    );
  }

  return (
    <SellerDashboard
      user={user}
      onLogout={handleLogout}
      sessionMode={entryConfig.sessionMode}
      purchaseCategory={entryConfig.purchaseCategory}
      onExitSession={handleExitSession}
      initialActiveTab={entryConfig.mode === 'generate-bill' ? 'generate-bill' : ''}
      initialAmount={entryConfig.amount}
      initialBillAmount={entryConfig.mode === 'generate-bill' ? entryConfig.amount : ''}
      initialBookingDate={entryConfig.bookingDate}
      billOnlyMode={entryConfig.mode === 'generate-bill'}
      entryCompanyLabel={entryConfig.companyLabel || ''}
    />
  );
}

export default App;
