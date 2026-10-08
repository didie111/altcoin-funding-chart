'use strict';

const RsiEngine = (() => {
  const defaults = {
    length: 14,
    source: 'close',
    divergence: true,
    overbought: 70,
    oversold: 30,
    maType: 'SMA',
    maLength: 14,
    bbMult: 2,
    rsiColor: '#7e57c2',
    maColor: '#facc15',
    bullColor: '#4caf50',
    bearColor: '#ef4444',
    lineWidth: 2,
    showRsi: true,
    showMa: true,
    showBands: true,
    showFill: true,
    showBull: true,
    showBear: true,
    timeframes: ['15m', '1h', '4h', '1d'],
    alerts: false
  };

  const sources = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
  const maTypes = ['None', 'SMA', 'SMA + Bollinger Bands', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'];

  function normalize(input = {}) {
    const s = { ...defaults, ...input };

    for (const key of ['length', 'maLength']) {
      if (!Number.isSafeInteger(s[key]) || s[key] < 1) {
        throw Error('RSI와 이동평균 길이는 1 이상의 정수여야 합니다.');
      }
    }

    if (!sources.includes(s.source) || !maTypes.includes(s.maType)) {
      throw Error('지원하지 않는 RSI 설정입니다.');
    }

    if (
      ![s.overbought, s.oversold].every(Number.isFinite) ||
      s.oversold < 0 ||
      s.overbought > 100 ||
      s.oversold >= s.overbought
    ) {
      throw Error('과매도 < 과매수, 0~100 범위로 입력하세요.');
    }

    if (!Number.isFinite(s.bbMult) || s.bbMult < 0.001 || s.bbMult > 50) {
      throw Error('BB 표준편차 배수는 0.001~50 범위입니다.');
    }

    for (const key of ['rsiColor', 'maColor', 'bullColor', 'bearColor']) {
      if (!/^#[0-9a-f]{6}$/i.test(s[key])) {
        s[key] = defaults[key];
      }
    }

    s.lineWidth = [1, 2, 3, 4].includes(s.lineWidth) ? s.lineWidth : 2;
    s.timeframes = Array.isArray(s.timeframes)
      ? s.timeframes.filter(v => defaults.timeframes.includes(v))
      : [...defaults.timeframes];

    for (const key of [
      'divergence',
      'showRsi',
      'showMa',
      'showBands',
      'showFill',
      'showBull',
      'showBear',
      'alerts'
    ]) {
      s[key] = Boolean(s[key]);
    }

    return s;
  }

  const empty = n => new Float64Array(n).fill(NaN);

  function rma(values, length) {
    const out = empty(values.length);
    let sum = 0;
    let count = 0;
    let value = NaN;

    for (let i = 0; i < values.length; i++) {
      const v = values[i];

      if (Number.isFinite(v)) {
        if (Number.isNaN(value)) {
          sum += v;
          if (++count === length) value = sum / length;
        } else {
          value = v / length + (1 - 1 / length) * value;
        }
      }

      out[i] = value;
    }

    return out;
  }

  function average(values, length, type, volumes) {
    if (type === 'SMMA (RMA)') {
      return rma(values, length);
    }

    const out = empty(values.length);

    if (type === 'None') {
      return out;
    }

    let ema = NaN;
    let sum = 0;
    let weighted = 0;
    let volumeSum = 0;
    let head = 0;

    const indices = [];
    const alpha = 2 / (length + 1);

    for (let i = 0; i < values.length; i++) {
      const v = values[i];

      if (type === 'EMA') {
        if (Number.isFinite(v)) {
          ema = Number.isNaN(ema) ? v : alpha * v + (1 - alpha) * ema;
        }
        out[i] = ema;
        continue;
      }

      if (!Number.isFinite(v)) {
        continue;
      }

      const count = indices.length - head;

      if (type === 'WMA') {
        weighted += (count < length ? count + 1 : length) * v - (count < length ? 0 : sum);
      }

      const weight = type === 'VWMA' ? volumes[i] : 1;
      sum += v * weight;
      volumeSum += weight;
      indices.push(i);

      if (indices.length - head > length) {
        const old = indices[head++];
        const oldWeight = type === 'VWMA' ? volumes[old] : 1;
        sum -= values[old] * oldWeight;
        volumeSum -= oldWeight;
      }

      if (indices.length - head === length) {
        out[i] =
          type === 'WMA'
            ? weighted / (length * (length + 1) / 2)
            : volumeSum
              ? sum / volumeSum
              : NaN;
      }
    }

    return out;
  }

  function standardDeviation(values, length) {
    const out = empty(values.length);
    const indices = [];
    let head = 0;
    let sum = 0;
    let squares = 0;

    for (let i = 0; i < values.length; i++) {
      const v = values[i];

      if (!Number.isFinite(v)) {
        continue;
      }

      indices.push(i);
      sum += v;
      squares += v * v;

      if (indices.length - head > length) {
        const old = values[indices[head++]];
        sum -= old;
        squares -= old * old;
      }

      if (indices.length - head === length) {
        out[i] = Math.sqrt(
          Math.max(0, squares / length - (sum / length) ** 2)
        );
      }
    }

    return out;
  }

  function pivots(values, bars, settings) {
    const signals = [];
    const bullCond = new Uint8Array(values.length);
    const bearCond = new Uint8Array(values.length);

    let previousLow = null;
    let previousHigh = null;

    for (let p = 5; p + 5 < values.length; p++) {
      const value = values[p];

      if (!Number.isFinite(value)) {
        continue;
      }

      let low = true;
      let high = true;

      for (let j = p - 5; j <= p + 5; j++) {
        if (j === p || !Number.isFinite(values[j])) {
          continue;
        }

        if (j < p ? values[j] < value : values[j] <= value) {
          low = false;
        }

        if (j < p ? values[j] > value : values[j] >= value) {
          high = false;
        }
      }

      const confirmedIndex = p + 5;

      if (low) {
        const prev = previousLow;
        const distance = prev
          ? confirmedIndex - prev.confirmedIndex - 1
          : -1;

        if (
          settings.divergence &&
          prev &&
          distance >= 5 &&
          distance <= 60 &&
          value > prev.value &&
          bars[p].low < bars[prev.index].low &&
          (value <= settings.oversold || prev.value <= settings.oversold)
        ) {
          signals.push({
            type: 'bull',
            fromIndex: prev.index,
            toIndex: p,
            fromValue: prev.value,
            value,
            confirmedIndex,
            time: bars[p].time,
            confirmedTime: bars[confirmedIndex].time
          });

          bullCond[confirmedIndex] = 1;
        }

        previousLow = {
          index: p,
          value,
          confirmedIndex
        };
      }

      if (high) {
        const prev = previousHigh;
        const distance = prev
          ? confirmedIndex - prev.confirmedIndex - 1
          : -1;

        if (
          settings.divergence &&
          prev &&
          distance >= 5 &&
          distance <= 60 &&
          value < prev.value &&
          bars[p].high > bars[prev.index].high &&
          (value >= settings.overbought || prev.value >= settings.overbought)
        ) {
          signals.push({
            type: 'bear',
            fromIndex: prev.index,
            toIndex: p,
            fromValue: prev.value,
            value,
            confirmedIndex,
            time: bars[p].time,
            confirmedTime: bars[confirmedIndex].time
          });

          bearCond[confirmedIndex] = 1;
        }

        previousHigh = {
          index: p,
          value,
          confirmedIndex
        };
      }
    }

    return {
      signals,
      bullCond,
      bearCond
    };
  }

  function calculate(bars, input = {}) {
    const settings = normalize(input);
    const n = bars.length;
    const changes = empty(n);
    const gains = empty(n);
    const losses = empty(n);

    const source = bars.map(b =>
      settings.source === 'hl2'
        ? (b.high + b.low) / 2
        : settings.source === 'hlc3'
          ? (b.high + b.low + b.close) / 3
          : settings.source === 'ohlc4'
            ? (b.open + b.high + b.low + b.close) / 4
            : settings.source === 'hlcc4'
              ? (b.high + b.low + b.close * 2) / 4
              : b[settings.source]
    );

    for (let i = 1; i < n; i++) {
      changes[i] = source[i] - source[i - 1];
      gains[i] = Math.max(changes[i], 0);
      losses[i] = -Math.min(changes[i], 0);
    }

    const up = rma(gains, settings.length);
    const down = rma(losses, settings.length);
    const rsi = empty(n);

    for (let i = 0; i < n; i++) {
      if (Number.isFinite(up[i]) && Number.isFinite(down[i])) {
        rsi[i] =
          down[i] === 0
            ? 100
            : up[i] === 0
              ? 0
              : 100 - 100 / (1 + up[i] / down[i]);
      }
    }

    const ma = average(
      rsi,
      settings.maLength,
      settings.maType,
      bars.map(b => b.volume)
    );

    const upper = empty(n);
    const lower = empty(n);

    if (settings.maType === 'SMA + Bollinger Bands') {
      const stdev = standardDeviation(rsi, settings.maLength);

      for (let i = 0; i < n; i++) {
        upper[i] = ma[i] + stdev[i] * settings.bbMult;
        lower[i] = ma[i] - stdev[i] * settings.bbMult;
      }
    }

    return {
      rsi,
      ma,
      upper,
      lower,
      ...pivots(rsi, bars, settings),
      settings
    };
  }

  return {
    defaults,
    sources,
    maTypes,
    normalize,
    rma,
    average,
    standardDeviation,
    pivots,
    calculate
  };
})();

class RsiPanePrimitive {
  constructor(getState) {
    this.getState = getState;

    this.views = ['bottom', 'top'].map(layer => ({
      zOrder: () => layer,
      renderer: () => ({
        draw: target =>
          target.useMediaCoordinateSpace(scope => this.draw(scope, layer))
      })
    }));
  }

  attached(params) {
    this.chart = params.chart;
    this.series = params.series;
    this.requestUpdate = params.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.getState().visible ? this.views : [];
  }

  update() {
    this.requestUpdate?.();
  }

  draw({ context: ctx, mediaSize: { width, height } }, layer) {
    const state = this.getState();
    const cache = state.cache;
    const s = state.settings;

    if (!this.chart || !cache || !state.visible) {
      return;
    }

    const time = this.chart.timeScale();
    const range = time.getVisibleLogicalRange();

    if (!range) {
      return;
    }

    const start = Math.max(
      state.start,
      Math.floor(range.from) + state.start - 1
    );
    const end = Math.min(
      state.end - 1,
      Math.ceil(range.to) + state.start + 1
    );

    const x = i => time.logicalToCoordinate(i - state.start);
    const y = v => this.series.priceToCoordinate(v);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    if (layer === 'bottom') {
      if (s.showFill) {
        const top = y(70);
        const bottom = y(30);

        if (top !== null && bottom !== null) {
          ctx.fillStyle = '#7e57c21a';
          ctx.fillRect(0, Math.min(top, bottom), width, Math.abs(bottom - top));
        }
      }

      const fill = (a, b, color) => {
        let segment = [];

        const paint = () => {
          if (segment.length < 2) {
            segment = [];
            return;
          }

          ctx.beginPath();
          ctx.moveTo(segment[0][0], segment[0][1]);

          for (const p of segment) {
            ctx.lineTo(p[0], p[1]);
          }

          for (let j = segment.length - 1; j >= 0; j--) {
            ctx.lineTo(segment[j][0], segment[j][2]);
          }

          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          segment = [];
        };

        for (let i = start; i <= end; i++) {
          if (
            !Number.isFinite(a[i]) ||
            (typeof b !== 'number' && !Number.isFinite(b[i]))
          ) {
            paint();
            continue;
          }

          const px = x(i);
          const ay = y(a[i]);
          const by = y(typeof b === 'number' ? b : b[i]);

          if (px !== null && ay !== null && by !== null) {
            segment.push([px, ay, by]);
          }
        }

        paint();
      };

      if (s.showFill && s.showRsi) {
        const y100 = y(100);
        const y70 = y(70);
        const y30 = y(30);
        const y0 = y(0);

        if (
          [y100, y70, y30, y0].every(v => v !== null) &&
          y100 !== y70 &&
          y30 !== y0
        ) {
          const ob = ctx.createLinearGradient(0, y100, 0, y70);
          ob.addColorStop(0, '#4caf50');
          ob.addColorStop(1, '#4caf5000');
          fill(cache.rsi, 50, ob);

          const os = ctx.createLinearGradient(0, y30, 0, y0);
          os.addColorStop(0, '#ef444400');
          os.addColorStop(1, '#ef4444');
          fill(cache.rsi, 50, os);
        }
      }

      if (s.showFill && s.showBands && s.maType === 'SMA + Bollinger Bands') {
        fill(cache.upper, cache.lower, '#4caf501a');
      }
    } else {
      let lo = 0;
      let hi = cache.signals.length;

      while (lo < hi) {
        const m = (lo + hi) >>> 1;

        if (cache.signals[m].toIndex < start) {
          lo = m + 1;
        } else {
          hi = m;
        }
      }

      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let j = lo; j < cache.signals.length; j++) {
        const d = cache.signals[j];

        if (d.toIndex > end + 61) {
          break;
        }

        if (d.fromIndex > end) {
          continue;
        }

        if (d.type === 'bull' ? !s.showBull : !s.showBear) {
          continue;
        }

        const x1 = x(d.fromIndex);
        const x2 = x(d.toIndex);
        const y1 = y(d.fromValue);
        const y2 = y(d.value);

        if ([x1, x2, y1, y2].some(v => v === null)) {
          continue;
        }

        const color = d.type === 'bull' ? s.bullColor : s.bearColor;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (x2 < 0 || x2 > width || y2 < 0 || y2 > height) {
          continue;
        }

        const label = d.type === 'bull' ? 'Bull' : 'Bear';
        const labelY = d.type === 'bull' ? y2 + 15 : y2 - 15;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 4, d.type === 'bull' ? y2 + 6 : y2 - 6);
        ctx.lineTo(x2 + 4, d.type === 'bull' ? y2 + 6 : y2 - 6);
        ctx.closePath();
        ctx.fill();

        ctx.fillRect(x2 - 19, labelY - 9, 38, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x2, labelY);
      }
    }

    ctx.restore();
  }
}

