import React, { useEffect, useRef, useState } from 'react';
import { userService } from '../services/api';

const PasswordSettingsMenu = ({ currentUser, onSuccess, onError }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [childUsers, setChildUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef(null);

  const childRoleLabel = currentUser?.role === 'admin' ? 'stokist' : 'sub stokist';
  const menuLabel = currentUser?.role === 'admin' ? 'Stokist Password Change' : 'Sub Stokist Password Change';

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const resetForm = () => {
    setSelectedUserId('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const loadChildUsers = async () => {
    setLoadingChildren(true);
    onError('');

    try {
      const response = await userService.getChildSellers();
      const loginUsers = (response.data || []).filter((user) => user.canLogin !== false);
      setChildUsers(loginUsers);
      if (loginUsers.length > 0) {
        setSelectedUserId(String(loginUsers[0].id));
      }
    } catch (err) {
      onError(err.response?.data?.message || `Error loading ${childRoleLabel} list`);
    } finally {
      setLoadingChildren(false);
    }
  };

  const openPasswordModal = async () => {
    setMenuOpen(false);
    setModalOpen(true);
    resetForm();
    await loadChildUsers();
  };

  const closePasswordModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    onError('');
    onSuccess('');

    if (!selectedUserId) {
      onError(`Please select a ${childRoleLabel} first`);
      return;
    }

    if (newPassword.length < 8) {
      onError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      onError('New password and confirm password must match');
      return;
    }

    setSaving(true);

    try {
      const response = await userService.changeChildPassword(selectedUserId, newPassword);
      onSuccess(response.data?.message || 'Password updated successfully');
      closePasswordModal();
    } catch (err) {
      onError(err.response?.data?.message || 'Error updating password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="settings-menu-wrapper" ref={wrapperRef}>
        <button
          type="button"
          className="settings-icon-btn"
          onClick={() => setMenuOpen((current) => !current)}
          aria-label="Open settings"
          aria-expanded={menuOpen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94a7.96 7.96 0 0 0 .05-.94 7.96 7.96 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.48.48 0 0 0-.49-.42h-3.84a.48.48 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.96 7.96 0 0 0-.05.94c0 .32.02.63.05.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.48.48 0 0 0 .49.42h3.84a.48.48 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.56ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
          </svg>
        </button>

        {menuOpen && (
          <div className="settings-dropdown">
            <button type="button" className="settings-dropdown-item" onClick={openPasswordModal}>
              {menuLabel}
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="settings-modal-overlay" onClick={closePasswordModal}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-header">
              <div>
                <h3>Change {childRoleLabel} Password</h3>
                <p>{currentUser?.role === 'admin' ? 'Admin apne direct stokist ka password change kar sakta hai.' : 'Stokist apne direct sub stokist ka password change kar sakta hai.'}</p>
              </div>
              <button type="button" className="settings-close-btn" onClick={closePasswordModal} aria-label="Close settings">
                x
              </button>
            </div>

            <form onSubmit={handleSubmit} className="settings-form">
              <div className="form-group">
                <label>Select {childRoleLabel}:</label>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  disabled={loadingChildren || childUsers.length === 0}
                >
                  {childUsers.length === 0 ? (
                    <option value="">{loadingChildren ? 'Loading...' : `No ${childRoleLabel} login found`}</option>
                  ) : (
                    childUsers.map((childUser) => (
                      <option key={childUser.id} value={childUser.id}>
                        {childUser.username}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="form-group">
                <label>New Password:</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength="8"
                  placeholder="Minimum 8 characters"
                  required
                />
              </div>

              <div className="form-group">
                <label>Confirm Password:</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength="8"
                  placeholder="Re-enter password"
                  required
                />
              </div>

              <div className="settings-modal-actions">
                <button type="button" className="settings-cancel-btn" onClick={closePasswordModal}>
                  Cancel
                </button>
                <button type="submit" disabled={saving || loadingChildren || childUsers.length === 0}>
                  {saving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default PasswordSettingsMenu;
