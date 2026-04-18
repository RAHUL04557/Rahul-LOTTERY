import { useEffect } from 'react';

const normalizeKey = (event) => String(event.key || '').toUpperCase();

const isEditableTarget = (target) => {
  if (!target) {
    return false;
  }

  const tagName = String(target.tagName || '').toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
};

export const useFunctionShortcuts = (enabled, handlers = {}) => {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      const key = normalizeKey(event);
      const handler = handlers[key];

      if (!handler) {
        return;
      }

      if (isEditableTarget(event.target) && !key.startsWith('F') && key !== 'ESCAPE') {
        return;
      }

      if (isEditableTarget(event.target) || key.startsWith('F') || key === 'ESCAPE') {
        event.preventDefault();
      }

      handler(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handlers]);
};
