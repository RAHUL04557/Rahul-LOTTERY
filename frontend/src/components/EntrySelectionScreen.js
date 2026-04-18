import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExitConfirmPrompt from './ExitConfirmPrompt';
import '../styles/EntrySelectionScreen.css';

const GROUP_OPTIONS = ['MORNING', 'DAY', 'EVENING'];

const getTodayDateValue = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());

const parseDateValue = (dateValue) => {
  const matched = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return new Date();
  }

  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
};

const getDateLabel = (dateValue) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit'
}).format(parseDateValue(dateValue));

const getLongDateLabel = (dateValue) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
}).format(parseDateValue(dateValue));

const getCurrentTimeLabel = () => new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true
}).format(new Date());

const buildCompanyOptions = (user, group) => {
  const canUse6 = user?.role === 'admin' || Number(user?.rateAmount6 || 0) > 0;
  const canUse12 = user?.role === 'admin' || Number(user?.rateAmount12 || 0) > 0;
  const options = [];
  const groupLabel = String(group || 'MORNING').trim().toUpperCase();

  if (canUse6) {
    options.push({ key: 'rate-6', label: `${groupLabel} BEST 7`, amount: '7', mode: 'dashboard' });
  }

  if (canUse12) {
    options.push({ key: 'rate-12', label: `${groupLabel} BEST 12`, amount: '12', mode: 'dashboard' });
  }

  return options;
};

const mapGroupToSessionMode = (group) => {
  if (group === 'EVENING') {
    return 'NIGHT';
  }

  return 'MORNING';
};

const mapGroupToPurchaseCategory = (group) => {
  if (group === 'DAY') {
    return 'D';
  }

  if (group === 'EVENING') {
    return 'E';
  }

  return 'M';
};

