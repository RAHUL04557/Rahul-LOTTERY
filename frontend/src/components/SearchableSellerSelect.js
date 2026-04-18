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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState('');

  const selectedOption = useMemo(
    () => options.find((option) => String(getOptionValue(option)) === String(value)) || null,
    [getOptionValue, options, value]
  );
  const selectedOptionLabel = useMemo(
    () => (selectedOption ? String(getOptionLabel(selectedOption) || '') : ''),
    [getOptionLabel, selectedOption]
  );
  const displayValue = isOpen ? query : (query || selectedOptionLabel);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toUpperCase();
    if (!normalizedQuery) {
      return options;
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
  }, [getOptionLabel, getOptionSearchLabel, options, query]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, isOpen]);

  const commitSelection = (option, shouldMoveNext = false) => {
    if (!option) {
      return;
    }

    setQuery('');
    setIsOpen(false);
    onChange?.(option);

    if (shouldMoveNext) {
      onEnter?.(option);
    }
  };

  const handleInputBlur = () => {
    window.setTimeout(() => {
      if (wrapperRef.current?.contains(document.activeElement)) {
        return;
      }

      setIsOpen(false);
      setQuery('');
    }, 120);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        form={form}
        autoComplete="off"
        onFocus={() => setIsOpen(true)}
        onBlur={handleInputBlur}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }

          if (event.key === ' ' && !String(query || '').trim()) {
            event.preventDefault();
            setIsOpen(true);
            return;
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((currentIndex) => (
              filteredOptions.length === 0
                ? 0
                : Math.min(currentIndex + 1, filteredOptions.length - 1)
            ));
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            setQuery('');
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            const optionToCommit = filteredOptions[highlightedIndex] || selectedOption || null;
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

      {isOpen ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: '220px',
            overflowY: 'auto',
            border: '1px solid #3f6285',
            background: '#f8fbff',
            boxShadow: '0 12px 24px rgba(4, 21, 43, 0.28)'
          }}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
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
                    background: index === highlightedIndex ? '#8fb6de' : '#f8fbff',
                    borderBottom: '1px solid #b5c9dd'
                  }}
                >
                  <strong style={{ color: '#0b3d68' }}>{optionKeyword}</strong> {optionLabel}
                </button>
              );
            })
          ) : (
            <div style={{ padding: '10px 12px', color: '#27496d', fontWeight: 600 }}>No seller found</div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default SearchableSellerSelect;
