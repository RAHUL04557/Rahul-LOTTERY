import React, { useEffect, useMemo, useState } from 'react';
import ExitConfirmPrompt from './ExitConfirmPrompt';
import '../styles/DashboardLauncher.css';

const LETTER_SLOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const isEditableTarget = (target) => {
  if (!target) {
    return false;
  }

  const tagName = String(target.tagName || '').toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
};

const DashboardLauncher = ({
  title,
  subtitle,
  items = [],
  actions = [],
  onSelect,
  onAction,
  onExit
}) => {
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState('no');

  const slots = useMemo(() => {
    const usedItems = new Set();
    const explicitItemsByLetter = new Map();

    items.forEach((item) => {
      const letter = String(item?.shortcutLetter || '').trim().toUpperCase();
      if (/^[A-Z]$/.test(letter) && !explicitItemsByLetter.has(letter)) {
        explicitItemsByLetter.set(letter, item);
        usedItems.add(item);
      }
    });

    const remainingItems = items.filter((item) => !usedItems.has(item));
    let remainingIndex = 0;

    return LETTER_SLOTS.map((letter) => {
      const explicitItem = explicitItemsByLetter.get(letter);
      if (explicitItem) {
        return { letter, item: explicitItem };
      }

      const nextItem = remainingItems[remainingIndex] || null;
      remainingIndex += nextItem ? 1 : 0;
      return { letter, item: nextItem };
    });
  }, [items]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }

      const pressedLetter = String(event.key || '').toUpperCase();
      if (!/^[A-Z]$/.test(pressedLetter)) {
        if (pressedLetter === 'ESCAPE') {
          event.preventDefault();
          setExitConfirmSelected('no');
          setExitConfirmOpen(true);
        }
        return;
      }

      const selectedSlot = slots.find((slot) => slot.letter === pressedLetter);
      if (!selectedSlot?.item) {
        return;
      }

      event.preventDefault();
      onSelect?.(selectedSlot.item);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit, onSelect, slots]);

  const leftColumn = slots.slice(0, 13);
  const rightColumn = slots.slice(13);

  const renderColumn = (columnSlots) => (
    <div className="dashboard-launcher-column">
      {columnSlots.map((slot) => (
        <button
          key={slot.letter}
          type="button"
          className={`dashboard-launcher-item ${slot.item ? '' : 'unassigned'}`.trim()}
          onClick={() => slot.item && onSelect?.(slot.item)}
          disabled={!slot.item}
        >
          <span className="dashboard-launcher-letter">{slot.letter}</span>
          <span className="dashboard-launcher-label">{slot.item?.label || 'Not Assigned'}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="dashboard-launcher-shell">
      <ExitConfirmPrompt
        open={exitConfirmOpen}
        selected={exitConfirmSelected}
        onSelectedChange={setExitConfirmSelected}
        onConfirm={() => {
          setExitConfirmOpen(false);
          setExitConfirmSelected('no');
          onExit?.();
        }}
        onCancel={() => {
          setExitConfirmOpen(false);
          setExitConfirmSelected('no');
        }}
      />

      <div className="dashboard-launcher-window">
        <div className="dashboard-launcher-titlebar">
          <span className="dashboard-launcher-brand">RAHUL</span>
          <strong>{title}</strong>
          <span className="dashboard-launcher-hint">Press A-Z</span>
        </div>

        <div className="dashboard-launcher-stage">
          <div className="dashboard-launcher-canvas">
            {actions.length > 0 && (
              <div className="dashboard-launcher-actions">
                {actions.map((action) => (
                  <button
                    key={action.id || action.label}
                    type="button"
                    className="dashboard-launcher-action"
                    onClick={() => onAction?.(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-launcher-menu">
            <div className="dashboard-launcher-menu-grid">
              {renderColumn(leftColumn)}
              {renderColumn(rightColumn)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardLauncher;
