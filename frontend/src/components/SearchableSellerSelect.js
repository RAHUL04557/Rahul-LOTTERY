import React, { useEffect, useMemo, useRef, useState } from 'react';

const getNormalizedKeyword = (keyword = '', username = '') => {
  const explicitKeyword = String(keyword || '').trim().toUpperCase();
  if (explicitKeyword) {
    return explicitKeyword;
  }

  return String(username || '').trim().slice(0, 2).toUpperCase();
};

const SearchableSellerSelect = ({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select seller',
  getOptionValue = (option) => option?.id,
  getOptionLabel = (option) => option?.username || '',
  getOptionSearchLabel = null,
  inputRef = null,
  onEnter = null,
  disabled = false,
  required = false,
  form
}) => {
  const wrapperRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [advanceOnEnter, setAdvanceOnEnter] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => String(getOptionValue(option)) === String(value)) || null,
    [getOptionValue, options, value]
  );
  const selectedOptionLabel = useMemo(
    () => (selectedOption ? String(getOptionLabel(selectedOption) || '') : ''),
    [getOptionLabel, selectedOption]
  );
  const displayValue = isFocused ? query : (query || selectedOptionLabel);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toUpperCase();
    if (!normalizedQuery) {
      return showAllOptions ? options : [];
    }

    return [...options]
      .map((option) => {
        const optionKeyword = getNormalizedKeyword(option?.keyword, option?.username);
        const optionUsername = String(option?.username || '').trim().toUpperCase();
        const optionSearchText = (
          getOptionSearchLabel
            ? getOptionSearchLabel(option)
            : `${getNormalizedKeyword(option?.keyword, option?.username)} ${option?.username || ''} ${getOptionLabel(option)}`
        ).toUpperCase();
        let score = 0;

        if (optionKeyword === normalizedQuery) {
          score = 400;
        } else if (optionKeyword.startsWith(normalizedQuery)) {
          score = 300;
        } else if (optionUsername.startsWith(normalizedQuery)) {
          score = 200;
        } else if (optionSearchText.includes(normalizedQuery)) {
          score = 100;
        }

        return { option, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return String(getOptionLabel(left.option)).localeCompare(String(getOptionLabel(right.option)));
      })
      .map((entry) => entry.option);
  }, [getOptionLabel, getOptionSearchLabel, options, query, showAllOptions]);
  const dropdownMaxHeight = filteredOptions.length <= 6
    ? `${Math.max(filteredOptions.length, 1) * 54}px`
    : '320px';

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setShowAllOptions(false);
      setHighlightedIndex(-1);
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
      return;
    }

    setHighlightedIndex(String(query || '').trim() ? 0 : -1);
  }, [query, isOpen]);

  const focusNextControl = () => {
    const inputElement = wrapperRef.current?.querySelector('input');
    if (!(inputElement instanceof HTMLElement)) {
      return;
    }

    const root = inputElement.closest('[data-enter-navigation-root]') || document;
    const focusableElements = Array.from(root.querySelectorAll('input, select, textarea, button'))
      .filter((element) => (
        element instanceof HTMLElement
        && !element.disabled
        && element.tabIndex !== -1
        && element.offsetParent !== null
        && element.getAttribute('type') !== 'hidden'
      ));
    const currentIndex = focusableElements.indexOf(inputElement);
    const nextElement = currentIndex >= 0 ? focusableElements[currentIndex + 1] : null;

    if (nextElement instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        nextElement.focus();
        nextElement.select?.();
      });
    }
  };

  const commitSelection = (option, shouldMoveNext = false) => {
    if (!option) {
      return;
    }

    setQuery('');
    setIsOpen(false);
    setShowAllOptions(false);
    setIsFocused(false);
    setAdvanceOnEnter(!shouldMoveNext);
    onChange?.(option);

    if (shouldMoveNext) {
      if (onEnter) {
        onEnter(option);
      } else {
        focusNextControl();
      }
    }
  };

  const getBestQueryMatch = () => {
    const normalizedQuery = String(query || '').trim().toUpperCase();
    if (!normalizedQuery || filteredOptions.length === 0) {
      return null;
    }

    return filteredOptions.find((option) => (
      getNormalizedKeyword(option?.keyword, option?.username) === normalizedQuery
      || String(option?.username || '').trim().toUpperCase() === normalizedQuery
      || String(getOptionLabel(option) || '').trim().toUpperCase() === normalizedQuery
    )) || filteredOptions[0] || null;
  };

  const handleInputBlur = () => {
    window.setTimeout(() => {
      if (wrapperRef.current?.contains(document.activeElement)) {
        return;
      }

      const matchedOption = getBestQueryMatch();
      if (matchedOption) {
        commitSelection(matchedOption);
        return;
      }

      setIsOpen(false);
      setQuery('');
      setShowAllOptions(false);
      setIsFocused(false);
    }, 120);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={(node) => {
          if (!inputRef) {
            return;
          }
          if (typeof inputRef === 'function') {
            inputRef(node);
            return;
          }
          inputRef.current = node;
        }}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        form={form}
        autoComplete="off"
        onFocus={(event) => {
          setIsFocused(true);
          setQuery(selectedOptionLabel);
          setHighlightedIndex(-1);
          setShowAllOptions(false);
          setIsOpen(false);
          setAdvanceOnEnter(false);
          window.requestAnimationFrame(() => event.target.select?.());
        }}
        onBlur={handleInputBlur}
        onChange={(event) => {
          setQuery(event.target.value);
          setShowAllOptions(false);
          setIsOpen(Boolean(String(event.target.value || '').trim()));
          setAdvanceOnEnter(false);
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }

          if (event.key === ' ' && !String(query || '').trim()) {
            event.preventDefault();
            setIsOpen(true);
            setShowAllOptions(true);
            return;
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setShowAllOptions(true);
            setHighlightedIndex((currentIndex) => (
              filteredOptions.length === 0
                ? -1
                : currentIndex < 0
                  ? 0
                  : Math.min(currentIndex + 1, filteredOptions.length - 1)
            ));
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setShowAllOptions(true);
            setHighlightedIndex((currentIndex) => (
              filteredOptions.length === 0
                ? -1
                : currentIndex < 0
                  ? Math.max(filteredOptions.length - 1, 0)
                  : Math.max(currentIndex - 1, 0)
            ));
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            setQuery('');
            setShowAllOptions(false);
            setIsFocused(false);
            setAdvanceOnEnter(false);
            return;
          }

          if (event.key === 'Backspace' && !String(query || '').trim() && selectedOption) {
            event.preventDefault();
            onChange?.(null);
            setIsOpen(false);
            setShowAllOptions(false);
            setAdvanceOnEnter(false);
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            if (!isOpen) {
              if (advanceOnEnter && selectedOption) {
                commitSelection(selectedOption, true);
                return;
              }

              setQuery('');
              setIsOpen(true);
              setShowAllOptions(true);
              setHighlightedIndex(-1);
              return;
            }

            if (highlightedIndex < 0) {
              if (String(query || '').trim() && filteredOptions.length > 0) {
                commitSelection(filteredOptions[0], true);
                return;
              }
              setIsOpen(true);
              setShowAllOptions(true);
              setHighlightedIndex(-1);
              return;
            }

            const optionToCommit = filteredOptions[highlightedIndex] || null;
            if (optionToCommit) {
              commitSelection(optionToCommit, true);
            } else {
              onEnter?.(null);
            }
          }
        }}
        style={{
          width: '100%',
          color: '#0f2942',
          background: '#eef7ff',
          border: '1px solid #6a8fb3',
          fontWeight: 600
        }}
      />

      {isOpen && filteredOptions.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: dropdownMaxHeight,
            overflowY: 'auto',
            border: '1px solid #3f6285',
            background: '#f8fbff',
            boxShadow: '0 12px 24px rgba(4, 21, 43, 0.28)'
          }}
        >
          {filteredOptions.map((option, index) => {
            const optionKeyword = getNormalizedKeyword(option?.keyword, option?.username);
            const optionLabel = getOptionLabel(option);
            const optionValue = getOptionValue(option);

            return (
              <button
                key={optionValue}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitSelection(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#0f2942',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  background: index === highlightedIndex ? '#8fb6de' : '#f8fbff',
                  borderBottom: '1px solid #b5c9dd'
                }}
              >
                <strong style={{ color: '#0b3d68' }}>{optionKeyword}</strong> {optionLabel}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default SearchableSellerSelect;
