'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function panelHarness() {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const options = app.slice(app.indexOf('function fundingLiveOptions()'), app.indexOf('let fundingLive='));
  const created = [], removed = [];
  const pane = {paneIndex: () => 0, setStretchFactor: () => {}};
  const context = {
    LC: {HistogramSeries: 'histogram', LineSeries: 'line', LineStyle: {Dotted: 1, Dashed: 2}},
    chart: {panes: () => [], addSeries: (type, options, index) => {
      const series = {type, options, index, createPriceLine: () => {}, getPane: () => pane, applyOptions: values => Object.assign(series.options, values)};
      created.push(series); return series;
    }, removeSeries: series => removed.push(series)},
    manualPriceSpans: new WeakMap()
  };
  vm.createContext(context);
  vm.runInContext(options + '\nlet funding=null,fundingLive=null;\n' + fs.readFileSync(path.join(__dirname, '../indicators.js'), 'utf8') + '\nthis.managerClass=StudyPanelManager;this.series=()=>({funding,fundingLive});this.options=fundingLiveOptions;', context);
  const manager = Object.create(context.managerClass.prototype);
  manager.panels = new Map([['funding', {id: 'funding', title: '펀딩비 (%)', members: [], active: false, hidden: false, stretch: 2.5}]]);
  manager.settings = {};
  manager.order = [];
  manager.restoreMaximized = manager.refresh = () => {};
  return {manager, context, created, removed};
}
test('live funding autoscale includes zero and the full -2% value', () => {
  const h = panelHarness(), options = h.context.options();
  const info = options.autoscaleInfoProvider(() => ({priceRange: {minValue: -2, maxValue: -2}}));
  assert.equal(info.priceRange.minValue, -2);
  assert.equal(info.priceRange.maxValue, 0);
  assert.equal(options.autoscaleInfoProvider(() => null), null);
  assert.equal(options.lastValueVisible, true);
  assert.equal(options.pointMarkersVisible, true);
});
test('funding panel deletion and recreation include both historical and live series', () => {
  const h = panelHarness();
  h.manager.create('funding');
  const first = h.context.series();
  assert.equal(h.manager.panels.get('funding').members.length, 2);
  assert.equal(first.funding.type, 'histogram');
  assert.equal(first.fundingLive.type, 'line');
  assert.equal(first.funding.index, first.fundingLive.index);
  h.manager.remove('funding', false);
  assert.equal(h.removed.length, 2);
  assert.equal(h.context.series().funding, null);
  assert.equal(h.context.series().fundingLive, null);
  h.manager.create('funding');
  assert.notEqual(h.context.series().fundingLive, first.fundingLive);
  assert.equal(h.manager.panels.get('funding').members.length, 2);
});
test('hiding a funding pane hides the current value as well as settled history', () => {
  const h = panelHarness(); h.manager.create('funding');
  h.manager.panels.get('funding').hidden = true;
  h.manager.applyVisibility();
  assert.ok(h.created.every(series => series.options.visible === false));
  h.manager.panels.get('funding').hidden = false;
  h.manager.applyVisibility();
  assert.ok(h.created.every(series => series.options.visible === true));
});
