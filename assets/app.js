/* เช็คตู้ไข่ — เก็บข้อมูลใน IndexedDB เครื่องเดียว ไม่มี server */
(() => {
  'use strict';

  const DB_NAME = 'tukai-db';
  const DB_VERSION = 1;
  const STORE = 'cabinets';
  let db = null;
  let cabinets = [];        // cache ทั้งหมดในหน่วยความจำ
  let currentPhotos = [];   // Blob[] ของฟอร์มที่กำลังแก้ไข/เพิ่ม
  let editingId = null;     // null = โหมดเพิ่มใหม่
  let detailId = null;
  let showAll = false;      // true = โหมด "ดูข้อมูลทั้งหมด"

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txStore(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function getAll() {
    return new Promise((resolve, reject) => {
      const req = txStore('readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function putCabinet(cab) {
    return new Promise((resolve, reject) => {
      const req = txStore('readwrite').put(cab);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function deleteCabinet(id) {
    return new Promise((resolve, reject) => {
      const req = txStore('readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = meta.match(/data:(.*);base64/)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function views(name) {
    ['viewList', 'viewDetail', 'viewForm'].forEach((v) => {
      $('#' + v).classList.toggle('hidden', v !== name);
    });
    window.scrollTo(0, 0);
  }

  // ---------- รายการ + ค้นหา ----------
  function normalize(s) {
    return (s || '').toLowerCase().trim();
  }

  function renderList() {
    const q = normalize($('#searchInput').value);
    const list = $('#list');
    const empty = $('#emptyState');
    const count = $('#resultCount');

    $('#totalCount').textContent = cabinets.length;
    $('#btnClearSearch').classList.toggle('hidden', !q);
    $('#homeActions').classList.toggle('hidden', showAll || !!q);
    $('#allHeader').classList.toggle('hidden', !showAll);

    // หน้าแรกยังไม่พิมพ์อะไร → โชว์แค่ปุ่มหลัก ไม่ต้องโชว์รายการให้รก
    if (!showAll && !q) {
      list.innerHTML = '';
      empty.classList.add('hidden');
      count.textContent = '';
      return;
    }

    const filtered = q
      ? cabinets.filter((c) => normalize(c.name).includes(q) || normalize(c.location).includes(q))
      : cabinets;

    const sorted = q
      ? [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      : [...filtered].sort((a, b) => {
          // ตู้ที่ยังไม่ระบุสถานที่ให้ไปอยู่ท้ายสุด จะได้ไม่บังรายการที่ใช้งานจริง
          if (!a.location !== !b.location) return a.location ? -1 : 1;
          return (a.location || '').localeCompare(b.location || '', 'th');
        });

    if (cabinets.length === 0) {
      list.innerHTML = '';
      empty.textContent = 'ยังไม่มีตู้ไข่ที่บันทึกไว้ กดปุ่ม "เพิ่มตู้ไข่ใหม่" เพื่อเพิ่มตู้แรก';
      empty.classList.remove('hidden');
      count.textContent = '';
      return;
    }
    if (sorted.length === 0) {
      list.innerHTML = '';
      empty.textContent = 'ไม่พบตู้ที่ค้นหา ลองพิมพ์คำสั้นลง หรือกด "ดูข้อมูลทั้งหมด"';
      empty.classList.remove('hidden');
      count.textContent = '';
      return;
    }
    empty.classList.add('hidden');
    count.textContent = q ? `พบ ${sorted.length} รายการ` : `ข้อมูลทั้งหมด ${sorted.length} ตู้ (เรียงตามสถานที่)`;

    list.innerHTML = '';
    for (const c of sorted) {
      const btn = document.createElement('button');
      btn.className = 'item';
      btn.type = 'button';
      btn.onclick = () => openDetail(c.id);

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'item-thumb';
      if (c.photos && c.photos.length) {
        const img = document.createElement('img');
        img.className = 'item-thumb';
        img.style.width = '60px';
        img.style.height = '60px';
        img.src = URL.createObjectURL(c.photos[0]);
        img.onload = () => URL.revokeObjectURL(img.src);
        btn.appendChild(img);
      } else {
        thumbWrap.textContent = '📦';
        btn.appendChild(thumbWrap);
      }

      const info = document.createElement('div');
      info.className = 'item-info';
      info.innerHTML = `
        <div class="item-place">${c.location ? escapeHtml(c.location) : '<span class="muted">ไม่ระบุสถานที่</span>'}</div>
        <div class="item-name">${escapeHtml(c.name)}</div>
      `;
      btn.appendChild(info);

      const key = document.createElement('div');
      key.className = c.keyNumber ? 'item-key' : 'item-key nokey';
      key.textContent = c.keyNumber ? c.keyNumber : '?';
      btn.appendChild(key);

      list.appendChild(btn);
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- หน้ารายละเอียด ----------
  function openDetail(id) {
    detailId = id;
    const c = cabinets.find((x) => x.id === id);
    if (!c) return;

    const gallery = (c.photos && c.photos.length)
      ? `<div class="detail-gallery">${c.photos.map((b) => `<img src="${URL.createObjectURL(b)}">`).join('')}</div>`
      : `<div class="detail-gallery"><div class="noimg">ไม่มีรูปภาพ</div></div>`;

    $('#detailBody').innerHTML = `
      ${gallery}
      <h2 class="disp" style="margin:14px 0 2px">${c.location ? escapeHtml(c.location) : '<span class="muted">ไม่ระบุสถานที่</span>'}</h2>
      <div class="muted" style="font-size:14px">${escapeHtml(c.name)}</div>

      <div class="key-callout ${c.keyNumber ? '' : 'nokey'}">
        <div class="l">เลขกุญแจ</div>
        <div class="v">${c.keyNumber ? escapeHtml(c.keyNumber) : 'ยังไม่ได้กรอก'}</div>
      </div>

      ${c.note ? `<div class="detail-field"><div class="l">บันทึกเพิ่มเติม</div><div class="v">${escapeHtml(c.note)}</div></div>` : ''}
      <div class="detail-actions">
        <button class="btn" id="btnEdit">แก้ไข</button>
        <button class="btn btn-danger" id="btnDelete">ลบตู้นี้</button>
      </div>
    `;
    $('#btnEdit').onclick = () => openForm(c.id);
    $('#btnDelete').onclick = () => confirmDelete(c.id);
    views('viewDetail');
  }

  async function confirmDelete(id) {
    const c = cabinets.find((x) => x.id === id);
    if (!confirm(`ลบตู้ "${c ? c.name : ''}" ใช่หรือไม่? การลบไม่สามารถกู้คืนได้`)) return;
    await deleteCabinet(id);
    cabinets = cabinets.filter((x) => x.id !== id);
    showToast('ลบตู้แล้ว');
    views('viewList');
    renderList();
  }

  // ---------- ฟอร์มเพิ่ม/แก้ไข ----------
  function openForm(id) {
    editingId = id || null;
    const form = $('#cabinetForm');
    form.reset();
    $('#photoPreview').innerHTML = '';
    currentPhotos = [];

    if (editingId) {
      const c = cabinets.find((x) => x.id === editingId);
      $('#formTitle').textContent = 'แก้ไขตู้ไข่';
      $('#fName').value = c.name || '';
      $('#fLocation').value = c.location || '';
      $('#fKey').value = c.keyNumber || '';
      $('#fNote').value = c.note || '';
      currentPhotos = [...(c.photos || [])];
      renderPhotoPreview();
    } else {
      $('#formTitle').textContent = 'เพิ่มตู้ไข่ใหม่';
    }
    views('viewForm');
  }

  function renderPhotoPreview() {
    const grid = $('#photoPreview');
    grid.innerHTML = '';
    currentPhotos.forEach((blob, idx) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.onload = () => URL.revokeObjectURL(img.src);
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.onclick = () => {
        currentPhotos.splice(idx, 1);
        renderPhotoPreview();
      };
      cell.appendChild(img);
      cell.appendChild(rm);
      grid.appendChild(cell);
    });
  }

  $('#fPhotos').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    currentPhotos.push(...files);
    renderPhotoPreview();
    e.target.value = '';
  });

  $('#cabinetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#fName').value.trim();
    const locationVal = $('#fLocation').value.trim();
    if (!name && !locationVal) { showToast('กรุณากรอกสถานที่ หรือชื่อตู้อย่างน้อย 1 อย่าง'); return; }

    const now = Date.now();
    let cab;
    if (editingId) {
      cab = cabinets.find((x) => x.id === editingId);
    } else {
      cab = { id: uid(), createdAt: now };
      cabinets.push(cab);
    }
    cab.name = name;
    cab.location = locationVal;
    cab.keyNumber = $('#fKey').value.trim();
    cab.note = $('#fNote').value.trim();
    cab.photos = [...currentPhotos];
    cab.updatedAt = now;

    await putCabinet(cab);
    showToast('บันทึกแล้ว');
    renderList();
    if (editingId) {
      openDetail(editingId);
    } else {
      views('viewList');
    }
    editingId = null;
  });

  // ---------- นำทาง ----------
  $('#btnAddHome').onclick = () => openForm(null);
  $('#btnAddAll').onclick = () => openForm(null);
  $('#btnShowAll').onclick = () => { showAll = true; renderList(); };
  $('#btnBackFromAll').onclick = () => { showAll = false; $('#searchInput').value = ''; renderList(); };
  $('#btnClearSearch').onclick = () => { $('#searchInput').value = ''; renderList(); $('#searchInput').focus(); };
  $('#btnBackFromForm').onclick = () => {
    if (editingId) { openDetail(editingId); } else { views('viewList'); renderList(); }
  };
  $('#btnBackFromDetail').onclick = () => { views('viewList'); renderList(); };
  $('#searchInput').addEventListener('input', renderList);

  // ---------- สำรอง / กู้คืนข้อมูล ----------
  $('#btnBackup').onclick = (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.menu-pop');
    if (existing) { existing.remove(); return; }
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.innerHTML = `
      <button id="mExport">สำรองข้อมูล (Export)</button>
      <button id="mImport">กู้คืนข้อมูล (Import)</button>
    `;
    document.body.appendChild(pop);
    pop.querySelector('#mExport').onclick = () => { pop.remove(); exportData(); };
    pop.querySelector('#mImport').onclick = () => { pop.remove(); $('#importFile').click(); };
    setTimeout(() => {
      document.addEventListener('click', function h() {
        pop.remove();
        document.removeEventListener('click', h);
      }, { once: true });
    }, 0);
  };

  async function exportData() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), cabinets: [] };
    for (const c of cabinets) {
      const photos = [];
      for (const blob of (c.photos || [])) {
        photos.push(await blobToDataURL(blob));
      }
      payload.cabinets.push({ ...c, photos });
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tukai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('สำรองข้อมูลแล้ว');
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมด ต้องการดำเนินการต่อหรือไม่?')) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload.cabinets)) throw new Error('invalid');

      // ลบของเดิมทั้งหมด
      for (const c of cabinets) await deleteCabinet(c.id);
      cabinets = [];

      await loadPayload(payload);
      renderList();
      showToast('กู้คืนข้อมูลสำเร็จ');
    } catch (err) {
      console.error(err);
      showToast('ไฟล์ backup ไม่ถูกต้อง');
    }
  });

  // ใส่ทั้งชุดใน transaction เดียว: เร็วกว่าทีละรายการมาก และถ้าพังกลางทางจะไม่ได้ข้อมูลครึ่งเดียว
  function loadPayload(payload) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const added = [];
      for (const raw of payload.cabinets) {
        const photos = (raw.photos || []).map((d) => (typeof d === 'string' ? dataURLToBlob(d) : d));
        const cab = { ...raw, photos };
        store.put(cab);
        added.push(cab);
      }
      tx.oncomplete = () => { cabinets.push(...added); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }

  // ไฟล์เริ่มต้นในโฟลเดอร์: เครื่องใหม่ (ว่าง) → โหลดทั้งชุด
  // เครื่องที่เคยโหลดชุดเก่าไปแล้ว → เติมเฉพาะเลขกุญแจที่ยังว่าง ไม่ทับที่ผู้ใช้กรอกเอง
  async function seedFromStarterFile() {
    let payload;
    try {
      const resp = await fetch(encodeURIComponent('นำเข้าข้อมูลตู้ไข่-เริ่มต้น.json'));
      if (!resp.ok) return;
      payload = await resp.json();
    } catch (_) {
      return; // ไม่มีไฟล์ (เช่น เปิดจากไฟล์ตรง ๆ) ก็เริ่มจากว่างตามปกติ
    }
    if (!payload || !Array.isArray(payload.cabinets)) return;

    if (cabinets.length === 0) {
      await loadPayload(payload);
      showToast(`โหลดข้อมูลเริ่มต้น ${cabinets.length} ตู้แล้ว`);
      return;
    }

    const byId = new Map(payload.cabinets.map((c) => [c.id, c]));
    let filled = 0;
    for (const c of cabinets) {
      const src = byId.get(c.id);
      if (src && src.keyNumber && !c.keyNumber) {
        c.keyNumber = src.keyNumber;
        await putCabinet(c);
        filled++;
      }
    }
    if (filled) showToast(`เติมเลขกุญแจให้ ${filled} ตู้แล้ว`);
  }

  // ---------- init ----------
  (async function init() {
    db = await openDB();
    cabinets = await getAll();
    await seedFromStarterFile();
    renderList();
  })();
})();
