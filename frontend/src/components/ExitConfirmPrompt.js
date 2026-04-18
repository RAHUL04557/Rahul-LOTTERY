import React, { useEffect, useRef } from 'react';

const ExitConfirmPrompt = ({
  open,
  selected = 'no',
  message = 'Are you sure want to exit?',
  onSelectedChange,
  onConfirm,
  onCancel
}) => {
  const yesButtonRef = useRef(null);
  const noButtonRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    window.requestAnimationFrame(() => {
      const button = selected === 'yes' ? yesButtonRef.current : noButtonRef.current;
      button?.focus();
    });

    const handleKeyDown = (event) => {
      const key = String(event.key || '').toUpperCase();

      if (!['ARROWLEFT', 'ARROWRIGHT', 'ENTER', 'ESCAPE'].includes(key)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (key === 'ARROWLEFT' || key === 'ARROWRIGHT') {
        onSelectedChange?.(selected === 'yes' ? 'no' : 'yes');
        return;
      }

      if (key === 'ENTER') {
        if (selected === 'yes') {
          onConfirm?.();
        } else {
          onCancel?.();
        }
        return;
      }

      if (key === 'ESCAPE') {
        onCancel?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, selected, onSelectedChange, onConfirm, onCancel]);

  const handleButtonKeyDown = (event, buttonValue) => {
    const key = String(event.key || '').toUpperCase();

    if (key !== 'ENTER') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (buttonValue === 'yes') {
      onConfirm?.();
      return;
    }

    onCancel?.();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="exit-confirm-overlay" role="dialog" aria-modal="true" aria-label="Exit confirmation">
      <div className="exit-confirm-bar">
        <strong>{message}</strong>
        <div className="exit-confirm-actions">
          <button
            ref={yesButtonRef}
            type="button"
            className={selected === 'yes' ? 'active' : ''}
            onMouseEnter={() => onSelectedChange?.('yes')}
            onFocus={() => onSelectedChange?.('yes')}
            onKeyDown={(event) => handleButtonKeyDown(event, 'yes')}
            onClick={onConfirm}
          >
            Yes
          </button>
          <button
            ref={noButtonRef}
            type="button"
            className={selected === 'no' ? 'active' : ''}
            onMouseEnter={() => onSelectedChange?.('no')}
            onFocus={() => onSelectedChange?.('no')}
            onKeyDown={(event) => handleButtonKeyDown(event, 'no')}
            onClick={onCancel}
          >
            No
          </button>
        </div>
        <span>Arrow se Yes/No select karo, Enter dabao.</span>
      </div>
    </div>
  );
};

export default ExitConfirmPrompt;
