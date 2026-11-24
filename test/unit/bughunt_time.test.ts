import { createPinia, setActivePinia } from 'pinia';
import moment from 'moment';
import ActivityComponent from '~/views/activity/Activity.vue';
import { get_day_start_with_offset, get_day_end_with_offset } from '~/util/time';
import {
  periodReadable,
  timeperiodsAroundTimeperiod,
  timeperiodToStr,
  timeperiodsHoursOfPeriod,
} from '~/util/timeperiod';

const Activity: any = ActivityComponent;

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const inStockholm = TZ === 'Europe/Stockholm' ? describe : describe.skip;

// F1: start of day falling into the spring-forward gap (EU: 02:00 -> 03:00 on 2026-03-29)
inStockholm('F1 start-of-day in DST gap (TZ=Europe/Stockholm)', () => {
  test('F1a day end of 2026-03-29 equals day start of 2026-03-30 (offset 02:00)', () => {
    const end29 = get_day_end_with_offset('2026-03-29', '02:00');
    const start30 = get_day_start_with_offset('2026-03-30', '02:00');
    expect(end29).toBe(start30); // '2026-03-30T02:00:00+02:00'
  });

  test('F1b neighbouring history periods do not overlap (period-usage bars)', () => {
    const tp = {
      start: get_day_start_with_offset('2026-03-30', '02:00'),
      length: [1, 'day'] as [number, string],
    };
    const strs = timeperiodsAroundTimeperiod(tp).map(timeperiodToStr);
    for (let i = 1; i < strs.length; i++) {
      const prevEnd = moment(strs[i - 1].split('/')[1]).valueOf();
      const curStart = moment(strs[i].split('/')[0]).valueOf();
      expect([strs[i - 1], strs[i], prevEnd - curStart]).toEqual([strs[i - 1], strs[i], 0]);
    }
  });

  test('F1c hourly buckets of 2026-03-29 (offset 02:00) cover 23 hours', () => {
    const tp = {
      start: get_day_start_with_offset('2026-03-29', '02:00'),
      length: [1, 'day'] as [number, string],
    };
    expect(timeperiodsHoursOfPeriod(tp)).toHaveLength(23);
  });
});

// F2: multi-day period labels show the exclusive end date
describe('F2 periodReadable multi-day end date', () => {
  test('F2a a 7-day period starting 2026-11-18 reads "2026-11-18 to 2026-11-24"', () => {
    const tp = {
      start: get_day_start_with_offset('2026-11-18', '04:00'),
      length: [7, 'days'] as [number, string],
    };
    expect(periodReadable(tp)).toBe('2026-11-18 to 2026-11-24');
  });
});

describe('F3 Activity periodReadableRange end date', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    jest.useFakeTimers().setSystemTime(new Date('2026-11-24T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  function makeVm(periodLength: string, date: string | undefined, extra: any = {}) {
    const vm: any = {
      periodLength,
      date,
      host: 'test',
      intervalIssue: null,
      navigationNow: Date.now(),
      settingsStore: { startOfDay: '04:00' },
      $t: (k: string) => k,
      ...Activity.methods,
      ...extra,
    };
    for (const name of [
      'exactInterval',
      'dateRange',
      'invalidRange',
      'timeperiod',
      '_date',
      'periodIsBrowseable',
      'periodReadableRange',
      'todayDate',
      'allTimeRange',
    ]) {
      Object.defineProperty(vm, name, { get: () => Activity.computed[name].call(vm) });
    }
    return vm;
  }

  test('F3a last7d on 2026-11-24 matches the equivalent inclusive custom range', () => {
    const last7 = makeVm('last7d', '2026-11-24');
    const range = makeVm('range', '2026-11-18..2026-11-24');
    // Same query period...
    expect(last7.timeperiod).toEqual(range.timeperiod);
    // ...should read the same
    expect(last7.periodReadableRange).toBe(range.periodReadableRange); // 2026-11-18—2026-11-24
  });

  test('F3b week of Mon 2026-11-23 ends Sunday 2026-11-29', () => {
    const vm = makeVm('week', '2026-11-23', {
      settingsStore: { startOfDay: '04:00', startOfWeek: 'Monday' },
    });
    expect(vm.periodReadableRange).toBe('2026-11-23—2026-11-29');
  });
});