const EntrySelectionScreen = ({ user, onConfirm, onLogout }) => {
  const [currentTime, setCurrentTime] = useState(getCurrentTimeLabel());
  const [activeField, setActiveField] = useState('date');
  const [workingDate, setWorkingDate] = useState(getTodayDateValue());
  const [groupIndex, setGroupIndex] = useState(0);
  const selectedGroup = GROUP_OPTIONS[groupIndex];
  const companyOptions = useMemo(() => buildCompanyOptions(user, selectedGroup), [selectedGroup, user]);
  const [companyIndex, setCompanyIndex] = useState(0);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState('no');
  const dateInputRef = useRef(null);
  const groupButtonRef = useRef(null);
  const companyButtonRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(getCurrentTimeLabel()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const defaultCompanyIndex = companyOptions.findIndex((option) => option.mode === 'dashboard' && option.amount === '7');
    if (defaultCompanyIndex >= 0) {
      setCompanyIndex(defaultCompanyIndex);
      return;
    }

    setCompanyIndex(0);
  }, [companyOptions]);

  const focusDateField = useCallback(() => {
    setActiveField('date');
    setGroupPickerOpen(false);
    setCompanyPickerOpen(false);
    window.requestAnimationFrame(() => dateInputRef.current?.focus());
  }, []);

  const focusGroupField = useCallback((openPicker = false) => {
    setActiveField('group');
    setGroupPickerOpen(openPicker);
    setCompanyPickerOpen(false);
    window.requestAnimationFrame(() => groupButtonRef.current?.focus());
  }, []);

  const focusCompanyField = useCallback((openPicker = false) => {
    setActiveField('company');
    setGroupPickerOpen(false);
    setCompanyPickerOpen(openPicker);
    window.requestAnimationFrame(() => companyButtonRef.current?.focus());
  }, []);

  const confirmSelection = useCallback((companyOverride = null, groupOverride = null) => {
    const selectedCompany = companyOverride || companyOptions[companyIndex];
    const selectedGroupValue = groupOverride || GROUP_OPTIONS[groupIndex];
    if (!selectedCompany) {
      return;
    }

    onConfirm?.({
      group: selectedGroupValue,
      bookingDate: workingDate,
      sessionMode: mapGroupToSessionMode(selectedGroupValue),
      purchaseCategory: mapGroupToPurchaseCategory(selectedGroupValue),
      amount: selectedCompany.amount,
      mode: selectedCompany.mode,
      companyLabel: selectedCompany.label
    });
  }, [companyIndex, companyOptions, groupIndex, onConfirm, workingDate]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = String(event.key || '').toUpperCase();

      if (key === 'ESCAPE') {
        event.preventDefault();
        setExitConfirmSelected('no');
        setExitConfirmOpen(true);
        return;
      }

      if (key === 'F3') {
        event.preventDefault();
        focusGroupField(true);
        return;
      }

      if (key === ' ' || key === 'SPACEBAR') {
        event.preventDefault();
        focusCompanyField(true);
        return;
      }

      if (activeField === 'date') {
        if (key === 'ENTER') {
          event.preventDefault();
          focusGroupField(false);
        }
        return;
      }

      if (activeField === 'group') {
        if (groupPickerOpen && (key === 'ARROWDOWN' || key === 'ARROWUP')) {
          event.preventDefault();
          const delta = key === 'ARROWDOWN' ? 1 : -1;
          setGroupIndex((currentIndex) => {
            const nextIndex = currentIndex + delta;
            if (nextIndex < 0) {
              return GROUP_OPTIONS.length - 1;
            }
            if (nextIndex >= GROUP_OPTIONS.length) {
              return 0;
            }
            return nextIndex;
          });
          return;
        }

        if (key === 'ENTER') {
          event.preventDefault();
          setGroupPickerOpen(false);
          focusCompanyField(false);
        }
        return;
      }

      if (activeField === 'company') {
        if (companyPickerOpen && (key === 'ARROWDOWN' || key === 'ARROWUP')) {
          event.preventDefault();
          const delta = key === 'ARROWDOWN' ? 1 : -1;
          setCompanyIndex((currentIndex) => {
            if (companyOptions.length === 0) {
              return 0;
            }

            const nextIndex = currentIndex + delta;
            if (nextIndex < 0) {
              return companyOptions.length - 1;
            }
            if (nextIndex >= companyOptions.length) {
              return 0;
            }
            return nextIndex;
          });
          return;
        }

        if (key === 'ENTER') {
          event.preventDefault();
          if (companyPickerOpen) {
            setCompanyPickerOpen(false);
          }
          confirmSelection();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeField, companyIndex, companyOptions, companyPickerOpen, confirmSelection, focusCompanyField, focusGroupField, groupIndex, groupPickerOpen, onLogout]);

  return (
    <div className="entry-selection-shell">
      <ExitConfirmPrompt
        open={exitConfirmOpen}
        selected={exitConfirmSelected}
        onSelectedChange={setExitConfirmSelected}
        onConfirm={() => {
          setExitConfirmOpen(false);
          setExitConfirmSelected('no');
          onLogout?.();
        }}
        onCancel={() => {
          setExitConfirmOpen(false);
          setExitConfirmSelected('no');
        }}
      />

      <div className="entry-selection-window">
        <div className="entry-selection-titlebar">
          <span>RAHUL</span>
          <strong>{user?.role === 'admin' ? 'ADMIN ENTRY' : 'SELLER ENTRY'}</strong>
          <span>{currentTime}</span>
        </div>

        <div className="entry-selection-shortcuts">
          <button
            type="button"
            onClick={() => {
              focusGroupField(true);
            }}
          >
            F3-Change Group
          </button>
          <button
            type="button"
            onClick={() => {
              focusCompanyField(true);
            }}
          >
            Space-Change Company
          </button>
          <button type="button" onClick={() => confirmSelection()}>Enter-Select</button>
          <button
            type="button"
            onClick={() => {
              setExitConfirmSelected('no');
              setExitConfirmOpen(true);
            }}
          >
            Esc-Exit
          </button>
        </div>

        <div className="entry-selection-body compact">
          <div className="entry-selection-form">
            <div className="entry-selection-row">
              <label>Set working Date</label>
              <div className="entry-selection-date-block">
                <input
                  ref={dateInputRef}
                  type="date"
                  className={`entry-selection-input fixed ${activeField === 'date' ? 'active' : ''}`.trim()}
                  value={workingDate}
                  onChange={(event) => setWorkingDate(event.target.value || getTodayDateValue())}
                  onFocus={focusDateField}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      focusGroupField(false);
                    }
                  }}
                  aria-label="Set working date"
                />
                <strong>{getLongDateLabel(workingDate)} ({getDateLabel(workingDate)})</strong>
              </div>
            </div>

            <div className="entry-selection-row">
              <label>Company Group</label>
              <div className="entry-selection-field-wrap">
                <button
                  ref={groupButtonRef}
                  type="button"
                  className={`entry-selection-input ${activeField === 'group' ? 'active' : ''}`.trim()}
                  onClick={() => {
                    focusGroupField(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      setGroupPickerOpen(false);
                      focusCompanyField(false);
                    }
                  }}
                >
                  {GROUP_OPTIONS[groupIndex]}
                </button>
                {groupPickerOpen ? (
                  <div className="entry-selection-popup">
                    {GROUP_OPTIONS.map((group, index) => (
                      <button
                        key={group}
                        type="button"
                        className={`entry-selection-popup-option ${groupIndex === index ? 'selected' : ''}`.trim()}
                        onClick={() => {
                          setGroupIndex(index);
                          setGroupPickerOpen(false);
                          focusCompanyField(true);
                        }}
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="entry-selection-row">
              <label>Select Company</label>
              <div className="entry-selection-field-wrap">
                <button
                  ref={companyButtonRef}
                  type="button"
                  className={`entry-selection-input wide ${activeField === 'company' ? 'active' : ''}`.trim()}
                  onClick={() => {
                    if (activeField === 'company' && !companyPickerOpen) {
                      confirmSelection();
                      return;
                    }

                    focusCompanyField(true);
                  }}
                >
                  {companyOptions[companyIndex]?.label || ''}
                </button>
                {companyPickerOpen ? (
                  <div className="entry-selection-popup wide">
                    {companyOptions.map((option, index) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`entry-selection-popup-option ${companyIndex === index ? 'selected' : ''}`.trim()}
                        onClick={() => {
                          setCompanyIndex(index);
                          setCompanyPickerOpen(false);
                          confirmSelection(option);
                        }}
                        onDoubleClick={() => confirmSelection(option)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EntrySelectionScreen;