class StudyPanelManager {
  constructor() {
    this.panels = new Map([
      ['price', {
        id: 'price',
        title: '가격',
        members: [candles],
        stretch: 6,
        active: true,
        hidden: false
      }],
      ['volume', {
        id: 'volume',
        title: '거래량',
        members: [volume],
        stretch: 1.5,
        active: true,
        hidden: false
      }],
      ['funding', {
        id: 'funding',
        title: '펀딩비 (%)',
        members: [funding],
        stretch: 2.5,
        active: true,
        hidden: false
      }],
      ['cycle', {
        id: 'cycle',
        title: '정산 주기 (시간)',
        members: [settlementCycle],
        stretch: 1.5,
        active: true,
        hidden: false
      }],
      ['rsi', {
        id: 'rsi',
        title: 'RSI Div',
        members: [],
        stretch: 3,
        active: false,
        hidden: false
      }]
    ]);

    this.order = ['price', 'volume', 'funding', 'cycle', 'rsi'];
    this.maximized = null;
    this.cache = null;
    this.cacheBars = null;
    this.cacheKey = '';
    this.settings = RsiEngine.normalize();
    this.storageKey = 'funding-chart-studies-v1';
    this.lastAlertTime = null;

    let saved = null;

    try {
      saved = JSON.parse(localStorage.getItem(this.storageKey));

      if (saved?.rsi) {
        this.settings = RsiEngine.normalize(saved.rsi);
      }
    } catch {}

    this.create('rsi');

    if (saved) {
      for (const [id, p] of this.panels) {
        const pref = saved.panels?.[id];

        if (!pref) {
          continue;
        }

        p.hidden = Boolean(pref.hidden);

        if (Number.isFinite(pref.stretch) && pref.stretch > 0) {
          p.stretch = pref.stretch;
        }

        if (id !== 'price' && pref.active === false) {
          this.remove(id, false);
        }
      }

      if (Array.isArray(saved.order)) {
        this.order = [
          ...new Set([
            ...saved.order.filter(id => this.panels.get(id)?.active),
            'price',
            ...this.order.filter(id => this.panels.get(id)?.active)
          ])
        ];
      }
    }

    this.layer = document.createElement('div');
    this.layer.className = 'panel-controls-layer';
    rulerHost.append(this.layer);

    this.headers = new Map();
    this.buildAddMenu();
    this.bindSettings();
    this.applyOrder();
    this.applyVisibility();
    this.refresh();

    document.addEventListener('pointerdown', e => {
      if (!e.target.closest?.('[data-panel-ui],#btnIndicators')) {
        this.closeMenus();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.closeMenus();

        if (this.maximized && !document.querySelector('dialog[open]')) {
          this.restoreMaximized();
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (!this.maximized) {
        this.save();
      }
    });

    rulerHost.addEventListener('pointermove', schedule);
  }

  primary(panel) {
    return panel?.members[0] || null;
  }

  // 메인(가격) 차트가 화면에 있고 감추기 상태인지 — 이때는 다른 패널의 버튼을 모두 숨기고
  // 메인 차트에는 '보이기' 버튼만 남깁니다.
  priceCollapsed() {
    const price = this.panels.get('price');

    if (!price?.hidden) {
      return false;
    }

    return chart.panes().some(pane => this.panelForPane(pane)?.id === 'price');
  }

  active() {
    return [...this.panels.values()].filter(p => p.active);
  }

  ordered() {
    return this.active().sort(
      (a, b) =>
        this.primary(a).getPane().paneIndex() -
        this.primary(b).getPane().paneIndex()
    );
  }

  panelForPane(pane) {
    if (this.maximized) {
      return this.panels.get(this.maximized.id);
    }

    const members = pane.getSeries();

    return this.active().find(p => members.includes(this.primary(p))) || null;
  }

  isVisible(panel) {
    return (
      panel.active &&
      !panel.hidden &&
      (!this.maximized || this.maximized.id === panel.id) &&
      (
        panel.id !== 'rsi' ||
        this.settings.timeframes.includes($('intervalSelect').value)
      )
    );
  }

  visibleMembers(panel) {
    const visible = this.isVisible(panel);
    const s = this.settings;

    return panel.members.map((_, i) =>
      visible &&
      (
        panel.id !== 'rsi' ||
        (
          i === 0
            ? s.showRsi
            : i === 1
              ? s.showMa && s.maType !== 'None'
              : s.showBands && s.maType === 'SMA + Bollinger Bands'
        )
      )
    );
  }

  syncPrimary() {
    paneScaleSeries = chart
      .panes()
      .map(p => this.primary(this.panelForPane(p)))
      .filter(Boolean);
  }

  create(id) {
    const p = this.panels.get(id);

    if (!p || p.active) {
      return;
    }

    const index = chart.panes().length;

    if (id === 'volume') {
      volume = chart.addSeries(
        LC.HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          lastValueVisible: false
        },
        index
      );

      p.members = [volume];
    }

    if (id === 'funding') {
      funding = chart.addSeries(
        LC.HistogramSeries,
        {
          priceFormat: {
            type: 'custom',
            minMove: .000001,
            formatter: v => v.toFixed(6) + '%'
          },
          lastValueVisible: false
        },
        index
      );

      funding.createPriceLine({
        price: 0,
        color: '#6b7280',
        lineWidth: 1,
        lineStyle: LC.LineStyle.Dotted,
        axisLabelVisible: false
      });

      p.members = [funding];
    }

    if (id === 'cycle') {
      settlementCycle = chart.addSeries(
        LC.HistogramSeries,
        {
          priceFormat: {
            type: 'custom',
            minMove: 1,
            formatter: v => Number(v.toFixed(2)) + '시간'
          },
          lastValueVisible: false,
          priceLineVisible: false
        },
        index
      );

      cycleMarkers = LC.createSeriesMarkers(settlementCycle, []);
      p.members = [settlementCycle];
    }

    if (id === 'rsi') {
      const options = {
        color: this.settings.rsiColor,
        lineWidth: this.settings.lineWidth,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: .01
        },
        priceLineVisible: false,
        crosshairMarkerVisible: true
      };

      const rsi = chart.addSeries(
        LC.LineSeries,
        {
          ...options,
          autoscaleInfoProvider: original => {
            const info = original();

            return info
              ? {
                  ...info,
                  priceRange: {
                    minValue: Math.min(0, info.priceRange.minValue),
                    maxValue: Math.max(100, info.priceRange.maxValue)
                  }
                }
              : null;
          }
        },
        index
      );

      const ma = chart.addSeries(
        LC.LineSeries,
        {
          ...options,
          color: this.settings.maColor,
          lastValueVisible: false
        },
        index
      );

      const upper = chart.addSeries(
        LC.LineSeries,
        {
          ...options,
          color: '#4caf50',
          lineWidth: 1,
          lastValueVisible: false
        },
        index
      );

      const lower = chart.addSeries(
        LC.LineSeries,
        {
          ...options,
          color: '#4caf50',
          lineWidth: 1,
          lastValueVisible: false
        },
        index
      );

      p.members = [rsi, ma, upper, lower];

      for (const level of [70, 50, 30]) {
        rsi.createPriceLine({
          price: level,
          color: level === 50 ? '#787b8680' : '#787b86',
          lineWidth: 1,
          lineStyle: LC.LineStyle.Dashed,
          axisLabelVisible: false
        });
      }

      p.primitive = new RsiPanePrimitive(() => ({
        cache: this.cache,
        settings: this.settings,
        start: windowStart,
        end: windowEnd,
        visible: this.isVisible(p)
      }));

      rsi.attachPrimitive(p.primitive);
    }

    p.active = true;
    this.primary(p).getPane().setStretchFactor(p.stretch);

    if (!this.order.includes(id)) {
      this.order.push(id);
    }
  }

