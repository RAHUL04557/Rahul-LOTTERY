import React from 'react';
import '../styles/RetroPurchasePanel.css';

const DEFAULT_SHORTCUTS = [
  'F2-Save',
  'F3-Show',
  'F5-Delete',
  'F6-Change Date',
  'F7-Search',
  'F8-Clear',
  'F9-Sub Total',
  'F12-Exit'
];

const DEFAULT_GRID_COLUMNS = [
  { key: 'serial', label: 'Sr No.' },
  { key: 'code', label: 'Code' },
  { key: 'itemName', label: 'Item Name' },
  { key: 'drawDate', label: 'Draw Date' },
  { key: 'day', label: 'Day' },
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'rate', label: 'Rate' },
  { key: 'amount', label: 'Amount' }
];

const getDisplayDay = (dateValue) => {
  if (!dateValue) {
    return '';
  }

  const normalized = String(dateValue).trim();
  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = isoDateMatch
    ? new Date(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]))
    : new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
};

const PLACEHOLDER_ROW_COUNT = 10;
const MEMO_PLACEHOLDER_ROW_COUNT = 12;

const createPlaceholderRows = (count) => Array.from({ length: count }, (_, index) => ({
  id: `placeholder-${index}`
}));

const formatGridRows = (entries = []) => entries.map((entry, index) => {
  const numberValue = String(entry.number ?? '');
  const normalizedFrom = numberValue ? numberValue.slice(0, Math.max(numberValue.length - 1, 0)) : '';
  const normalizedTo = numberValue ? numberValue.slice(-1) : '';
  const rate = Number(entry.sem || entry.boxValue || 0);
  const quantity = Number(entry.amount || 0);

  return {
    id: entry.id || `${entry.uniqueCode || entry.number || index}-${index}`,
    serial: index + 1,
    code: entry.uniqueCode || '',
    itemName: entry.displaySeller || entry.username || entry.status || '',
    drawDate: entry.bookingDate || '',
    day: getDisplayDay(entry.bookingDate),
    prefix: entry.sem || entry.boxValue || '',
    series: entry.sessionMode || '',
    from: normalizedFrom,
    to: normalizedTo,
    quantity: quantity || '',
    rate: rate || '',
    amount: rate && quantity ? (rate * quantity).toFixed(2) : ''
  };
});

const isStockLookupWarning = (warning) => {
  const title = String(warning?.title || '').toUpperCase();
  return title.startsWith('F4') && title.includes('STOCK');
};

