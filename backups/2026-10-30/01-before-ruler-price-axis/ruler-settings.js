(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RulerSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = Object.freeze({ up: '#3b82f6', down: '#ef4444' });
  const storageKey = 'funding-chart-ruler-colors-v1';
  const lockKey = 'funding-chart-ruler-locked-v1';
  const valid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
  const normalize = value => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, valid(value?.[key]) ? value[key].trim().toLowerCase() : fallback]));
  function colorFor(start, end, colors) {
    const value = normalize(colors);
    return end < start ? value.down : value.up;
  }
  function create(storage) {
    if (storage === undefined) {
      try { storage = localStorage; } catch { storage = null; }
    }
    let saved;
    try { saved = JSON.parse(storage?.getItem(storageKey)); } catch {}
    let colors = normalize(saved), dialog = null, locked = true, draftLocked = true;
    try { locked = storage?.getItem(lockKey) !== 'false'; } catch {}
    const listeners = new Set();
    const api = {
      get: () => ({ ...colors }),
      isLocked: () => locked,
      setLocked(value) {
        if (typeof value !== 'boolean') return false;
        locked = value;
        try { storage?.setItem(lockKey, String(locked)); api.saved = true; } catch { api.saved = false; }
        for (const listener of listeners) listener(api.get());
        return true;
      },
      color: (start, end) => colorFor(start, end, colors),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      set(next) {
        if (!valid(next?.up) || !valid(next?.down)) return false;
        colors = normalize(next);
        try { storage?.setItem(storageKey, JSON.stringify(colors)); api.saved = true; }
        catch { api.saved = false; }
        for (const listener of listeners) listener(api.get());
        return true;
      },
      saved: true,
      open() {
        if (!dialog) return;
        fillForm(colors);
        dialog.querySelector('[role="status"]').textContent = '';
        if (!dialog.open) dialog.showModal();
      },
      bind({ workspace, buttonAfter, onChange, onStatus }) {
        if (dialog) return;
        if (onChange) api.subscribe(onChange);
        dialog = document.createElement('dialog');
        dialog.id = 'rulerColorsDialog';
        dialog.className = 'drawing-settings-dialog';
        dialog.dataset.drawingUi = 'true';
        dialog.setAttribute('aria-labelledby', 'rulerColorsTitle');
        dialog.innerHTML = '<form id="rulerColorsForm" method="dialog">' +
          '<div class="drawing-dialog-heading"><h2 id="rulerColorsTitle">줄자 설정</h2><button type="button" data-close aria-label="줄자 설정 닫기">×</button></div>' +
          '<p class="ruler-colors-description">측정한 가격의 상승·하락 방향에 따라 적용됩니다.</p>' +
          '<label for="rulerUpColor">상승 측정 색상</label><div class="ruler-color-row"><input type="color" id="rulerUpColor" data-picker="up" aria-label="상승 측정 색상"><input type="text" id="rulerUpHex" name="up" maxlength="7" spellcheck="false" aria-label="상승 색상 코드"></div>' +
          '<label for="rulerDownColor">하락 측정 색상</label><div class="ruler-color-row"><input type="color" id="rulerDownColor" data-picker="down" aria-label="하락 측정 색상"><input type="text" id="rulerDownHex" name="down" maxlength="7" spellcheck="false" aria-label="하락 색상 코드"></div>' +
          '<div class="ruler-lock-row"><span>측정값 이동</span><button type="button" id="rulerLockToggle" aria-pressed="true">측정값 고정</button></div><p class="ruler-colors-description">고정하면 측정값과 끝점을 드래그해도 바뀌지 않습니다. 고정 해제 후 옮길 수 있습니다.</p>' +
          '<p class="drawing-form-error" role="status"></p><div class="drawing-dialog-actions"><button type="button" data-defaults>기본값</button><button type="button" data-cancel>취소</button><button type="submit">적용</button></div></form>';
        workspace.append(dialog);
        for (const type of ['pointerdown', 'dblclick', 'wheel']) dialog.addEventListener(type, event => event.stopPropagation());
        dialog.querySelector('[data-close]').onclick = dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
        dialog.querySelector('[data-defaults]').onclick = () => { fillForm(defaults); draftLocked = true; showLock(); };
        dialog.querySelector('#rulerLockToggle').onclick = () => { draftLocked = !draftLocked; showLock(); };
        for (const key of ['up', 'down']) {
          const picker = dialog.querySelector('[data-picker="' + key + '"]');
          const hex = dialog.querySelector('[name="' + key + '"]');
          picker.oninput = () => { hex.value = picker.value; };
          hex.oninput = () => { if (valid(hex.value)) picker.value = hex.value.trim(); };
        }
        dialog.querySelector('form').onsubmit = event => {
          event.preventDefault();
          const next = Object.fromEntries(new FormData(event.currentTarget));
          if (!api.set(next)) {
            dialog.querySelector('[role="status"]').textContent = '색상 코드를 #3b82f6 형식으로 입력하세요.';
            return;
          }
          api.setLocked(draftLocked);
          dialog.close();
          if (!api.saved) onStatus?.('색상은 적용됐지만 브라우저 저장 공간에 저장하지 못했습니다.', true);
        };
        if (buttonAfter) {
          const button = document.createElement('button');
          button.id = 'rulerColorSettingsBtn';
          button.type = 'button';
          button.className = 'btn-toggle ruler-colors-button';
          button.dataset.drawingUi = 'true';
          button.title = '줄자 설정';
          button.setAttribute('aria-label', button.title);
          button.textContent = '🎨';
          button.onclick = api.open;
          buttonAfter.after(button);
        }
      }
    };
    function fillForm(value) {
      for (const key of ['up', 'down']) {
        dialog.querySelector('[data-picker="' + key + '"]').value = value[key];
        dialog.querySelector('[name="' + key + '"]').value = value[key];
      }
      draftLocked = locked;
      showLock();
    }
    function showLock() { const button=dialog.querySelector('#rulerLockToggle');button.setAttribute('aria-pressed',String(draftLocked));button.textContent=draftLocked?'측정값 고정':'측정값 고정 해제'; }
    return api;
  }
  return { defaults, storageKey, valid, normalize, colorFor, create };
});
