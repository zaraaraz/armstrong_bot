import { MaintenanceWindow } from './maintenance-window.vo';

describe('MaintenanceWindow', () => {
  const window = MaintenanceWindow.from(
    { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: true },
    'UTC',
  );

  it('contains an instant inside the window', () => {
    expect(window.contains(new Date('2026-06-30T03:30:00Z'))).toBe(true);
  });

  it('does not contain an instant before the window', () => {
    expect(window.contains(new Date('2026-06-30T02:59:00Z'))).toBe(false);
  });

  it('does not contain an instant after the window ends', () => {
    expect(window.contains(new Date('2026-06-30T04:00:00Z'))).toBe(false);
  });

  it('reports the end of the covering window', () => {
    const end = window.endOfWindowAt(new Date('2026-06-30T03:30:00Z'));
    expect(end?.toISOString()).toBe('2026-06-30T04:00:00.000Z');
  });

  it('returns null end when not inside a window', () => {
    expect(window.endOfWindowAt(new Date('2026-06-30T05:00:00Z'))).toBeNull();
  });
});