const renderStockLookupDetails = (details = []) => {
  const summaryRows = details.filter((detail) => (
    String(detail || '').startsWith('Filter:')
    || String(detail || '').startsWith('Total Numbers:')
    || String(detail || '').startsWith('+')
  ));
  const stockRows = details.filter((detail) => !summaryRows.includes(detail));

  return (
    <>
      {summaryRows.length > 0 ? (
        <div className="retro-stock-summary">
          {summaryRows.map((detail, index) => (
            <div key={`${detail}-${index}`}>{detail}</div>
          ))}
        </div>
      ) : null}
      {stockRows.length > 0 ? (
        <div className="retro-stock-table-wrap">
          <table className="retro-stock-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>SEM</th>
                <th>Range</th>
                <th>Nos</th>
                <th>Piece</th>
                <th>Seller</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((detail, index) => {
                const cells = String(detail || '').split('|').map((cell) => cell.trim());
                return (
                  <tr key={`${detail}-${index}`}>
                    <td>{cells[0] || '-'}</td>
                    <td className="retro-stock-sem">{cells[1] || '-'}</td>
                    <td>{cells[2] || '-'}</td>
                    <td>{String(cells[3] || '-').replace(/^Nos\s+/i, '')}</td>
                    <td>{String(cells[4] || '-').replace(/^Piece\s+/i, '')}</td>
                    <td>{cells[5] || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
};

const RetroPurchasePanel = ({
  screenCode,
  screenTitle,
  panelTitle = '',
  headerTimestamp,
  memoNumber,
  formId,
  onSubmit,
  formRows = [],
  entries = [],
  gridRows = null,
  editableRow = null,
  editableRowIndex = null,
  activeGridRowIndex = null,
  onGridRowClick = null,
  footerActions = [],
  topShortcuts = DEFAULT_SHORTCUTS,
  summaryQuantity = 0,
  summaryAmount = 0,
  gridColumns = DEFAULT_GRID_COLUMNS,
  statusLabel = '',
  showShortcuts = true,
  showStatusField = true,
  showGrid = true,
  showFooter = true,
  windowClassName = '',
  memoProps = {},
  memoSelector = null,
  blockingWarning = null,
  onBlockingWarningClose = null
}) => {
  const formattedRows = Array.isArray(gridRows) ? gridRows : formatGridRows(entries);
  const stockLookupWarning = isStockLookupWarning(blockingWarning);
  const placeholderRows = createPlaceholderRows(
    Math.max(PLACEHOLDER_ROW_COUNT - formattedRows.length - (editableRow ? 1 : 0), 0)
  );
  const normalizedEditableRowIndex = editableRow
    ? Math.min(Math.max(Number(editableRowIndex ?? formattedRows.length), 0), formattedRows.length)
    : null;
  const getShortcutAction = (shortcut) => {
    const shortcutKey = String(shortcut || '').split('-')[0].trim().toUpperCase();
    if (!shortcutKey) {
      return null;
    }

    return footerActions.find((action) => String(action.shortcut || '').toUpperCase() === shortcutKey)
      || footerActions.find((action) => String(action.label || '').toUpperCase().includes(shortcutKey))
      || null;
  };

  return (
    <div className="retro-purchase-shell">
      {formId && onSubmit ? <form id={formId} onSubmit={onSubmit} className="retro-purchase-hidden-form" /> : null}
      <div className={`retro-purchase-window ${windowClassName} ${blockingWarning ? 'warning-active' : ''}`.trim()}>
        <div className="retro-purchase-titlebar">
          <span>{screenCode}</span>
          <strong>{screenTitle}</strong>
          <span>{headerTimestamp}</span>
        </div>

        {showShortcuts && topShortcuts.length > 0 ? (
          <div className="retro-purchase-shortcuts">
            {panelTitle ? <strong className="retro-purchase-panel-title">{panelTitle}</strong> : null}
            {topShortcuts.map((shortcut) => {
              const shortcutAction = getShortcutAction(shortcut);

              return shortcutAction ? (
                <button
                  key={shortcut}
                  type="button"
                  className="retro-purchase-shortcut-btn"
                  onClick={shortcutAction.onClick}
                  disabled={shortcutAction.disabled}
                >
                  {shortcut}
                </button>
              ) : (
                <span key={shortcut}>{shortcut}</span>
              );
            })}
          </div>
        ) : null}

        <div className="retro-purchase-body">
          <div className="retro-purchase-formbar">
            {formRows.map((row) => (
              <div key={row.label} className={`retro-purchase-field ${row.className || ''}`}>
                <label>{row.label}</label>
                <div className="retro-purchase-field-control">
                  {row.content}
                </div>
              </div>
            ))}

            {showStatusField ? (
              <div className="retro-purchase-field retro-purchase-field-checkbox">
                <label>Status</label>
                <div className="retro-purchase-field-control">
                  <span className="retro-purchase-status-indicator" />
                  <span>{statusLabel || 'READY'}</span>
                </div>
              </div>
            ) : null}

            <div className="retro-purchase-field retro-purchase-field-memo">
              <label>Memo No.</label>
              <div className="retro-purchase-memo-shell">
                <div className="retro-purchase-field-control retro-purchase-readonly" {...memoProps}>
                  {memoNumber || ''}
                </div>
                {memoSelector?.isOpen ? (
                  <div className={`retro-purchase-memo-popup ${memoSelector.className || ''}`.trim()}>
                    {memoSelector.variant === 'table' ? (
                      <div className="retro-purchase-memo-table-wrap">
                        <table className="retro-purchase-memo-table">
                          <thead>
                            <tr>
                              <th>Memo No</th>
                              <th>Draw Date</th>
                              <th>Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(memoSelector.options || []).map((option, index) => (
                              <tr
                                key={option.key || option.memoNumber || index}
                                className={index === memoSelector.activeIndex ? 'active' : ''}
                                onMouseEnter={() => memoSelector.onHighlight?.(index)}
                                onClick={() => memoSelector.onSelect?.(option, index)}
                              >
                                <td>{option.label ?? ''}</td>
                                <td>{option.drawDate ?? ''}</td>
                                <td>{option.quantity ?? ''}</td>
                              </tr>
                            ))}
                            {Array.from({
                              length: Math.max(MEMO_PLACEHOLDER_ROW_COUNT - (memoSelector.options || []).length, 0)
                            }, (_, index) => (
                              <tr key={`memo-empty-${index}`}>
                                <td>&nbsp;</td>
                                <td>&nbsp;</td>
                                <td>&nbsp;</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan="2">Total Qty</td>
                              <td>
                                {(memoSelector.options || []).reduce((sum, option) => sum + Number(option.quantity || 0), 0)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <>
                        <div className="retro-purchase-memo-list">
                          {(memoSelector.options || []).map((option, index) => (
                            <button
                              key={option.key || option.memoNumber || index}
                              type="button"
                              className={`retro-purchase-memo-option ${index === memoSelector.activeIndex ? 'active' : ''}`.trim()}
                              onMouseEnter={() => memoSelector.onHighlight?.(index)}
                              onClick={() => memoSelector.onSelect?.(option, index)}
                            >
                              <span>{option.label}</span>
                              {option.totalPieceCount ? <strong>{option.totalPieceCount}</strong> : null}
                            </button>
                          ))}
                        </div>
                        <div className="retro-purchase-memo-details">
                          {memoSelector.detailContent}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {showGrid ? (
            <div className="retro-purchase-grid">
              <table>
                <thead>
                  <tr>
                    {gridColumns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {formattedRows.map((row, index) => (
                    <React.Fragment key={row.id}>
                      {editableRow && normalizedEditableRowIndex === index ? editableRow : (
                        <tr
                          className={activeGridRowIndex === index ? 'retro-purchase-grid-row-active' : ''}
                          onClick={() => onGridRowClick?.(row, index)}
                        >
                          {gridColumns.map((column) => (
                            <td key={`${row.id}-${column.key}`}>{row[column.key] ?? ''}</td>
                          ))}
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {editableRow && normalizedEditableRowIndex === formattedRows.length ? editableRow : null}
                  {placeholderRows.map((row) => (
                    <tr key={row.id}>
                      {gridColumns.map((column) => (
                        <td key={`${row.id}-${column.key}`}>{row[column.key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {showFooter ? (
            <div className="retro-purchase-footer">
              <div className="retro-purchase-summary">
                <span>Item Qty : <strong>{summaryQuantity}</strong></span>
                <span>Item Amt. : <strong>{Number(summaryAmount || 0).toFixed(2)}</strong></span>
              </div>

              <div className="retro-purchase-actionbar">
                {footerActions.map((action) => (
                  <button
                    key={action.label}
                    type={action.type || 'button'}
                    form={action.form}
                    className={`retro-purchase-action ${action.variant || ''}`.trim()}
                    onClick={action.onClick}
                    disabled={action.disabled}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {blockingWarning ? (
          <div className={`retro-purchase-warning-overlay ${stockLookupWarning ? 'stock-lookup' : ''}`.trim()}>
            <div className={`retro-purchase-warning-bar ${stockLookupWarning ? 'stock-lookup' : ''}`.trim()}>
              <button
                type="button"
                className="retro-purchase-warning-hint"
                onClick={onBlockingWarningClose}
              >
                Press Esc or click here to continue
              </button>
              <div className="retro-purchase-warning-content">
                {blockingWarning.title ? <strong>{blockingWarning.title}</strong> : null}
                {blockingWarning.message ? <p>{blockingWarning.message}</p> : null}
                {stockLookupWarning
                  ? renderStockLookupDetails(blockingWarning.details || [])
                  : (blockingWarning.details || []).map((detail, index) => (
                    <p key={`${detail}-${index}`}>{detail}</p>
                  ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default RetroPurchasePanel;
