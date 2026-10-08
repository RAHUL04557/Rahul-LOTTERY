describe('desktop selected-date storage', () => {
  let storage;
  beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    window.lotteryLocalDb = {
      initializeDateStorage: jest.fn().mockResolvedValue({ values: {}, deletedDates: ['2026-10-03'] }),
      saveBrowserStorage: jest.fn((key, value) => ({ value }))
    };
    storage = require('./dateStorage');
    await storage.initializeDateStorage();
  });

  test('keeps October selected dates irrespective of creation time', () => {
    const kept = { bookingDate: '2026-10-01', createdAt: '2020-01-01', rows: [{ number: '12345' }] };
    expect(storage.filterLocalData([
      { bookingDate: '2026-09-30', createdAt: '2026-10-08' }, kept,
      { bookingDate: '2026-10-03' }, { bookingDate: 'unknown', createdAt: '2020-01-01' }
    ])).toEqual([kept, { bookingDate: 'unknown', createdAt: '2020-01-01' }]);
  });

  test('rejects old selected date writes without converting them to offline retries', () => {
    expect(() => storage.assertLocalDateAllowed({ body: { resultForDate: '2026-09-30' } })).toThrow();
    expect(() => storage.assertLocalDateAllowed({ body: { resultForDate: '2026-10-01', createdAt: '2020-01-01' } })).not.toThrow();
    try { storage.assertLocalDateAllowed({ bookingDate: '2026-09-30' }); }
    catch (error) { expect(error.response.status).toBe(409); }
  });

  test('nested October rows and unknown dates survive the filter', () => {
    expect(storage.filterLocalData({ rows: [
      { drawDate: '30/09/2026' }, { drawDate: '01/10/2026' }, { number: '12345' }
    ] })).toEqual({ rows: [{ drawDate: '01/10/2026' }, { number: '12345' }] });
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
