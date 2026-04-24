import React, { useEffect, useState } from 'react';
import { userService } from '../services/api';
import '../styles/AdminDashboard.css';

const SuperAdminDashboard = ({ user, onLogout }) => {
  const [admins, setAdmins] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadAdmins = async () => {
    setListLoading(true);
    try {
      const response = await userService.getAdmins();
      setAdmins(response.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Admin list load nahi ho payi');
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const handleCreateAdmin = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Admin username required');
      return;
    }

    if (password.length < 8) {
      setError('Password minimum 8 characters hona chahiye');
      return;
    }

    setLoading(true);
    try {
      await userService.createAdmin(trimmedUsername, password);
      setUsername('');
      setPassword('');
      setSuccess(`${trimmedUsername} admin ID ban gaya`);
      await loadAdmins();
    } catch (err) {
      setError(err.response?.data?.message || 'Admin create nahi ho paya');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Super Admin</h1>
          <p>Logged in as {user?.username}</p>
        </div>
        <button className="logout-btn" type="button" onClick={onLogout}>Logout</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="accordion-item">
        <button className="accordion-header active" type="button">
          Create Admin ID
        </button>
        <div className="accordion-content">
          <form onSubmit={handleCreateAdmin} className="upload-form">
            <div className="form-group">
              <label>Admin Username:</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength="8"
                required
              />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Admin'}
            </button>
          </form>
        </div>
      </div>

      <div className="entries-list-block">
        <h2>Admin IDs</h2>
        {listLoading ? (
          <p>Loading...</p>
        ) : (
          <table className="entries-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Username</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {admins.length > 0 ? (
                admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>{admin.id}</td>
                    <td>{admin.username}</td>
                    <td>{admin.createdAt ? new Date(admin.createdAt).toLocaleString('en-IN') : '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3">Abhi koi admin ID nahi hai</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