  add(id) {
    this.restoreMaximized();
    this.create(id);
    this.applyOrder();
    this.applyVisibility();

    if (all.length) {
      renderWindow(
        (windowStart + windowEnd) / 2,
        false,
        240,
        this.absoluteRange()
      );
    }

    this.closeMenus();
    this.refresh();
    this.save();
    status(this.panels.get(id).title + ' 지표 추가');
  }

  remove(id, persist = true) {
    const p = this.panels.get(id);

    if (!p?.active || id === 'price') {
      return;
    }

    this.restoreMaximized();

    if (id === 'rsi' && p.primitive) {
      this.primary(p).detachPrimitive(p.primitive);
      p.primitive = null;
    }

    if (id === 'cycle') {
      cycleMarkers?.detach();
      cycleMarkers = null;
    }

    for (const member of p.members) {
      manualPriceSpans.delete(member);
      chart.removeSeries(member);
    }

    p.members = [];
    p.active = false;

    if (id === 'volume') volume = null;
    if (id === 'funding') funding = null;
    if (id === 'cycle') settlementCycle = null;

    this.order = this.order.filter(v => v !== id);
    this.headers?.get(id)?.remove();
    this.headers?.delete(id);

    this.refresh();

    if (persist) {
      this.closeMenus();
      this.save();
      status(p.title + ' 지표 삭제 · 상단 지표 버튼에서 다시 추가할 수 있습니다.');
    }
  }

