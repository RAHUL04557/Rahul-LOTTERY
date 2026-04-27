import React from 'react';

const SELLER_TYPE_LABELS = {
  seller: 'STOKIST',
  sub_seller: 'SUB STOKIST',
  normal_seller: 'SELLER'
};

const TreeNode = ({ node, onDelete, deletingUserId }) => {
  if (!node) {
    return null;
  }

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
      {node.children && node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} onDelete={onDelete} deletingUserId={deletingUserId} />
          ))}
        </ul>
      )}
    </li>
  );
};

const UserTreeView = ({ treeData, emptyMessage, onDelete, deletingUserId }) => {
  if (!treeData) {
    return <p>{emptyMessage || 'No tree data found'}</p>;
  }

  return (
    <div className="tree-wrapper">
      <ul className="tree-root">
        <TreeNode node={treeData} onDelete={onDelete} deletingUserId={deletingUserId} />
      </ul>
    </div>
  );
};

export default UserTreeView;
