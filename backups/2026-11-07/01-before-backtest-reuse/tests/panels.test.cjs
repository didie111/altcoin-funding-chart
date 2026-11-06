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
      const series = {type, options, index, createPriceLine: () => {}, attachPrimitive: () => {}, getPane: () => pane, applyOptions: values => Object.assign(series.options, values)};
      created.push(series); return series;
    }, removeSeries: series => removed.push(series)},
    manualPriceSpans: new WeakMap()
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../timeframes.js'), 'utf8') + '\n' + options + '\nlet funding=null,fundingLive=null;\n' + fs.readFileSync(path.join(__dirname, '../indicators.js'), 'utf8') + '\nthis.managerClass=StudyPanelManager;this.series=()=>({funding,fundingLive});this.options=fundingLiveOptions;', context);
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
  assert.equal(options.pointMarkersVisible, false);
  assert.equal(options.crosshairMarkerVisible, false);
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
test('panning outside observed live funding skips an empty price range instead of stopping later panes', () => {
  const h = panelHarness(), provider = h.context.options().autoscaleInfoProvider;
  assert.equal(provider(() => ({priceRange: null})), null);
  assert.equal(provider(() => ({priceRange: null, margins: {above: 3, below: 4}})), null);
  const valid = provider(() => ({priceRange: {minValue: .005, maxValue: .005}, margins: {above: 3, below: 4}}));
  assert.equal(valid.priceRange.minValue, 0);
  assert.equal(valid.priceRange.maxValue, .005);
  assert.equal(valid.margins.above, 3);
  assert.equal(valid.margins.below, 4);
});
test('RSI autoscale skips empty visible history and retains its normal 0..100 scale', () => {
  const h = panelHarness();
  h.manager.panels.set('rsi', {id: 'rsi', title: 'RSI Div', members: [], active: false, hidden: false, stretch: 3});
  h.manager.settings = vm.runInContext('RsiEngine.normalize()', h.context);
  h.manager.create('rsi');
  const provider = h.created[0].options.autoscaleInfoProvider;
  assert.equal(provider(() => ({priceRange: null})), null);
  assert.equal(provider(() => null), null);
  const valid = provider(() => ({priceRange: {minValue: 30, maxValue: 70}}));
  assert.equal(valid.priceRange.minValue, 0);
  assert.equal(valid.priceRange.maxValue, 100);
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