  absoluteRange() {
    const r = chart.timeScale().getVisibleLogicalRange();

    return r
      ? {
          from: r.from + windowStart,
          to: r.to + windowStart
        }
      : null;
  }

  applyOrder() {
    if (this.orderFrame) {
      return;
    }

    this.orderFrame = requestAnimationFrame(() => {
      this.orderFrame = 0;

      if (this.maximized) {
        return;
      }

      this.order
        .filter(id => this.panels.get(id)?.active)
        .forEach((id, i) => {
          this.primary(this.panels.get(id)).getPane().moveTo(i);
        });

      this.refresh();
    });
  }

  move(id, direction) {
    this.restoreMaximized();

    const ids = this.order.filter(v => this.panels.get(v)?.active);
    const from = ids.indexOf(id);
    const to =
      direction === 'top'
        ? 0
        : direction === 'bottom'
          ? ids.length - 1
          : Math.max(
              0,
              Math.min(
                ids.length - 1,
                from + (direction === 'up' ? -1 : 1)
              )
            );

    if (from < 0 || from === to) {
      return;
    }

    ids.splice(from, 1);
    ids.splice(to, 0, id);
    this.order = ids;
    this.applyOrder();
    this.refresh();
    this.closeMenus();
    this.save();
  }

  captureScale(p) {
    const series = this.primary(p);
    series.coordinateToPrice(0);

    const scale = series.priceScale();

    return {
      range: scale.getVisibleRange(),
      options: {
        ...scale.options(),
        scaleMargins: {
          ...scale.options().scaleMargins
        }
      },
      stretch: series.getPane().getStretchFactor()
    };
  }

