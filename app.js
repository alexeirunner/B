/* ВЭФ 2025 — Инвентарь (PWA, fixed) */
(() => {
  'use strict';

  const APP_VERSION = '1.3.1';

  const idb = {
    _db: null,
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('vef2025-db', 5);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if(!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { keyPath: 'id' });
          if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
          if(!db.objectStoreNames.contains('comments')) db.createObjectStore('comments', { keyPath: 'objectName' });
        };
        req.onsuccess = () => { idb._db = req.result; resolve(); };
        req.onerror = () => reject(req.error);
      });
    },
    put(store, value) {
      return new Promise((resolve, reject) => {
        const tx = idb._db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
    getAll(store){
      return new Promise((resolve, reject) => {
        const tx = idb._db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    get(store, key){
      return new Promise((resolve, reject) => {
        const tx = idb._db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    clear(store){
      return new Promise((resolve, reject) => {
        const tx = idb._db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  // State
  let HEADERS = [];
  let OBJECT_COL = null;
  let ROWS = [];
  let FILTER_OBJ = '';

  // DOM
  const $ = (sel) => document.querySelector(sel);
  const objectsEl = $('#objects');
  const theadEl = $('#thead');
  const tbodyEl = $('#tbody');
  const searchEl = $('#search');
  const filterEl = $('#filter');
  const btnInstall = $('#btn-install');
  const btnExport = $('#btn-export');
  const fileImport = $('#file-import');
  const btnClearCache = $('#btn-clear-cache');
  const btnAddRow = $('#btn-add-row');
  const btnAddCol = document.getElementById('btn-add-col');
  const btnRenameCol = document.getElementById('btn-rename-col');
  const btnDelCol = document.getElementById('btn-del-col');
  const btnViewToggle = document.getElementById('btn-view-toggle');
  const btnObjectCol = document.getElementById('btn-object-col');

  function escapeHtml(s){
    const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#039;'};
    return String(s).replace(/[&<>"']/g, (m) => map[m]);
  }
  function cssId(text){ return text.replace(/[^\w\-]+/g, '_'); }

  async function saveHeaders(){
    await idb.put('meta', { key: 'headers', value: HEADERS });
    await idb.put('meta', { key: 'object_col', value: OBJECT_COL });
  }

  function ensureSerialColumn(){
    const colName = 'Серийный номер';
    if(!HEADERS.includes(colName)){
      HEADERS.push(colName);
      for(const r of ROWS){ r[colName] = r[colName] ?? ''; }
      saveHeaders();
    }
  }

  async function addColumn(){
    const name = prompt('Название нового столбца:', 'Серийный номер');
    if(!name) return;
    if(HEADERS.includes(name)){ alert('Столбец с таким именем уже существует.'); return; }
    HEADERS.push(name);
    for(const r of ROWS){ r[name] = ''; await idb.put('rows', { id: r.id, payload: r }); }
    await saveHeaders();
    renderTable();
  }

  async function renameColumn(){
    const from = prompt('Какой столбец переименовать? Укажите точное имя:', HEADERS[0] || '');
    if(!from || !HEADERS.includes(from)) { alert('Столбец не найден.'); return; }
    const to = prompt(`Новое имя для столбца "${from}":`, from);
    if(!to || to === from) return;
    if(HEADERS.includes(to)) { alert('Столбец с таким именем уже есть.'); return; }
    HEADERS = HEADERS.map(h => h === from ? to : h);
    if(OBJECT_COL === from) OBJECT_COL = to;
    for(const r of ROWS){ r[to] = r[from]; delete r[from]; await idb.put('rows', { id: r.id, payload: r }); }
    await saveHeaders();
    renderObjects();
    renderTable();
  }

  async function deleteColumn(){
    const name = prompt('Какой столбец удалить? Укажите точное имя:');
    if(!name || !HEADERS.includes(name)) { alert('Столбец не найден.'); return; }
    if(name === OBJECT_COL){ alert('Нельзя удалить столбец объектов.'); return; }
    if(!confirm(`Удалить столбец "${name}" безвозвратно?`)) return;
    HEADERS = HEADERS.filter(h => h !== name);
    for(const r of ROWS){ delete r[name]; await idb.put('rows', { id: r.id, payload: r }); }
    await saveHeaders();
    renderTable();
  }

  // PWA install
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btnInstall.classList.remove('hidden');
  });
  btnInstall.addEventListener('click', async () => {
    if(deferredPrompt){
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btnInstall.classList.add('hidden');
    } else {
      alert('Если кнопка скрыта — приложение уже установлено или не поддерживается.');
    }
  });

  // Load data
  async function loadInitialData(){
    await idb.open();
    const existingRows = await idb.getAll('rows');
    const metaVersion = await idb.get('meta', 'app_version');

    if(existingRows.length && metaVersion && metaVersion.value === '1.3.1'){
      const metaHeaders = await idb.get('meta', 'headers');
      const metaObjectCol = await idb.get('meta', 'object_col');
      HEADERS = metaHeaders?.value || [];
      OBJECT_COL = metaObjectCol?.value || HEADERS[0];
      ROWS = existingRows.map(x => x.payload);
    } else {
      const res = await fetch('data.json');
      if(!res.ok) throw new Error('Не удалось загрузить data.json');
      const DATA = await res.json();
      HEADERS = DATA.headers && DATA.headers.length ? DATA.headers : Object.keys(DATA.rows?.[0] || {});
      OBJECT_COL = DATA.objectColumn || HEADERS[0];
      ROWS = (DATA.rows || []).map((r) => ({ id: crypto.randomUUID(), ...r }));
      await idb.clear('rows');
      for(const row of ROWS){ await idb.put('rows', { id: row.id, payload: row }); }
      await idb.put('meta', { key: 'headers', value: HEADERS });
      await idb.put('meta', { key: 'object_col', value: OBJECT_COL });
      await idb.put('meta', { key: 'app_version', value: '1.3.1' });
    }
  }

  function uniqueObjects(){
    const map = new Map();
    for(const r of ROWS){
      const key = String(r[OBJECT_COL] ?? '').trim() || '(без объекта)';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].map(([name,count]) => ({name,count})).sort((a,b)=> a.name.localeCompare(b.name,'ru'));
  }

  function renderObjects(list = uniqueObjects()){
    const q = (searchEl.value || '').toLowerCase();
    objectsEl.innerHTML = '';
    for(const obj of list){
      if(q && !obj.name.toLowerCase().includes(q)) continue;
      const div = document.createElement('div');
      div.className = 'card-object';
      div.dataset.name = obj.name;
      div.innerHTML = `
        <div class="title">${escapeHtml(obj.name)}</div>
        <div class="meta">
          <span class="badge">${obj.count}</span>
          <span class="small">Комментарий: <span class="small" id="cm-${cssId(obj.name)}">(загрузка…)</span></span>
        </div>
      `;
      div.addEventListener('click', () => { FILTER_OBJ = obj.name; renderTable(); });
      div.addEventListener('contextmenu', (e) => { e.preventDefault(); openComments(obj.name); });
      objectsEl.appendChild(div);
      // load comment preview
      idb.get('comments', obj.name).then(rec => {
        const el = document.getElementById(`cm-${cssId(obj.name)}`);
        if(el) el.textContent = rec?.text ? rec.text.slice(0, 64) + (rec.text.length>64?'…':'') : '(нет)';
      });
    }
  }

  function renderTable(){
    theadEl.innerHTML = '<tr>' + HEADERS.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';
    const filter = (filterEl.value || '').toLowerCase();
    const rows = ROWS.filter(r => {
      if(FILTER_OBJ && String(r[OBJECT_COL] ?? '').trim() !== FILTER_OBJ) return false;
      if(!filter) return true;
      return HEADERS.some(h => String(r[h] ?? '').toLowerCase().includes(filter));
    });
    tbodyEl.innerHTML = '';
    for(const r of rows){
      const tr = document.createElement('tr');
      for(const h of HEADERS){
        const td = document.createElement('td');
        td.textContent = r[h] ?? '';
        td.dataset.rowId = r.id;
        td.dataset.col = h;
        td.addEventListener('dblclick', () => editCell(td));
        tr.appendChild(td);
      }
      tbodyEl.appendChild(tr);
    }
  }

  async function saveRowChange(rowId, col, value){
    const idx = ROWS.findIndex(r => r.id === rowId);
    if(idx>=0){
      ROWS[idx] = { ...ROWS[idx], [col]: value };
      await idb.put('rows', { id: rowId, payload: ROWS[idx] });
    }
  }

  function editCell(td){
    const rowId = td.dataset.rowId;
    const col = td.dataset.col;
    const oldValue = td.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldValue;
    input.style.width = '100%';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newValue = input.value;
      td.removeChild(input);
      td.textContent = newValue;
      await saveRowChange(rowId, col, newValue);
    };

    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ commit(); }
      if(e.key === 'Escape'){ td.removeChild(input); td.textContent = oldValue; }
    });
    input.addEventListener('blur', commit);
  }

  // Comments
  function openComments(objectName){
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.style.display = 'flex';
    document.getElementById('modal-title').textContent = `Комментарии: ${objectName}`;
    backdrop.dataset.objectName = objectName;
    idb.get('comments', objectName).then(rec => { document.getElementById('comment-text').value = rec?.text || ''; });
  }
  document.getElementById('btn-save-comment').addEventListener('click', async () => {
    const backdrop = document.getElementById('modal-backdrop');
    const objectName = backdrop.dataset.objectName;
    await idb.put('comments', { objectName, text: document.getElementById('comment-text').value, updatedAt: Date.now() });
    backdrop.style.display = 'none';
    renderObjects();
  });
  document.getElementById('btn-close-modal').addEventListener('click', () => document.getElementById('modal-backdrop').style.display = 'none');
  document.getElementById('modal-backdrop').addEventListener('click', (e) => { if(e.target.id === 'modal-backdrop') document.getElementById('modal-backdrop').style.display = 'none'; });

  // Export / Import
  btnExport.addEventListener('click', () => {
    const out = { headers: HEADERS, objectColumn: OBJECT_COL, rows: ROWS };
    const blob = new Blob([JSON.stringify(out, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vef2025_export.json'; a.click();
    URL.revokeObjectURL(url);
  });
  fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    let json = null;
    try{
      json = JSON.parse(text);
      if(!json.headers || !json.rows) throw new Error('Неверный формат JSON');
    } catch(err){ alert('Ошибка чтения JSON: ' + err.message); return; }
    HEADERS = json.headers;
    OBJECT_COL = json.objectColumn || HEADERS[0];
    ROWS = json.rows.map(r => (r.id ? r : { id: crypto.randomUUID(), ...r }));
    await idb.clear('rows');
    for(const r of ROWS){ await idb.put('rows', { id: r.id, payload: r }); }
    await saveHeaders();
    renderObjects(); renderTable();
    alert('Импорт завершён.');
  });

  // Clear offline
  btnClearCache.addEventListener('click', async () => {
    if(!confirm('Сбросить локальные изменения и кэш? Это удалит локальные правки.')) return;
    await idb.clear('rows'); await idb.clear('meta'); await idb.clear('comments');
    if('caches' in window){ const keys = await caches.keys(); for(const k of keys){ await caches.delete(k); } }
    location.reload();
  });

  // Filters & hotkeys
  searchEl.addEventListener('input', renderObjects);
  filterEl.addEventListener('input', renderTable);
  document.addEventListener('keydown', async (e) => {
    if(e.ctrlKey && e.key.toLowerCase() === 's'){ e.preventDefault(); alert('Изменения сохраняются локально автоматически.'); }
  });

  // Row add
  btnAddRow.addEventListener('click', async () => {
    const objName = FILTER_OBJ || prompt('Введите название объекта для новой строки:', '(без объекта)');
    if(objName === null) return;
    const newRow = { id: crypto.randomUUID() };
    for(const h of HEADERS){ newRow[h] = (h === OBJECT_COL) ? objName : ''; }
    ROWS.unshift(newRow);
    await idb.put('rows', { id: newRow.id, payload: newRow });
    renderTable(); renderObjects();
  });

  // Column controls
  btnAddCol.addEventListener('click', addColumn);
  btnRenameCol.addEventListener('click', renameColumn);
  btnDelCol.addEventListener('click', deleteColumn);
  btnViewToggle.addEventListener('click', () => {});
  btnObjectCol.addEventListener('click', async () => {
    const name = prompt('Какой столбец считать столбцом объектов?', OBJECT_COL || HEADERS[0]);
    if(!name || !HEADERS.includes(name)){ alert('Такого столбца нет.'); return; }
    OBJECT_COL = name;
    await saveHeaders();
    renderObjects(); renderTable();
  });

  // Init
  (async () => {
    try {
      await loadInitialData();
      ensureSerialColumn();
      renderObjects();
      renderTable();
    } catch(err){
      console.error(err);
      alert('Ошибка загрузки данных: ' + err.message);
    }
  })();
})();
