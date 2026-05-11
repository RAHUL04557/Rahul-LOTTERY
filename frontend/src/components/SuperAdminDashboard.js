import React, { useEffect, useState } from 'react';
import { userService } from '../services/api';
import '../styles/AdminDashboard.css';

const SuperAdminDashboard = ({ user, onLogout }) => {
  const [admins, setAdmins] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resultUploadPassword, setResultUploadPassword] = useState('rahul@9749');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [passwordInputs, setPasswordInputs] = useState({});
  const [resultUploadPasswordInputs, setResultUploadPasswordInputs] = useState({});
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

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onLogout?.();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onLogout]);

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

    if (resultUploadPassword.length < 8) {
      setError('Result upload password minimum 8 characters hona chahiye');
      return;
    }

    setLoading(true);
    try {
      await userService.createAdmin(trimmedUsername, password, resultUploadPassword);
      setUsername('');
      setPassword('');
      setResultUploadPassword('rahul@9749');
      setSuccess(`${trimmedUsername} admin ID ban gaya`);
      await loadAdmins();
    } catch (err) {
      setError(err.response?.data?.message || 'Admin create nahi ho paya');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAdmin = async (admin) => {
    setError('');
    setSuccess('');
    const confirmed = window.confirm(`${admin.username} admin delete karna hai? Is admin ke niche ke sellers bhi delete ho jayenge.`);
    if (!confirmed) {
      return;
    }

    setActionLoadingId(`delete-${admin.id}`);
    try {
      await userService.deleteAdmin(admin.id);
      setSuccess(`${admin.username} admin delete ho gaya`);
      await loadAdmins();
    } catch (err) {
      setError(err.response?.data?.message || 'Admin delete nahi ho paya');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleChangeAdminPassword = async (admin) => {
    setError('');
    setSuccess('');
    const newPassword = passwordInputs[admin.id] || '';
    if (newPassword.length < 8) {
      setError('Password minimum 8 characters hona chahiye');
      return;
    }

    setActionLoadingId(`password-${admin.id}`);
    try {
      await userService.changeAdminPassword(admin.id, newPassword);
      setPasswordInputs((current) => ({ ...current, [admin.id]: '' }));
      setSuccess(`${admin.username} ka password change ho gaya`);
    } catch (err) {
      setError(err.response?.data?.message || 'Password change nahi ho paya');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleChangeResultUploadPassword = async (admin) => {
    setError('');
    setSuccess('');
    const newPassword = resultUploadPasswordInputs[admin.id] || '';
    if (newPassword.length < 8) {
      setError('Result upload password minimum 8 characters hona chahiye');
      return;
    }

    setActionLoadingId(`result-upload-password-${admin.id}`);
    try {
      await userService.changeAdminResultUploadPassword(admin.id, newPassword);
      setResultUploadPasswordInputs((current) => ({ ...current, [admin.id]: '' }));
      setSuccess(`${admin.username} ka result upload password change ho gaya`);
    } catch (err) {
      setError(err.response?.data?.message || 'Result upload password change nahi ho paya');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Super Admin</h1>
          <p>Logged in as {user?.username}</p>
        </div>
        <button className="logout-btn" type="button" onClick={onLogout}>Exit (Esc)</button>
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
            <div className="form-group">
              <label>Result Upload Password:</label>
              <input
                type="password"
                value={resultUploadPassword}
                onChange={(event) => setResultUploadPassword(event.target.value)}
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
                <th>Change Password</th>
                <th>Result Upload Password</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {admins.length > 0 ? (
                admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>{admin.id}</td>
                    <td>{admin.username}</td>
                    <td>{admin.createdAt ? new Date(admin.createdAt).toLocaleString('en-IN') : '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          value={passwordInputs[admin.id] || ''}
                          onChange={(event) => setPasswordInputs((current) => ({
                            ...current,
                            [admin.id]: event.target.value
                          }))}
                          minLength="8"
                          placeholder="New password"
                          style={{ minWidth: '180px' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleChangeAdminPassword(admin)}
                          disabled={actionLoadingId === `password-${admin.id}`}
                        >
                          {actionLoadingId === `password-${admin.id}` ? 'Saving...' : 'Change'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          value={resultUploadPasswordInputs[admin.id] || ''}
                          onChange={(event) => setResultUploadPasswordInputs((current) => ({
                            ...current,
                            [admin.id]: event.target.value
                          }))}
                          minLength="8"
                          placeholder="Result upload password"
                          style={{ minWidth: '210px' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleChangeResultUploadPassword(admin)}
                          disabled={actionLoadingId === `result-upload-password-${admin.id}`}
                        >
                          {actionLoadingId === `result-upload-password-${admin.id}` ? 'Saving...' : 'Change'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeleteAdmin(admin)}
                        disabled={actionLoadingId === `delete-${admin.id}`}
                        style={{ backgroundColor: '#c53030' }}
                      >
                        {actionLoadingId === `delete-${admin.id}` ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6">Abhi koi admin ID nahi hai</td>
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
