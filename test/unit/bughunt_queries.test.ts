import { createPinia, setActivePinia } from 'pinia';
import moment from 'moment';
import { useActivityStore } from '~/stores/activity';
import { createClient } from '~/util/awclient';
import { fullDesktopQuery, appQuery } from '~/queries';

function limitFrom(query: string[], variable: string): number {
  const m = query.join('\n').match(new RegExp(`limit_events\\(${variable}, (\\d+)\\)`));
  return m ? parseInt(m[1], 10) : Infinity;
}

describe('bughunt: data correctness of query layer', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Week view is split into 7 daily requests, each limited to the top 100
  // titles server-side, then merged client-side. A title that ranks 101st on
  // every day loses all of its time, even though it is the week's top title.
  test('week view top titles are not truncated per day before merging', async () => {
    const client = createClient(true);
    let call = 0;
    jest.spyOn(client, 'query').mockImplementation(async (_periods: any, query: any) => {
      const day = call++;
      // Simulated server: 100 day-unique titles at 10s, plus "Common" at 9s every day
      let titles = Array.from({ length: 100 }, (_v, i) => ({
        timestamp: '2020-01-06T00:00:00Z',
        duration: 10,
        data: { app: 'app', title: `day${day}-title${i}` },
      }));
      titles.push({
        timestamp: '2020-01-06T00:00:00Z',
        duration: 9,
        data: { app: 'app', title: 'Common' },
      });
      titles = titles.slice(0, limitFrom(query, 'title_events'));
      return [
        {
          window: {
            app_events: [
              { timestamp: '2020-01-06T00:00:00Z', duration: 1009, data: { app: 'app' } },
            ],
            title_events: titles,
            cat_events: [],
            active_events: [],
            duration: 1009,
            raw_duration: 1009,
          },
          browser: {},
        },
      ];
    });
    const store = useActivityStore();
    store.buckets.window = ['aw-watcher-window_host'];
    store.buckets.afk = ['aw-watcher-afk_host'];
    await store.query_desktop_full({
      host: 'host',
      timeperiod: { start: moment('2020-01-06').format(), length: [1, 'week'] },
      filter_afk: true,
    });
    expect(call).toBe(7);
    const common = (store.window.top_titles || []).find(e => e.data.title === 'Common');
    // True weekly total: 7 * 9 = 63s, the biggest title of the week
    expect(common && common.duration).toBe(63);
    expect(store.window.top_titles[0].data.title).toBe('Common');
  });

  // Category-by-period barchart must use the same active-time definition as
  // the category totals (fullDesktopQuery), which counts audible browser time
  // as active when include_audible is set.
  test('category history query honours include_audible like the full query', async () => {
    const client = createClient(true);
    const query = jest.spyOn(client, 'query').mockResolvedValue([{ cat_events: [] }]);
    const store = useActivityStore();
    store.buckets.window = ['aw-watcher-window_host'];
    store.buckets.afk = ['aw-watcher-afk_host'];
    store.buckets.browser = ['aw-watcher-web-firefox_host'];
    const opts = {
      host: 'host',
      timeperiod: { start: moment('2020-01-06').format(), length: [1, 'day'] as [number, string] },
      filter_afk: true,
      include_audible: true,
    };
    store.query_options = opts;
    await store.query_category_time_by_period(opts);
    expect(query).toHaveBeenCalled();
    const full = fullDesktopQuery({
      bid_window: 'aw-watcher-window_host',
      bid_afk: 'aw-watcher-afk_host',
      bid_browsers: ['aw-watcher-web-firefox_host'],
      filter_afk: true,
      include_audible: true,
      categories: [],
      filter_categories: [],
    }).join('\n');
    expect(full).toContain('audible_events');
    const catQuery = (query.mock.calls[0][1] as string[]).join('\n');
    expect(catQuery).toContain('audible_events');
  });

  // With filter_afk, the browser stats (top domains/urls, browser duration)
  // are computed from window events that were never AFK-filtered, so time the
  // browser sat focused while the user was away is counted as browsing.
  test('fullDesktopQuery AFK-filters browser events when filter_afk is set', () => {
    const q = fullDesktopQuery({
      bid_window: 'aw-watcher-window_host',
      bid_afk: 'aw-watcher-afk_host',
      bid_browsers: ['aw-watcher-web-firefox_host'],
      filter_afk: true,
      categories: [],
      filter_categories: [],
    }).join('\n');
    const afkFilter = q.indexOf('events = filter_period_intersect(events, not_afk);');
    const browserWindow = q.indexOf('window_firefox = filter_keyvals(events');
    const browserAfkFiltered =
      /browser_events = filter_period_intersect\(browser_events, not_afk\)/.test(q) ||
      /events_firefox = filter_period_intersect\(events_firefox, not_afk\)/.test(q) ||
      (afkFilter >= 0 && afkFilter < browserWindow);
    expect(browserAfkFiltered).toBe(true);
  });

  // Android (non-iOS) appQuery pre-merges events by ["app"] only. Merge keeps
  // the data of the first event per app, so the following
  // merge_events_by_keys(events, ["app", "classname"]) can only ever produce
  // one entry per app: the per-classname (activity) breakdown is lost and
  // title_events == app_events.
  test('android appQuery keeps classname granularity for title_events', () => {
    const q = appQuery('aw-watcher-android-test', [], []).join('\n');
    expect(q).toContain('merge_events_by_keys(events, ["app", "classname"])');
    const preMergeIdx = q.indexOf('events = merge_events_by_keys(events, ["app"]);');
    const titleIdx = q.indexOf('title_events =');
    expect(preMergeIdx === -1 || preMergeIdx > titleIdx).toBe(true);
  });
});
