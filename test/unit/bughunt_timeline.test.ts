import { shallowMount } from '@vue/test-utils';
import moment from 'moment';
import TimelineView from '~/views/Timeline.vue';
import { mergeCategoryIntervals } from '~/util/timelineCategories';
import { split_by_hour_into_data } from '~/util/transforms';

const mockGetBucketsWithEvents = jest.fn();
const mockQuery = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ query: mockQuery }),
}));
jest.mock('~/stores/buckets', () => ({
  useBucketsStore: () => ({
    getBucketsWithEvents: mockGetBucketsWithEvents,
    bucketsAFK: host => (host === 'laptop' ? ['afk_laptop'] : []),
  }),
}));
jest.mock('~/stores/categories', () => ({
  useCategoryStore: () => ({
    classes: [],
    classes_for_query: [],
    allCategoriesSelect: [],
    load: jest.fn(),
  }),
}));
jest.mock('~/stores/settings', () => ({
  useSettingsStore: () => ({
    durationDefault: 3600,
    timelineGroupGranularity: 0,
    always_active_pattern: '',
    startOfDay: '00:00',
  }),
}));

const event = (offset: number, duration: number, app: string) => ({
  timestamp: moment.utc('2026-10-18T09:00:00Z').add(offset, 'seconds').toISOString(),
  duration,
  data: { app, title: app },
});

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

function mountTimeline() {
  return shallowMount(TimelineView, {
    stubs: {
      'aw-timeline-event-list': true,
      'vis-timeline': true,
      'aw-devonly': true,
      'aw-calendar': true,
    },
  });
}

function windowEvents(vm: any) {
  return vm.buckets.find(b => b.id === 'window_laptop').events;
}

describe('Timeline view filter pipeline', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetBucketsWithEvents.mockReset();
  });

  test('AFK filter must not discard the duration filter on window buckets', async () => {
    const raw = [event(0, 5, 'short'), event(10, 600, 'long')];
    mockGetBucketsWithEvents.mockResolvedValue([
      { id: 'window_laptop', type: 'currentwindow', hostname: 'laptop', client: 'w', events: raw },
      { id: 'afk_laptop', type: 'afkstatus', hostname: 'laptop', client: 'a', events: [] },
    ]);
    // The AFK-filtered query returns the (not-AFK) window events, short one included.
    mockQuery.mockResolvedValue([raw]);
    const wrapper = mountTimeline();
    wrapper.setData({ daterange: [moment.utc('2026-10-18'), moment.utc('2026-10-19')] });
    await flush();
    wrapper.setData({ filter_duration: 30 });
    await flush();
    expect(windowEvents(wrapper.vm).map(e => e.data.app)).toEqual(['long']);
    wrapper.setData({ filter_afk: true });
    await flush();
    // Expected: still only 'long'; master re-introduces the 5s event.
    expect(windowEvents(wrapper.vm).map(e => e.data.app)).toEqual(['long']);
  });

  test('AFK filter must not discard the category filter on window buckets', async () => {
    const raw = [event(0, 600, 'Code')];
    mockGetBucketsWithEvents.mockResolvedValue([
      { id: 'window_laptop', type: 'currentwindow', hostname: 'laptop', client: 'w', events: raw },
      { id: 'afk_laptop', type: 'afkstatus', hostname: 'laptop', client: 'a', events: [] },
    ]);
    mockQuery.mockResolvedValue([raw]);
    const wrapper = mountTimeline();
    wrapper.setData({ daterange: [moment.utc('2026-10-18'), moment.utc('2026-10-19')] });
    await flush();
    // No classes defined: every event is Uncategorized, so a Work filter hides it.
    wrapper.setData({ filter_categories: [['Work']] });
    await flush();
    expect(windowEvents(wrapper.vm)).toHaveLength(0);
    wrapper.setData({ filter_afk: true });
    await flush();
    expect(windowEvents(wrapper.vm)).toHaveLength(0);
  });

  test('merge-similar runs before the duration filter, so merged runs survive it', async () => {
    // Ten contiguous 5s events of the same app = one 50s block once merged.
    const raw = Array.from({ length: 10 }, (_v, i) => event(i * 5, 5, 'Illustrator'));
    mockGetBucketsWithEvents.mockResolvedValue([
      { id: 'window_laptop', type: 'currentwindow', hostname: 'laptop', client: 'w', events: raw },
    ]);
    mockQuery.mockResolvedValue([[]]);
    const wrapper = mountTimeline();
    wrapper.setData({ daterange: [moment.utc('2026-10-18'), moment.utc('2026-10-19')] });
    await flush();
    wrapper.setData({ filter_merge_similar: true });
    await flush();
    expect(windowEvents(wrapper.vm).map(e => e.duration)).toEqual([50]);
    wrapper.setData({ filter_duration: 30 });
    await flush();
    // The categorized row filters after merging; raw rows filter before and lose the block.
    expect(windowEvents(wrapper.vm).map(e => e.duration)).toEqual([50]);
  });
});

describe('mergeCategoryIntervals', () => {
  test('merges touching intervals whose microsecond timestamps truncate unevenly', () => {
    // True end of the first = 10:00:10.000400 = start of the second.
    const merged = mergeCategoryIntervals([
      { timestamp: '2026-10-18T10:00:00.000600Z', duration: 9.9998, data: { $category: ['Work'] } },
      { timestamp: '2026-10-18T10:00:10.000400Z', duration: 5, data: { $category: ['Work'] } },
    ]);
    expect(merged).toHaveLength(1);
  });
});

describe('split_by_hour_into_data', () => {
  test('an event covering exactly one aligned hour counts as a full hour', () => {
    const d = moment('2026-10-18T00:00:00').startOf('day');
    const events = [
      { timestamp: d.clone().hour(10).toISOString(), duration: 3600, data: {} },
      { timestamp: d.clone().hour(13).toISOString(), duration: 9000, data: {} },
    ];
    const data = split_by_hour_into_data(events);
    expect(data[10]).toBeCloseTo(1);
    expect(data[13]).toBeCloseTo(1);
    expect(data[14]).toBeCloseTo(1);
    expect(data[15]).toBeCloseTo(0.5);
  });
});
