'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function wheelHarness() {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const priceChanges = [], frames = new Map();
  let options, handler, frameId = 0;
  const chart = {
    timeScale: () => ({width: () => 1100}),
    applyOptions: next => {options = {...options, ...next};}
  };
  const panes = [
    {index: 0, top: 0, bottom: 350, height: 350, series: {name: 'price'}},
    {index: 1, top: 350, bottom: 570, height: 220, series: {name: 'funding'}}
  ];
  const context = {
    document: {getElementById: () => ({style: {}})},
    LightweightCharts: {CrosshairMode: {Normal: 0}, createChart: (_host, value) => {options = value; return chart;}},
    Element: class Element {},
    rulerHost: {
      getBoundingClientRect: () => ({left: 100, top: 200, width: 1200}),
      addEventListener: (name, callback) => {assert.equal(name, 'wheel'); handler = callback;},
      style: {}
    },
    getPaneInfoAtY: y => panes.find(pane => y >= pane.top && y < pane.bottom),
    rulerEnabled: false, shiftHeld: false, rulerDragging: false,
    holdPriceAxisWidth: () => {},
    zoomPanePrice: (pane, y, factor) => priceChanges.push({pane: pane.series.name, y, factor}),
    requestAnimationFrame: callback => {frames.set(++frameId, callback); return frameId;},
    schedule: () => {}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(0, app.indexOf('const candles=chart.addSeries')), context);
  const rulerStart = app.indexOf('function rulerInteraction()');
  vm.runInContext(app.slice(rulerStart, app.indexOf('function endRulerDrag()', rulerStart)), context);
  const wheelStart = app.indexOf('let wheelPending = null, wheelRaf = 0;');
  vm.runInContext(app.slice(wheelStart, app.indexOf('// 가격축 더블클릭', wheelStart)), context);
  function wheel(x, y, deltaY, deltaMode = 0) {
    const event = {
      target: null, clientX: x + 100, clientY: y + 200, deltaY, deltaMode,
      defaultPrevented: false, stopped: false,
      preventDefault() {this.defaultPrevented = true;},
      stopImmediatePropagation() {this.stopped = true;}
    };
    handler(event);
    return event;
  }
  return {
    wheel, priceChanges, frames, options: () => options,
    ruler: active => {context.rulerEnabled = active; vm.runInContext('rulerInteraction()', context);},
    flush: () => {const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());}
  };
}

test('plot wheel at any pointer height leaves native time zoom enabled and never changes price manually', () => {
  const h = wheelHarness();
  assert.equal(h.options().handleScale.mouseWheel, true);
  for (const y of [30, 170, 320, 400, 540]) {
    for (const delta of [-100, 100]) {
      const event = h.wheel(700, y, delta);
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.stopped, false);
    }
  }
  h.flush();
  assert.deepEqual(h.priceChanges, []);
});

test('price-axis wheel changes only the hovered pane and coalesces repeated input', () => {
  const h = wheelHarness();
  for (let i = 0; i < 3; i++) {
    const event = h.wheel(1150, 470, -100);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
  }
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.priceChanges.length, 1);
  assert.equal(h.priceChanges[0].pane, 'funding');
  assert.equal(h.priceChanges[0].y, 120);
  assert.ok(h.priceChanges[0].factor < 1);
  h.wheel(1150, 170, 100);
  h.flush();
  assert.equal(h.priceChanges[1].pane, 'price');
  assert.ok(h.priceChanges[1].factor > 1);
});

test('the plot/axis boundary isolates vertical price zoom from native time zoom', () => {
  const h = wheelHarness();
  assert.equal(h.wheel(1099, 170, -100).defaultPrevented, false);
  assert.equal(h.wheel(1100, 170, -100).defaultPrevented, true);
  h.flush();
  assert.equal(h.priceChanges.length, 1);
});

test('ruler mode blocks zoom and normal wheel zoom returns when the ruler exits', () => {
  const h = wheelHarness();
  h.ruler(true);
  assert.equal(h.options().handleScale, false);
  assert.equal(h.wheel(500, 170, -100).defaultPrevented, true);
  assert.equal(h.wheel(1150, 170, -100).defaultPrevented, true);
  h.flush();
  assert.deepEqual(h.priceChanges, []);
  h.ruler(false);
  assert.equal(h.options().handleScale.mouseWheel, true);
  assert.equal(h.wheel(500, 170, -100).defaultPrevented, false);
});

test('wheel over the time axis is available to native time zoom without manual price changes', () => {
  const h = wheelHarness();
  assert.equal(h.wheel(600, 585, -100).defaultPrevented, false);
  h.flush();
  assert.deepEqual(h.priceChanges, []);
});