  maximize(id) {
    if (this.maximized) {
      const same = this.maximized.id === id;
      this.restoreMaximized();

      if (same) {
        return;
      }
    }

    const p = this.panels.get(id);

    if (!p?.active) {
      return;
    }

    const states = new Map(
      this.active().map(item => [item.id, this.captureScale(item)])
    );

    this.maximized = {
      id,
      states,
      order: this.order.filter(v => this.panels.get(v)?.active)
    };

    for (const other of this.active()) {
      if (other.id !== id) {
        for (const member of other.members) {
          member.applyOptions({
            visible: false,
            priceScaleId: 'park-' + other.id
          });
          member.moveToPane(this.primary(p).getPane().paneIndex());
        }
      }
    }

    this.primary(p).getPane().setStretchFactor(1);
    this.closeMenus();
    this.refresh();
    p.primitive?.update();
    schedule();
  }

  restoreMaximized() {
    const saved = this.maximized;

    if (!saved) {
      return;
    }

    this.maximized = null;

    for (const id of saved.order) {
      const p = this.panels.get(id);
      const state = saved.states.get(id);

      if (!p?.active) {
        continue;
      }

      if (id !== saved.id) {
        const pane = chart.addPane(true);

        for (const member of p.members) {
          member.moveToPane(pane.paneIndex());
          member.applyOptions({
            priceScaleId: 'right'
          });
        }

        pane.setPreserveEmptyPane(false);

        const scale = this.primary(p).priceScale();
        scale.applyOptions(state.options);

        if (!state.options.autoScale && state.range) {
          scale.setVisibleRange(state.range);
        }
      }

      this.primary(p).getPane().setStretchFactor(state.stretch);
    }

    this.order = saved.order;
    this.applyOrder();
    this.applyVisibility();
    this.refresh();
    schedule();
  }

  toggleHidden(id) {
    const p = this.panels.get(id);
    p.hidden = !p.hidden;
    this.closeMenus();
    this.applyVisibility();
    this.refresh();
    this.save();
  }

  applyVisibility() {
    for (const p of this.active()) {
      const flags = this.visibleMembers(p);
      p.members.forEach((member, i) => {
        member.applyOptions({
          visible: flags[i]
        });
      });
      p.primitive?.update();
    }
  }

  resetAxis(id) {
    const p = this.panels.get(id);

    if (!p?.active) {
      return;
    }

    resetCustomPriceRange(this.primary(p));
    schedule();
  }

  ensureCache() {
    const s = this.settings;
    const key = JSON.stringify([
      s.length,
      s.source,
      s.divergence,
      s.overbought,
      s.oversold,
      s.maType,
      s.maLength,
      s.bbMult
    ]);

    if (this.cacheBars === all && this.cacheKey === key) {
      return;
    }

    this.cache = RsiEngine.calculate(all, s);
    this.cacheBars = all;
    this.cacheKey = key;

    const latestTime = all.at(-1)?.time;

    if (s.alerts && this.lastAlertTime !== null) {
      const fresh = this.cache.signals.filter(
        d => d.confirmedTime > this.lastAlertTime
      );
      const newest = fresh.at(-1);

      if (newest) {
        status(
          'RSI ' +
          (newest.type === 'bull' ? 'Bull' : 'Bear') +
          ' 다이버전스 확인 · ' +
          date(newest.confirmedTime)
        );
      }
    }

    this.lastAlertTime = latestTime ?? null;
  }

