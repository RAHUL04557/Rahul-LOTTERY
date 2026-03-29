import React from 'react';

const Home = ({ user, onLogout }) => {
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    onLogout();
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>Lottery Booking System</h1>
        <button onClick={handleLogout} style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
          Logout
        </button>
      </div>

      <div style={{ backgroundColor: '#f8f9fa', padding: '30px', borderRadius: '10px', textAlign: 'center' }}>
        <h2>Welcome to Lottery Booking System</h2>
        <p style={{ fontSize: '16px', color: '#666', marginTop: '15px' }}>
          You are currently browsing as a guest. To access full features, please log in with your credentials.
        </p>
        <div style={{ marginTop: '30px', lineHeight: '1.8', color: '#555' }}>
          <h3>System Features:</h3>
          <ul style={{ listStylePosition: 'inside' }}>
            <li>📋 Manage lottery bookings</li>
            <li>👥 Multi-level seller hierarchy</li>
            <li>💰 Price management and checking</li>
            <li>⏰ Time-based entry restrictions</li>
            <li>📊 Admin dashboard and reports</li>
          </ul>
        </div>
        <div style={{ marginTop: '30px' }}>
          <p style={{ fontSize: '14px', color: '#999' }}>
            Default Admin Credentials: admin / admin123
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;
