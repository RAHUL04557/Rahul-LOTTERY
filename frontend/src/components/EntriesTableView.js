import React from 'react';
import { getConsecutiveNumberCellMeta, groupConsecutiveNumberRows, sortRowsForConsecutiveNumbers } from '../utils/numberRanges';
import { formatDisplayDate } from '../utils/transferBill';

const getStatusClassName = (status) => {
  if (status === 'accepted') {
    return 'entry-status entry-status-accepted';
  }

  return 'entry-status entry-status-pending';
};

const EntriesTableView = ({
  entries,
  emptyMessage,
  showSeller = false,
  title,
  showStatus = false,
  actionMode = '',
  onAccept,
  onReject,
  actionLoadingId,
  splitByAmount = false,
  groupConsecutiveRows = false,
  showSummary = false
}) => {
  if (!entries || entries.length === 0) {
    return <p>{emptyMessage || 'No entries found'}</p>;
  }

  const renderTable = (tableEntries, tableTitle) => {
    const getRowSignature = (entry) => [
      showSeller ? (entry.displaySeller || entry.username || '-') : '',
      entry.sem,
      entry.amount,
      entry.status || '',
      actionMode
    ].join('|');
    const sortedTableEntries = sortRowsForConsecutiveNumbers(
      tableEntries,
      (entry) => [
        showSeller ? (entry.displaySeller || entry.username || '-') : '',
        entry.sem,
        entry.amount,
        entry.status || '',
        actionMode
      ]
    );
    const totalPiece = sortedTableEntries.reduce((sum, entry) => sum + Number(entry.sem || 0), 0);
    const totalAmount = sortedTableEntries.reduce((sum, entry) => sum + Number(entry.price || 0), 0);
    const bookingDates = [...new Set(
      sortedTableEntries
        .map((entry) => entry.bookingDate)
        .filter(Boolean)
    )];
    const bookingDateLabel = bookingDates.length === 1
      ? formatDisplayDate(bookingDates[0])
      : bookingDates.length > 1
        ? bookingDates.map((date) => formatDisplayDate(date)).join(', ')
        : '-';

    if (actionMode === 'seller-review' || groupConsecutiveRows) {
      const groupedEntries = groupConsecutiveNumberRows(sortedTableEntries, getRowSignature);

      return (
        <div className="entries-list-block" style={{ marginTop: tableTitle && !title ? '20px' : undefined }}>
          {tableTitle && <h3>{tableTitle}</h3>}
          {showSummary && (
            <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
              <strong>Booking Date:</strong> {bookingDateLabel} | <strong>Total Piece:</strong> {totalPiece.toFixed(2)} | <strong>Total Amount:</strong> Rs. {totalAmount.toFixed(2)}
            </div>
          )}
          <table className="entries-table">
            <thead>
              <tr>
                {showSeller && <th>Seller</th>}
                <th>Unique Code</th>
                <th>SEM</th>
                <th>Piece Count</th>
                <th>Amount</th>
                <th>5-Digit Number</th>
                <th>Total</th>
                {showStatus && <th>Status</th>}
                <th>Sent At</th>
                {actionMode === 'seller-review' && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {groupedEntries.map((group) => {
                const representativeEntry = group.firstRow;
                const groupedPieceCount = group.rows.reduce((sum, currentEntry) => sum + Number(currentEntry.sem || 0), 0);
                const totalAmount = group.rows.reduce((sum, currentEntry) => sum + Number(currentEntry.price || 0), 0);
                const uniqueCodeLabel = group.rows.length > 1
                  ? `${group.rows.length} codes`
                  : representativeEntry.uniqueCode;

                return (
                  <tr key={group.rows.map((currentEntry) => currentEntry.id || currentEntry._id).join('-')}>
                    {showSeller && <td>{representativeEntry.displaySeller || representativeEntry.username || '-'}</td>}
                    <td>{uniqueCodeLabel}</td>
                    <td>{representativeEntry.sem}</td>
                    <td>{groupedPieceCount}</td>
                    <td>{representativeEntry.amount}</td>
                    <td className="grouped-number-cell">{group.label}</td>
                    <td><strong>Rs. {totalAmount.toFixed(2)}</strong></td>
                    {showStatus && (
                      <td>
                        <span className={getStatusClassName(representativeEntry.status)}>
                          {representativeEntry.status || '-'}
                        </span>
                      </td>
                    )}
                    <td>{representativeEntry.sentAt ? new Date(representativeEntry.sentAt).toLocaleString('en-IN') : '-'}</td>
                    {actionMode === 'seller-review' && (
                      <td className="grouped-action-cell">
                        <div className="grouped-action-buttons">
                          <button
                            type="button"
                            onClick={() => onAccept && onAccept(group.rows)}
                            disabled={actionLoadingId === (group.rows[0]?.id || representativeEntry.id)}
                            style={{ padding: '8px 12px', backgroundColor: '#4caf50' }}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => onReject && onReject(group.rows)}
                            disabled={actionLoadingId === (group.rows[0]?.id || representativeEntry.id)}
                            style={{ padding: '8px 12px', backgroundColor: '#f44336' }}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            style={{
              marginTop: '16px',
              marginBottom: '8px',
              padding: '18px 22px',
              borderRadius: '16px',
              background: '#eef3ff',
              fontSize: '30px',
              fontWeight: '700',
              lineHeight: 1.45,
              color: '#1f2d3d',
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
            }}
          >
            <strong>Total Piece Count:</strong> {totalPiece.toFixed(2)}
          </div>
        </div>
      );
    }

    const numberCellMeta = getConsecutiveNumberCellMeta(sortedTableEntries, getRowSignature);

    return (
      <div className="entries-list-block" style={{ marginTop: tableTitle && !title ? '20px' : undefined }}>
        {tableTitle && <h3>{tableTitle}</h3>}
        {showSummary && (
          <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
            <strong>Booking Date:</strong> {bookingDateLabel} | <strong>Total Piece:</strong> {totalPiece.toFixed(2)} | <strong>Total Amount:</strong> Rs. {totalAmount.toFixed(2)}
          </div>
        )}
        <table className="entries-table">
          <thead>
            <tr>
              {showSeller && <th>Seller</th>}
              <th>Unique Code</th>
              <th>SEM</th>
              <th>Piece Count</th>
              <th>Amount</th>
              <th>5-Digit Number</th>
              <th>Total</th>
              {showStatus && <th>Status</th>}
              <th>Sent At</th>
              {actionMode === 'seller-review' && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {sortedTableEntries.map((entry, index) => (
              <tr key={`${entry.id || entry._id}-${entry.sentAt || entry.createdAt || entry.uniqueCode}`}>
                {showSeller && <td>{entry.displaySeller || entry.username || '-'}</td>}
                <td>{entry.uniqueCode}</td>
                <td>{entry.sem}</td>
                <td>{entry.sem}</td>
                <td>{entry.amount}</td>
                {numberCellMeta[index].showCell && (
                  <td
                    rowSpan={numberCellMeta[index].rowSpan}
                    className={numberCellMeta[index].rowSpan > 1 ? 'grouped-number-cell' : ''}
                  >
                    {numberCellMeta[index].label}
                  </td>
                )}
                <td><strong>Rs. {Number(entry.price || 0).toFixed(2)}</strong></td>
                {showStatus && (
                  <td>
                    <span className={getStatusClassName(entry.status)}>
                      {entry.status || '-'}
                    </span>
                  </td>
                )}
                <td>{entry.sentAt ? new Date(entry.sentAt).toLocaleString('en-IN') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div
          style={{
            marginTop: '16px',
            marginBottom: '8px',
            padding: '18px 22px',
            borderRadius: '16px',
            background: '#eef3ff',
            fontSize: '30px',
            fontWeight: '700',
            lineHeight: 1.45,
            color: '#1f2d3d',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
          }}
        >
          <strong>Total Piece Count:</strong> {totalPiece.toFixed(2)}
        </div>
      </div>
    );
  };

  if (!splitByAmount) {
    return (
      <div className="entries-list-block">
        {title && <h3>{title}</h3>}
        {renderTable(entries)}
      </div>
    );
  }

  const amount6Entries = entries.filter((entry) => String(entry.amount) === '7');
  const amount12Entries = entries.filter((entry) => String(entry.amount) === '12');
  const combinedPieceCount = [...amount6Entries, ...amount12Entries].reduce((sum, entry) => sum + Number(entry.sem || 0), 0);

  return (
    <div className="entries-list-block">
      {title && <h3>{title}</h3>}
      {amount6Entries.length > 0 && renderTable(amount6Entries, 'Amount 7')}
      {amount12Entries.length > 0 && renderTable(amount12Entries, 'Amount 12')}
      {(amount6Entries.length > 0 || amount12Entries.length > 0) && (
        <div
          style={{
            marginTop: '18px',
            marginBottom: '10px',
            padding: '20px 24px',
            borderRadius: '16px',
            background: '#dfe8ff',
            fontSize: '34px',
            fontWeight: '800',
            lineHeight: 1.4,
            color: '#1f2d3d',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
          }}
        >
          <strong>Grand Total Piece Count:</strong> {combinedPieceCount.toFixed(2)}
        </div>
      )}
      {amount6Entries.length === 0 && amount12Entries.length === 0 && <p>{emptyMessage || 'No entries found'}</p>}
    </div>
  );
};

export default EntriesTableView;