  render(part) {
    const p = this.panels.get('rsi');

    if (!p.active) {
      return;
    }

    this.ensureCache();

    const arrays = [
      this.cache.rsi,
      this.cache.ma,
      this.cache.upper,
      this.cache.lower
    ];

    p.members.forEach((series, k) => {
      series.setData(
        part.map((bar, i) =>
          Number.isFinite(arrays[k][windowStart + i])
            ? {
                time: bar.time,
                value: arrays[k][windowStart + i]
              }
            : {
                time: bar.time
              }
        )
      );
    });

    this.applyVisibility();
    p.primitive.update();
    this.updateLegend();
  }

  clearData() {
    this.cache = null;
    this.cacheBars = null;

    const context = [
      $('exchangeSelect').value,
      $('symbolInput').value.toUpperCase(),
      $('intervalSelect').value
    ].join(':');

    if (this.alertContext !== context) {
      this.lastAlertTime = null;
    }

    this.alertContext = context;

    for (const p of this.active()) {
      for (const member of p.members) {
        member.setData([]);
      }
    }

    this.refresh();
  }

  updateLegend(time = null) {
    const p = this.panels.get('rsi');
    const header = this.headers?.get('rsi');

    if (!p.active || !header) {
      return;
    }

    const index =
      time === null
        ? all.length - 1
        : lowerBound(all, Number(time));

    const rsi = this.cache?.rsi[index];
    const ma = this.cache?.ma[index];
    const s = this.settings;
    const values = header.querySelector('.panel-values');

    const valueText = Number.isFinite(rsi)
      ? rsi.toFixed(2) +
        (Number.isFinite(ma) && s.maType !== 'None'
          ? ' / ' + ma.toFixed(2)
          : '')
      : '계산 대기';

    // 값이 바뀔 때만 DOM에 씀 (크로스헤어 이동마다 불필요한 스타일 재계산 방지)
    if (values.textContent !== valueText) {
      values.textContent = valueText;
    }

    const titleEl = header.querySelector('.panel-title');
    const titleText = `RSI Div ${s.length} ${s.source} ${s.overbought} ${s.oversold}`;

    if (titleEl.textContent !== titleText) {
      titleEl.textContent = titleText;
    }
  }

  button(action, title, icon, callback) {
    const b = document.createElement('button');

    b.type = 'button';
    b.dataset.panelAction = action;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = StudyPanelManager.icons[icon];

    b.onclick = e => {
      e.stopPropagation();
      callback();
    };

    return b;
  }

  header(p) {
    const header = document.createElement('div');
    header.className = 'pane-header';
    header.dataset.panelUi = 'true';
    header.dataset.panelId = p.id;

    const left = document.createElement('div');
    left.className = 'pane-header-left';

    const title = document.createElement('button');
    title.className = 'panel-title';
    title.type = 'button';
    title.textContent = p.title;
    title.title = p.id === 'rsi' ? 'RSI 설정' : '패널 설정';
    title.ondblclick = () => this.openSettings(p.id);
    left.append(title);

    const values = document.createElement('span');
    values.className = 'panel-values';
    left.append(values);

    const tools = document.createElement('span');
    tools.className = 'pane-tools';

    tools.append(
      this.button(
        'hide',
        '지표 숨기기 / 보이기',
        'eye',
        () => this.toggleHidden(p.id)
      ),
      this.button(
        'settings',
        '설정',
        'gear',
        () => this.openSettings(p.id)
      )
    );

    if (p.id !== 'price') {
      tools.append(
        this.button(
          'remove',
          '지표 삭제',
          'trash',
          () => this.remove(p.id)
        )
      );
    }

    tools.append(
      this.button(
        'more',
        '패널 메뉴',
        'more',
        () => this.openMenu(p.id, header)
      )
    );

    left.append(tools);
    header.append(left);

    const right = document.createElement('div');
    right.className = 'pane-move-tools';

    right.append(
      this.button(
        'up',
        '패널을 위로 이동',
        'up',
        () => this.move(p.id, 'up')
      ),
      this.button(
        'down',
        '패널을 아래로 이동',
        'down',
        () => this.move(p.id, 'down')
      ),
      this.button(
        'maximize',
        '패널 최대화 / 복원',
        'maximize',
        () => this.maximize(p.id)
      )
    );

    header.append(right);

    for (const type of ['pointerdown', 'dblclick', 'wheel']) {
      header.addEventListener(type, e => e.stopPropagation());
    }

    this.layer.append(header);
    this.headers.set(p.id, header);

    return header;
  }

  refresh() {
    this.syncPrimary();

    if (!this.layer) {
      return;
    }

    for (const p of this.active()) {
      if (!this.headers.has(p.id)) {
        this.header(p);
      }
    }

    this.position();
    this.updateLegend();
    this.renderAddMenu();
    schedule();
  }

