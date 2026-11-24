import { createLocalVue, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vue from 'vue';
import SelectableEventView from '~/components/SelectableEventView.vue';
import Summary from '~/visualizations/Summary.vue';
import CategoryTree from '~/visualizations/CategoryTree.vue';
import { split_by_hour_into_data } from '~/util/transforms';
import { useSettingsStore } from '~/stores/settings';

Vue.component('aw-summary', Summary);

async function flush(wrapper: any) {
  await wrapper.vm.$nextTick();
  await new Promise(resolve => setTimeout(resolve, 20));
}

describe('bughunt totals', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('SelectableEventView summary sums durations per key and ranks by total', async () => {
    // Report/Search results arrive in timestamp order, one row per event.
    const events = [
      { timestamp: '2026-10-31T12:03:00Z', duration: 60, data: { title: 'A' } },
      { timestamp: '2026-10-31T12:02:00Z', duration: 600, data: { title: 'B' } },
      { timestamp: '2026-10-31T12:01:00Z', duration: 60, data: { title: 'A' } },
    ];
    const wrapper = mount(SelectableEventView, {
      propsData: { events },
      stubs: { 'vis-timeline': true, 'aw-eventlist': true },
      attachTo: document.body,
    });
    try {
      wrapper.setData({ vis_method: 'summary' });
      await flush(wrapper);
      const groups = Array.from(wrapper.element.querySelectorAll('g[id^="summary_"]'));
      const rows = groups.map(g => ({
        title: g.querySelector('title').textContent,
        width: g.querySelector('rect').getAttribute('width'),
      }));
      // Expected: one bar per title, B (10m) first at 100%, A summed to 2m.
      expect(rows.map(r => r.title)).toEqual(['B\n10m 0s', 'A\n2m 0s']);
      expect(rows[0].width).toBe('100%');
    } finally {
      wrapper.destroy();
    }
  });

  test('summary bars never exceed 100% width when fields are not sorted by duration', async () => {
    const events = [
      { timestamp: '2026-10-31T12:02:00Z', duration: 60, data: { title: 'A' } },
      { timestamp: '2026-10-31T12:01:00Z', duration: 600, data: { title: 'B' } },
    ];
    const wrapper = mount(SelectableEventView, {
      propsData: { events },
      stubs: { 'vis-timeline': true, 'aw-eventlist': true },
      attachTo: document.body,
    });
    try {
      wrapper.setData({ vis_method: 'summary' });
      await flush(wrapper);
      const widths = Array.from(wrapper.element.querySelectorAll('g[id^="summary_"] > rect')).map(
        r => parseFloat(r.getAttribute('width'))
      );
      expect(Math.max(...widths)).toBeLessThanOrEqual(100);
    } finally {
      wrapper.destroy();
    }
  });

  test('CategoryTree percentage keeps one decimal for small shares', async () => {
    const localVue = createLocalVue();
    localVue.filter('friendlyduration', d => `${d}s`);
    const ev = (name: string[], duration: number) => ({
      timestamp: '2026-01-01T00:00:00Z',
      duration,
      data: { $category: name },
    });
    const wrapper = mount(CategoryTree, {
      localVue,
      propsData: { events: [ev(['Media'], 996), ev(['Work'], 4)] },
      stubs: { icon: true, 'b-checkbox': true },
    });
    wrapper.setData({ show_perc: true });
    await wrapper.vm.$nextTick();
    const values = wrapper.findAll('.category-value').wrappers.map(w => w.text());
    // 4s of 1000s is 0.4%, not "0%" (Math.round ignores its second arg)
    expect(values).toEqual(['99.6%', '0.4%']);
    wrapper.destroy();
  });

  test('split_by_hour_into_data counts an event starting exactly on an hour boundary', () => {
    useSettingsStore().startOfDay = '00:00';
    // Local 10:00 -> 12:00 (two full hours)
    const start = new Date(2026, 0, 1, 10, 0, 0).toISOString();
    const data = split_by_hour_into_data([{ timestamp: start, duration: 7200, data: {} }]);
    expect(data[10]).toBe(1);
    expect(data[11]).toBe(1);
  });

  test('split_by_hour_into_data counts an event exactly filling one hour', () => {
    useSettingsStore().startOfDay = '00:00';
    const start = new Date(2026, 0, 1, 10, 0, 0).toISOString();
    const data = split_by_hour_into_data([{ timestamp: start, duration: 3600, data: {} }]);
    expect(data[10]).toBe(1);
  });

  test('split_by_hour_into_data honours a half-hour start-of-day offset', () => {
    useSettingsStore().startOfDay = '04:30';
    // 04:00-04:30 belongs to the previous logical day; first bucket is 04:30-05:30
    const start = new Date(2026, 0, 1, 4, 0, 0).toISOString();
    const data = split_by_hour_into_data([{ timestamp: start, duration: 1800, data: {} }]);
    expect(data[0]).toBe(0);
  });
});
