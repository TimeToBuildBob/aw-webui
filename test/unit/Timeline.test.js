import Timeline from '~/views/Timeline.vue';
import { useBucketsStore } from '~/stores/buckets';

jest.mock('~/stores/buckets', () => ({
  useBucketsStore: jest.fn(),
}));

function makeBucket(id, events, extra = {}) {
  return {
    id,
    events,
    hostname: 'host1',
    client: 'client1',
    type: 'currentwindow',
    ...extra,
  };
}

describe('Timeline getBuckets filtering order', () => {
  test('applies duration filter after AFK filtering so both filters are respected', async () => {
    const getBucketsWithEvents = jest.fn().mockResolvedValue([
      makeBucket('window-main', [
        { duration: 1, id: 'raw-short' },
        { duration: 20, id: 'raw-long' },
      ]),
      makeBucket('afk-bucket', [{ duration: 50, id: 'afk-status' }], {
        type: 'afkstatus',
      }),
    ]);

    useBucketsStore.mockReturnValue({
      getBucketsWithEvents,
      bucketsAFK: jest.fn().mockReturnValue(['afk-bucket']),
    });

    const vm = {
      daterange: [
        { format: () => '2026-04-06T08:00:00+00:00' },
        { format: () => '2026-04-06T12:00:00+00:00' },
      ],
      filter_hostname: null,
      filter_client: null,
      filter_afk: true,
      filter_duration: 10,
      all_buckets: null,
      hosts: null,
      clients: null,
      buckets: null,
      _applyAfkFilter: jest.fn().mockResolvedValue([
        makeBucket('window-main', [
          { duration: 5, id: 'filtered-short' },
          { duration: 15, id: 'filtered-long' },
        ]),
      ]),
    };

    await Timeline.methods.getBuckets.call(vm);

    expect(getBucketsWithEvents).toHaveBeenCalledWith({
      start: '2026-04-06T08:00:00+00:00',
      end: '2026-04-06T12:00:00+00:00',
    });
    expect(vm._applyAfkFilter).toHaveBeenCalledTimes(1);
    expect(vm.buckets).toHaveLength(1);
    expect(vm.buckets[0].events).toEqual([{ duration: 15, id: 'filtered-long' }]);
  });
});