  position() {
    if (!this.layer) {
      return;
    }

    const layout = getPaneLayout();
    const visibleIds = new Set();
    const collapsed = this.priceCollapsed();

    for (const item of layout) {
      const p = this.panelForPane(chart.panes()[item.index]);

      if (!p) {
        continue;
      }

      // 메인 차트 감추기 중에는 다른 패널의 버튼(헤더) 전체를 보이지 않게 함
      if (collapsed && p.id !== 'price') {
        continue;
      }

      visibleIds.add(p.id);

      const h = this.headers.get(p.id);

      if (!h) {
        continue;
      }

      const index = layout.findIndex(v => v.index === item.index);
      const top = item.top + 4 + 'px';
      const width = Math.max(0, chart.timeScale().width() - 12) + 'px';
      const isPriceCollapsed = collapsed && p.id === 'price';
      const studyHidden = !this.isVisible(p);
      const isMax = this.maximized?.id === p.id;
      const upDisabled = !this.maximized && index === 0;
      const downDisabled = !this.maximized && index === layout.length - 1;

      // 화면에 영향을 주는 값이 하나도 안 바뀌었으면 DOM을 건드리지 않음 (줌/스크롤 중 매 프레임 스타일 재계산 방지)
      const sig = [top, width, hoveredPaneIndex === item.index, isMax, isPriceCollapsed, studyHidden, upDisabled, downDisabled].join('|');

      if (h.__posSig === sig && !h.hidden) {
        continue;
      }

      h.__posSig = sig;
      h.hidden = false;
      h.classList.toggle('pane-hover', hoveredPaneIndex === item.index);
      h.classList.toggle('pane-maximized', isMax);
      h.classList.toggle('price-collapsed', isPriceCollapsed);
      h.querySelector('[data-panel-action="hide"]').title =
        isPriceCollapsed ? '메인 차트 보이기' : '지표 숨기기 / 보이기';
      h.style.top = top;
      h.style.width = width;
      h.classList.toggle('study-hidden', studyHidden);
      h.querySelector('[data-panel-action="hide"]').setAttribute(
        'aria-pressed',
        String(studyHidden)
      );
      h.querySelector('[data-panel-action="maximize"]').setAttribute(
        'aria-pressed',
        String(isMax)
      );
      h.querySelector('[data-panel-action="up"]').disabled = upDisabled;
      h.querySelector('[data-panel-action="down"]').disabled = downDisabled;
    }

    for (const [id, h] of this.headers) {
      if (!visibleIds.has(id)) {
        h.hidden = true;
        h.__posSig = null;
      }
    }
  }

  openMenu(id, header) {
    this.closeMenus();

    const p = this.panels.get(id);
    const menu = document.createElement('div');

    menu.className = 'panel-menu';
    menu.dataset.panelUi = 'true';
    menu.dataset.panelMenu = id;

    for (const [label, fn] of [
      ['맨 위로 이동', () => this.move(id, 'top')],
      ['맨 아래로 이동', () => this.move(id, 'bottom')],
      ['가격축 자동 정렬', () => this.resetAxis(id)],
      ['패널 최대화 / 복원', () => this.maximize(id)],
      [p.hidden ? '보이기' : '숨기기', () => this.toggleHidden(id)]
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        fn();
        this.closeMenus();
      };
      menu.append(b);
    }

    if (id !== 'price') {
      const b = document.createElement('button');
      b.textContent = '지표 삭제';
      b.className = 'danger';
      b.onclick = () => this.remove(id);
      menu.append(b);
    }

    const r = header.getBoundingClientRect();
    menu.style.left = Math.min(r.left + 140, innerWidth - 200) + 'px';
    menu.style.top = Math.min(r.bottom + 4, innerHeight - 240) + 'px';

    document.body.append(menu);
    this.menu = menu;
    menu.querySelector('button').focus();
  }

  closeMenus() {
    this.menu?.remove();
    this.menu = null;

    if (this.addMenu) {
      this.addMenu.hidden = true;
    }

    $('btnIndicators')?.setAttribute('aria-expanded', 'false');
  }

  buildAddMenu() {
    this.addMenu = document.createElement('div');
    this.addMenu.className = 'panel-menu indicator-add-menu';
    this.addMenu.dataset.panelUi = 'true';
    this.addMenu.hidden = true;
    document.body.append(this.addMenu);

    $('btnIndicators').onclick = () => {
      const open = this.addMenu.hidden;
      this.closeMenus();

      if (open) {
        this.renderAddMenu();

        const r = $('btnIndicators').getBoundingClientRect();
        this.addMenu.style.left = Math.min(r.left, innerWidth - 250) + 'px';
        this.addMenu.style.top = r.bottom + 6 + 'px';
        this.addMenu.hidden = false;
        $('btnIndicators').setAttribute('aria-expanded', 'true');
      }
    };
  }

  renderAddMenu() {
    if (!this.addMenu) {
      return;
    }

    this.addMenu.replaceChildren();

    const heading = document.createElement('strong');
    heading.textContent = '지표 추가 / 관리';
    this.addMenu.append(heading);

    for (const p of this.panels.values()) {
      if (p.id === 'price') {
        continue;
      }

      const b = document.createElement('button');
      b.textContent = (p.active ? '✓ ' : '＋ ') + p.title + (p.active ? ' · 추가됨' : '');
      b.disabled = p.active;
      b.onclick = () => this.add(p.id);
      this.addMenu.append(b);
    }
  }

