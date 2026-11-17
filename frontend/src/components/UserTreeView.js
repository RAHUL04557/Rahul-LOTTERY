import React, { useState } from 'react';

const SELLER_TYPE_LABELS = {
  seller: 'STOKIST',
  sub_seller: 'SUB STOKIST',
  normal_seller: 'SELLER'
};

const TreeNode = ({ node, onDelete, deletingUserId, onEditRate, editingRateUserId, shouldShowNode }) => {
  if (!node) {
    return null;
  }

  const visibleChildren = (node.children || []).filter((child) => (
    typeof shouldShowNode === 'function' ? shouldShowNode(child) : true
  ));

  return (
    <li className="tree-node">
      <div className="tree-card">
        <div className="tree-title-row">
          <strong>{node.username}{node.keyword ? ` [${node.keyword}]` : ''}</strong>
          <div className="tree-actions">
            <span className="tree-role">
              {node.role === 'seller'
                ? `${SELLER_TYPE_LABELS[node.sellerType] || 'SELLER'}${node.canLogin === false ? ' / NO LOGIN' : ''}`
                : String(node.role || '').toUpperCase()}
            </span>
            {node.canEditRate && onEditRate && (
              <button
                type="button"
                className="tree-edit-rate-btn"
                onClick={() => onEditRate(node)}
                disabled={editingRateUserId === node.id}
              >
                {editingRateUserId === node.id ? 'Saving...' : 'Edit Rate'}
              </button>
            )}
            {node.canDelete && onDelete && (
              <button
                type="button"
                className="tree-delete-btn"
                onClick={() => onDelete(node)}
                disabled={deletingUserId === node.id}
              >
                {deletingUserId === node.id ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
        </div>
        <div className="tree-meta">
          <span>Direct: {node.directChildrenCount || 0}</span>
          <span>Total Downline: {node.totalDescendants || 0}</span>
          <span>Rate 7: {Number(node.rateAmount6 || 0)}</span>
          <span>Rate 12: {Number(node.rateAmount12 || 0)}</span>
        </div>
      </div>
      {visibleChildren.length > 0 && (
        <ul className="tree-children">
          {visibleChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              onDelete={onDelete}
              deletingUserId={deletingUserId}
              onEditRate={onEditRate}
              editingRateUserId={editingRateUserId}
              shouldShowNode={shouldShowNode}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

const UserTreeView = ({ treeData, emptyMessage, onDelete, deletingUserId, onEditRate, editingRateUserId, shouldShowNode }) => {
  const [editingNode, setEditingNode] = useState(null);
  const [rateAmount6, setRateAmount6] = useState('');
  const [rateAmount12, setRateAmount12] = useState('');

  if (!treeData) {
    return <p>{emptyMessage || 'No tree data found'}</p>;
  }

  const openRateEditor = (node) => {
    setEditingNode(node);
    setRateAmount6(String(node.rateAmount6 ?? 0));
    setRateAmount12(String(node.rateAmount12 ?? 0));
  };

  const closeRateEditor = () => {
    if (editingRateUserId) {
      return;
    }
    setEditingNode(null);
  };

  const saveRates = async (event) => {
    event.preventDefault();
    if (!editingNode || !onEditRate) {
      return;
    }

    try {
      await onEditRate(editingNode, {
        rateAmount6,
        rateAmount12
      });
      setEditingNode(null);
    } catch (error) {
      // The parent dashboard shows the server/local validation message.
    }
  };

  return (
    <div className="tree-wrapper">
      <ul className="tree-root">
        <TreeNode
          node={treeData}
          onDelete={onDelete}
          deletingUserId={deletingUserId}
          onEditRate={onEditRate ? openRateEditor : null}
          editingRateUserId={editingRateUserId}
          shouldShowNode={shouldShowNode}
        />
      </ul>
      {editingNode && (
        <form className="tree-rate-editor" onSubmit={saveRates}>
          <strong>Edit rate: {editingNode.username}</strong>
          <label>
            Rate 7
            <input
              type="number"
              min="0"
              step="0.01"
              value={rateAmount6}
              onChange={(event) => setRateAmount6(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Rate 12
            <input
              type="number"
              min="0"
              step="0.01"
              value={rateAmount12}
              onChange={(event) => setRateAmount12(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={editingRateUserId === editingNode.id}>
            {editingRateUserId === editingNode.id ? 'Saving...' : 'Save Rate'}
          </button>
          <button type="button" className="tree-rate-cancel-btn" onClick={closeRateEditor} disabled={Boolean(editingRateUserId)}>
            Cancel
          </button>
          <span>Bill latest saved rate se calculate hoga.</span>
        </form>
      )}
    </div>
  );
};

export default UserTreeView;
