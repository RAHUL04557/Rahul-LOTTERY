describe('desktop selected-date storage', () => {
  let storage;
  let oldDate;
  let removedDate;
  let validDate;
  const plusDays = (date, days) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };
  const displayDate = (date) => date.split('-').reverse().join('/');

  beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    const policy = require('./localDataPolicy');
    oldDate = plusDays(policy.CUTOFF, -1);
    removedDate = policy.CUTOFF;
    validDate = plusDays(policy.CUTOFF, 1);
    window.lotteryLocalDb = {
      initializeDateStorage: jest.fn().mockResolvedValue({ values: {}, deletedDates: [removedDate] }),
      saveBrowserStorage: jest.fn((key, value) => ({ value }))
    };
    storage = require('./dateStorage');
    await storage.initializeDateStorage();
  });

  test('keeps retained selected dates irrespective of creation time', () => {
    const kept = { bookingDate: validDate, createdAt: '2020-01-01', rows: [{ number: '12345' }] };
    expect(storage.filterLocalData([
      { bookingDate: oldDate, createdAt: '2026-10-08' }, kept,
      { bookingDate: removedDate }, { bookingDate: 'unknown', createdAt: '2020-01-01' }
    ])).toEqual([kept, { bookingDate: 'unknown', createdAt: '2020-01-01' }]);
  });

  test('rejects old selected date writes without converting them to offline retries', () => {
    expect(() => storage.assertLocalDateAllowed({ body: { resultForDate: oldDate } })).toThrow();
    expect(() => storage.assertLocalDateAllowed({ body: { resultForDate: validDate, createdAt: '2020-01-01' } })).not.toThrow();
    try { storage.assertLocalDateAllowed({ bookingDate: oldDate }); }
    catch (error) { expect(error.response.status).toBe(409); }
  });

  test('nested retained rows and unknown dates survive the filter', () => {
    expect(storage.filterLocalData({ rows: [
      { drawDate: displayDate(oldDate) }, { drawDate: displayDate(validDate) }, { number: '12345' }
    ] })).toEqual({ rows: [{ drawDate: displayDate(validDate) }, { number: '12345' }] });
  });

  test('browser saves reach the desktop bridge and failures are surfaced', () => {
    const key = 'lottery.adminBooking.1.book-numbers.entries';
    storage.writeLocalValue(key, '[]');
    expect(window.lotteryLocalDb.saveBrowserStorage).toHaveBeenCalledWith(key, '[]');
    expect(storage.readLocalValue(key)).toBe('[]');
    expect(localStorage.getItem(key)).toBeNull();
    window.lotteryLocalDb.saveBrowserStorage.mockReturnValue({ error: 'Disk full' });
    expect(() => storage.writeLocalValue(key, '[1]')).toThrow('Disk full');
    expect(storage.readLocalValue(key)).toBe('[]');
  });

  test('migration touches only managed entry keys, not tokens or preferences', async () => {
    localStorage.setItem('token', 'keep-token');
    const key = 'lottery.adminBooking.1.book-numbers.entries';
    localStorage.setItem(key, '[{"bookingDate":"2026-09-30"}]');
    window.lotteryLocalDb.initializeDateStorage.mockResolvedValue({ values: { [key]: '[]' }, deletedDates: [] });
    await storage.initializeDateStorage();
    expect(localStorage.getItem('token')).toBe('keep-token');
    expect(storage.readLocalValue(key)).toBe('[]');
    expect(localStorage.getItem(key)).toBeNull();
    expect(window.lotteryLocalDb.initializeDateStorage.mock.calls[1][0]).not.toHaveProperty('token');
  });
  test('desktop booking save works even when browser localStorage quota is exhausted', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota full', 'QuotaExceededError');
    });
    const key = 'lottery.adminBooking.1.book-numbers.entries';
    expect(() => storage.writeLocalValue(key, '[{"bookingDate":"2026-10-01"}]')).not.toThrow();
    expect(storage.readLocalValue(key)).toContain('2026-10-01');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