  save() {
    const panels = {};

    for (const p of this.panels.values()) {
      if (p.active && !this.maximized) {
        p.stretch = this.primary(p).getPane().getStretchFactor();
      }

      panels[p.id] = {
        active: p.active,
        hidden: p.hidden,
        stretch: p.stretch
      };
    }

    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          order: this.order,
          panels,
          rsi: this.settings
        })
      );
    } catch {}
  }

  openSettings(id) {
    this.closeMenus();
    this.settingsPanel = id;

    if (id === 'rsi') {
      const form = $('rsiSettingsForm');

      for (const [key, value] of Object.entries(this.settings)) {
        const input = form.elements.namedItem(key);

        if (!input) {
          continue;
        }

        if (input.type === 'checkbox') {
          input.checked = value;
        } else {
          input.value = value;
        }
      }

      for (const input of form.querySelectorAll('[name="timeframes"]')) {
        input.checked = this.settings.timeframes.includes(input.value);
      }

      this.switchSettingsTab('inputs');
      this.updateMaInputs();
      $('rsi-settings-error').textContent = '';
      $('rsiSettingsDialog').showModal();
    } else {
      const scale = this.primary(this.panels.get(id)).priceScale();

      $('axisSettingsTitle').textContent =
        this.panels.get(id).title + ' · 가격축 설정';
      $('axisAuto').checked = scale.options().autoScale;
      $('axisInvert').checked = scale.options().invertScale;
      $('axisSettingsDialog').showModal();
    }
  }

  switchSettingsTab(tab) {
    for (const b of $('rsiSettingsDialog').querySelectorAll('[data-settings-tab]')) {
      b.setAttribute(
        'aria-selected',
        String(b.dataset.settingsTab === tab)
      );
    }

    for (const body of $('rsiSettingsDialog').querySelectorAll('[data-settings-body]')) {
      body.hidden = body.dataset.settingsBody !== tab;
    }
  }

  updateMaInputs() {
    const type = $('rsiSettingsForm').elements.maType.value;
    $('rsiSettingsForm').elements.maLength.disabled = type === 'None';
    $('rsiSettingsForm').elements.bbMult.disabled =
      type !== 'SMA + Bollinger Bands';
  }

  bindSettings() {
    for (const b of document.querySelectorAll('[data-close-dialog]')) {
      b.onclick = () => $(b.dataset.closeDialog).close();
    }

    for (const b of $('rsiSettingsDialog').querySelectorAll('[data-settings-tab]')) {
      b.onclick = () => this.switchSettingsTab(b.dataset.settingsTab);
    }

    $('rsiSettingsForm').elements.maType.onchange = () =>
      this.updateMaInputs();

    $('rsiDefaults').onclick = () => {
      const old = this.settings;
      this.settings = RsiEngine.normalize();
      const form = $('rsiSettingsForm');

      for (const [key, value] of Object.entries(this.settings)) {
        const input = form.elements.namedItem(key);

        if (!input) {
          continue;
        }

        if (input.type === 'checkbox') {
          input.checked = value;
        } else {
          input.value = value;
        }
      }

      for (const input of form.querySelectorAll('[name="timeframes"]')) {
        input.checked = true;
      }

      this.settings = old;
      this.updateMaInputs();
    };

    $('rsiSettingsForm').onsubmit = e => {
      e.preventDefault();

      const f = e.currentTarget;
      const next = { ...this.settings };

      for (const key of [
        'length',
        'maLength',
        'overbought',
        'oversold',
        'bbMult',
        'lineWidth'
      ]) {
        next[key] = Number(f.elements.namedItem(key).value);
      }

      for (const key of [
        'source',
        'maType',
        'rsiColor',
        'maColor',
        'bullColor',
        'bearColor'
      ]) {
        next[key] = f.elements.namedItem(key).value;
      }

      for (const key of [
        'divergence',
        'showRsi',
        'showMa',
        'showBands',
        'showFill',
        'showBull',
        'showBear',
        'alerts'
      ]) {
        next[key] = f.elements.namedItem(key).checked;
      }

      next.timeframes = [
        ...f.querySelectorAll('[name="timeframes"]:checked')
      ].map(input => input.value);

      try {
        this.settings = RsiEngine.normalize(next);
      } catch (error) {
        $('rsi-settings-error').textContent = error.message;
        return;
      }

      const p = this.panels.get('rsi');

      if (p.active) {
        p.members[0].applyOptions({
          color: this.settings.rsiColor,
          lineWidth: this.settings.lineWidth
        });
        p.members[1].applyOptions({
          color: this.settings.maColor
        });
        this.render(all.slice(windowStart, windowEnd));
      }

      this.applyVisibility();
      this.refresh();
      this.save();
      $('rsiSettingsDialog').close();
    };

    $('axisSettingsForm').onsubmit = e => {
      e.preventDefault();

      const p = this.panels.get(this.settingsPanel);

      if (p?.active) {
        const series = this.primary(p);

        if ($('axisAuto').checked) {
          resetCustomPriceRange(series);
        }

        series.priceScale().applyOptions({
          autoScale: $('axisAuto').checked,
          invertScale: $('axisInvert').checked
        });
      }

      schedule();
      $('axisSettingsDialog').close();
    };
  }
}

StudyPanelManager.icons = Object.fromEntries(
  Object.entries({
    eye: '<path d="M2 8s4-5 6-5 6 5 6 5-4 5-6 5-6-5-6-5Z"/><circle cx="8" cy="8" r="2"/>',
    gear: '<path d="m6 2-1 2-2 1-1 2 1 3 2 1 1 2h3l1-2 2-1 1-3-1-2-2-1-1-2Z"/><circle cx="7.5" cy="7.5" r="2"/>',
    trash: '<path d="M3 4h10M6 2h4M4 4l1 10h6l1-10M7 6v5M9 6v5"/>',
    up: '<path d="m4 9 4-4 4 4M8 5v8"/>',
    down: '<path d="m4 7 4 4 4-4M8 3v8"/>',
    maximize: '<path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
    more: '<circle cx="3" cy="8" r=".7"/><circle cx="8" cy="8" r=".7"/><circle cx="13" cy="8" r=".7"/>'
  }).map(([key, path]) => [
    key,
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
      path +
      '</svg>'
  ])
);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RsiEngine;
}