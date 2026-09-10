/* เช็คตู้ไข่ — 2 โหมดเก็บข้อมูล
   - ไม่มี config Supabase → เก็บในเครื่อง (IndexedDB) ใครเครื่องมัน
   - มี config Supabase   → ฐานข้อมูลกลาง (Postgres) + รูปใน Supabase Storage ทุกคนเห็นชุดเดียวกันแบบทันที */
(() => {
  'use strict';

  const SEED_FILE = 'นำเข้าข้อมูลตู้ไข่-เริ่มต้น.json';
  const SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  let cabinets = [];        // cache ทั้งหมดในหน่วยความจำ
  let currentPhotos = [];   // รูปในฟอร์ม: File (ใหม่) หรือรูปเดิม (Blob ในโหมดเครื่อง / {path,url,thumb} ในโหมดคลาวด์)
  let editingId = null;     // null = โหมดเพิ่มใหม่
  let detailId = null;
  let showAll = false;      // true = โหมด "ดูข้อมูลทั้งหมด"
  let store = null;
  let cloudMode = false;

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove('show'), 2200);
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

  // รูปจากมือถือใหญ่หลาย MB → ย่อก่อนเก็บ ทั้งประหยัดที่และอัปโหลดเร็ว
  async function compressImage(file, maxSide = 1280, quality = 0.82) {
    if (!file || !String(file.type || '').startsWith('image/')) return file;
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) { try { bmp = await createImageBitmap(file); } catch (__) { return file; } }
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
  }

  function photoSrc(p) {
    if (p instanceof Blob) return URL.createObjectURL(p);
    if (typeof p === 'string') return p;
    if (p && p.data) return p.data;
    if (p && p.thumb) return p.thumb;
    if (p && p.url) return p.url;
    return '';
  }

  function views(name) {
    ['viewList', 'viewDetail', 'viewForm'].forEach((v) => {
      $('#' + v).classList.toggle('hidden', v !== name);
    });
    window.scrollTo(0, 0);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function normalize(s) {
    return (s || '').toLowerCase().trim();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('โหลดไม่ได้: ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- โหมดเก็บในเครื่อง (IndexedDB) ----------
  const LocalStore = (() => {
    const DB_NAME = 'tukai-db';
    const STORE = 'cabinets';
    let db = null;

    const req = (r) => new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);

    return {
      label: 'เครื่องนี้',
      async init() {
        db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(DB_NAME, 1);
          r.onupgradeneeded = () => {
            if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
          };
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      },
      all() { return req(tx('readonly').getAll()); },
      async save(data, { kept, newFiles }) {
        const photos = kept.filter((p) => p instanceof Blob);
        for (const f of newFiles) photos.push(await compressImage(f));
        const cab = { ...data, photos };
        await req(tx('readwrite').put(cab));
        return cab;
      },
      remove(id) { return req(tx('readwrite').delete(id)); },
      clear() { return req(tx('readwrite').clear()); },
      // ใส่ทั้งชุดใน transaction เดียว: เร็ว และถ้าพังกลางทางจะไม่ได้ข้อมูลครึ่งเดียว
      bulkPut(list) {
        return new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const s = t.objectStore(STORE);
          const added = [];
          for (const raw of list) {
            const photos = (raw.photos || [])
              .map((d) => (typeof d === 'string' ? dataURLToBlob(d) : (d && d.data ? dataURLToBlob(d.data) : d)))
              .filter((p) => p instanceof Blob);
            const cab = { ...raw, photos };
            s.put(cab);
            added.push(cab);
          }
          t.oncomplete = () => resolve(added);
          t.onerror = () => reject(t.error);
        });
      },
      async loadFullPhotos(cab) { return (cab.photos || []).map(photoSrc); },
      async exportPhoto(p) { return p instanceof Blob ? blobToDataURL(p) : p; },
    };
  })();

  // ---------- โหมดฐานข้อมูลกลาง (Supabase: ตาราง cabinets + bucket photos) ----------
  // แถวละตู้ photos = [{path,url,thumb,tpath}] รูปเต็ม ≤1280px + รูปย่อ 260px สำหรับหน้ารายการ
  const CloudStore = (() => {
    const TABLE = 'cabinets';
    const BUCKET = 'photos';
    let sb = null;
    let channel = null;

    const fromRow = (r) => ({
      id: r.id,
      name: r.name || '',
      location: r.location || '',
      keyNumber: r.key_number || '',
      note: r.note || '',
      photos: Array.isArray(r.photos) ? r.photos : [],
      createdAt: Number(r.created_at) || 0,
      updatedAt: Number(r.updated_at) || 0,
    });
    const toRow = (c, photos) => ({
      id: c.id,
      name: c.name || '',
      location: c.location || '',
      key_number: c.keyNumber || '',
      note: c.note || '',
      photos,
      created_at: c.createdAt || Date.now(),
      updated_at: c.updatedAt || Date.now(),
    });

    async function upload(path, blob) {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + error.message);
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    async function makePhoto(cabinetId, source) {
      const blob = typeof source === 'string' ? dataURLToBlob(source) : source;
      const full = await compressImage(blob, 1280, 0.82);
      const thumb = await compressImage(blob, 260, 0.7);
      const pid = uid();
      const path = `cabinets/${cabinetId}/${pid}.jpg`;
      const tpath = `cabinets/${cabinetId}/${pid}_t.jpg`;
      const url = await upload(path, full);
      const thumbUrl = await upload(tpath, thumb);
      return { path, url, thumb: thumbUrl, tpath };
    }

    async function deletePhotos(photos) {
      const paths = [];
      for (const p of photos || []) {
        if (p && p.path) paths.push(p.path);
        if (p && p.tpath) paths.push(p.tpath);
      }
      if (paths.length) { try { await sb.storage.from(BUCKET).remove(paths); } catch (_) { /* ไฟล์อาจถูกลบไปแล้ว */ } }
    }

    const keepPhoto = (p) => ({ path: p.path || '', url: p.url, thumb: p.thumb || p.url, tpath: p.tpath || '' });

    async function fetchAll() {
      const { data, error } = await sb.from(TABLE).select('*');
      if (error) throw new Error(error.message);
      cabinets = (data || []).map(fromRow);
    }

    return {
      label: '☁ ฐานข้อมูลกลาง',
      async init(cfg) {
        await loadScript(SUPABASE_SDK);
        sb = window.supabase.createClient(cfg.url, cfg.anonKey);
      },
      // โหลดครั้งแรก แล้วฟังการเปลี่ยนแปลงแบบทันที: ใครแก้จากเครื่องไหน ทุกเครื่องเห็นตาม
      async subscribe(onChange) {
        try { await fetchAll(); }
        catch (err) { console.error(err); showToast('เชื่อมต่อฐานข้อมูลกลางไม่ได้: ' + (err.message || err)); }
        onChange();
        channel = sb.channel('cabinets-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, async () => {
            try { await fetchAll(); onChange(); } catch (err) { console.error(err); }
          })
          .subscribe();
      },
      async save(data, { kept, newFiles, oldPhotos }) {
        const id = data.id;
        const photos = kept.filter((p) => p && p.url).map(keepPhoto);
        for (const f of newFiles) photos.push(await makePhoto(id, f));
        const removed = (oldPhotos || []).filter((p) => p && p.path && !photos.some((k) => k.path === p.path));
        await deletePhotos(removed);
        const row = toRow(data, photos);
        const { error } = await sb.from(TABLE).upsert(row);
        if (error) throw new Error(error.message);
        return fromRow(row);
      },
      async remove(id) {
        const c = cabinets.find((x) => x.id === id);
        await deletePhotos(c ? c.photos : []);
        const { error } = await sb.from(TABLE).delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      async clear() {
        const { data } = await sb.from(TABLE).select('id,photos');
        for (const r of data || []) await deletePhotos(r.photos);
        const { error } = await sb.from(TABLE).delete().neq('id', '');
        if (error) throw new Error(error.message);
      },
      async bulkPut(list) {
        const rows = [];
        for (const raw of list) {
          const id = raw.id || uid();
          const photos = [];
          for (const p of raw.photos || []) {
            if (typeof p === 'string') photos.push(await makePhoto(id, p));
            else if (p && p.data) photos.push(await makePhoto(id, p.data));
            else if (p && p.url) photos.push(keepPhoto(p));
          }
          rows.push(toRow({ ...raw, id }, photos));
        }
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 200));
          if (error) throw new Error(error.message);
        }
        return rows.map(fromRow);
      },
      async loadFullPhotos(cab) { return (cab.photos || []).map((p) => (p && p.url) || photoSrc(p)); },
      // backup ฝังรูปจริงเป็น dataURL → ไฟล์เดียวใช้กู้คืนได้ทั้งสองโหมด
      async exportPhoto(p) {
        if (p && p.url) {
          try { return await blobToDataURL(await (await fetch(p.url)).blob()); }
          catch (_) { return p; }
        }
        return p;
      },
    };
  })();

  // ---------- รายการ + ค้นหา ----------
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

      if (c.photos && c.photos.length) {
        const img = document.createElement('img');
        img.className = 'item-thumb';
        img.loading = 'lazy';
        img.src = photoSrc(c.photos[0]);
        btn.appendChild(img);
      } else {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'item-thumb';
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

  // ---------- หน้ารายละเอียด ----------
  function openDetail(id) {
    detailId = id;
    const c = cabinets.find((x) => x.id === id);
    if (!c) {
      // ถูกลบไปแล้ว (เช่น เพื่อนลบจากอีกเครื่อง) → กลับหน้ารายการ
      detailId = null;
      views('viewList');
      renderList();
      return;
    }

    const gallery = (c.photos && c.photos.length)
      ? `<div class="detail-gallery">${c.photos.map((p, i) => `<img data-idx="${i}" src="${photoSrc(p)}">`).join('')}</div>`
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

    // โหมดคลาวด์: แสดงรูปย่อก่อน แล้วสลับเป็นรูปเต็ม (ถ้ายังอยู่หน้าเดิม)
    if (cloudMode && c.photos && c.photos.length) {
      store.loadFullPhotos(c).then((list) => {
        if (detailId !== id) return;
        list.forEach((src, i) => {
          const img = $(`#detailBody img[data-idx="${i}"]`);
          if (img && src) img.src = src;
        });
      });
    }
  }

  async function confirmDelete(id) {
    const c = cabinets.find((x) => x.id === id);
    const label = c ? (c.location || c.name) : '';
    if (!confirm(`ลบตู้ "${label}" ใช่หรือไม่? การลบไม่สามารถกู้คืนได้`)) return;
    try {
      await store.remove(id);
      cabinets = cabinets.filter((x) => x.id !== id);
      showToast('ลบตู้แล้ว');
      detailId = null;
      views('viewList');
      renderList();
    } catch (err) {
      console.error(err);
      showToast('ลบไม่สำเร็จ: ' + (err.message || err));
    }
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
    currentPhotos.forEach((p, idx) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      const img = document.createElement('img');
      img.src = photoSrc(p);
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

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return; // กันกดซ้ำระหว่างกำลังบันทึก
    submitBtn.disabled = true;
    submitBtn.textContent = cloudMode ? 'กำลังบันทึกขึ้นฐานข้อมูลกลาง...' : 'กำลังบันทึก...';

    try {
      const now = Date.now();
      let cab = editingId ? cabinets.find((x) => x.id === editingId) : null;
      const isNew = !cab;
      if (isNew) cab = { id: editingId || uid(), createdAt: now, photos: [] };

      const kept = currentPhotos.filter((p) => !(p instanceof File));
      const newFiles = currentPhotos.filter((p) => p instanceof File);
      const data = { ...cab, name, location: locationVal, keyNumber: $('#fKey').value.trim(), note: $('#fNote').value.trim(), updatedAt: now };

      const saved = await store.save(data, { kept, newFiles, oldPhotos: cab.photos || [] });
      if (isNew) cabinets.push(saved); else Object.assign(cab, saved);

      showToast('บันทึกแล้ว');
      renderList();
      const savedId = saved.id;
      editingId = null;
      if (isNew) views('viewList'); else openDetail(savedId);
    } catch (err) {
      console.error(err);
      showToast('บันทึกไม่สำเร็จ: ' + (err.message || err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'บันทึก';
    }
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
  $('#btnBackFromDetail').onclick = () => { detailId = null; views('viewList'); renderList(); };
  $('#searchInput').addEventListener('input', renderList);

  // ---------- สำรอง / กู้คืนข้อมูล ----------
  $('#btnBackup').onclick = (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.menu-pop');
    if (existing) { existing.remove(); return; }
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.innerHTML = `
      <div class="muted small" style="padding:6px 12px 4px">${cloudMode ? 'ข้อมูลอยู่บนฐานข้อมูลกลาง ทุกคนเห็นชุดเดียวกัน' : 'ข้อมูลอยู่ในเครื่องนี้เท่านั้น'}</div>
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
    showToast('กำลังเตรียมไฟล์สำรอง...');
    const payload = { version: 2, mode: cloudMode ? 'cloud' : 'local', exportedAt: new Date().toISOString(), cabinets: [] };
    for (const c of cabinets) {
      const photos = [];
      for (const p of (c.photos || [])) photos.push(await store.exportPhoto(p));
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
    if (!confirm('การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมด' + (cloudMode ? ' (ทุกคนที่ใช้ลิงก์นี้จะเห็นการเปลี่ยนแปลง)' : '') + ' ต้องการดำเนินการต่อหรือไม่?')) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!Array.isArray(payload.cabinets)) throw new Error('invalid');
      showToast('กำลังกู้คืนข้อมูล...');
      await store.clear();
      const added = await store.bulkPut(payload.cabinets);
      cabinets = added;
      renderList();
      showToast('กู้คืนข้อมูลสำเร็จ');
    } catch (err) {
      console.error(err);
      showToast('กู้คืนไม่สำเร็จ: ไฟล์ไม่ถูกต้องหรือเชื่อมต่อไม่ได้');
    }
  });

  // ไฟล์เริ่มต้นในโฟลเดอร์: ฐานข้อมูลว่าง → โหลดทั้งชุด
  // เคยโหลดชุดเก่าไปแล้ว → เติมเฉพาะเลขกุญแจที่ยังว่างตาม id ไม่ทับที่ผู้ใช้กรอกเอง
  async function seedFromStarterFile() {
    let payload;
    try {
      const resp = await fetch(encodeURIComponent(SEED_FILE));
      if (!resp.ok) return;
      payload = await resp.json();
    } catch (_) {
      return; // ไม่มีไฟล์ (เช่น เปิดจากไฟล์ตรง ๆ) ก็เริ่มจากว่างตามปกติ
    }
    if (!payload || !Array.isArray(payload.cabinets)) return;

    try {
      if (cabinets.length === 0) {
        const added = await store.bulkPut(payload.cabinets);
        cabinets = added;
        showToast(`โหลดข้อมูลเริ่มต้น ${added.length} ตู้แล้ว`);
        return;
      }
      const byId = new Map(payload.cabinets.map((c) => [c.id, c]));
      let filled = 0;
      for (const c of cabinets) {
        const src = byId.get(c.id);
        if (src && src.keyNumber && !c.keyNumber) {
          const saved = await store.save({ ...c, keyNumber: src.keyNumber }, { kept: c.photos || [], newFiles: [], oldPhotos: c.photos || [] });
          Object.assign(c, saved);
          filled++;
        }
      }
      if (filled) showToast(`เติมเลขกุญแจให้ ${filled} ตู้แล้ว`);
    } catch (err) {
      console.error(err);
    }
  }

  function setModeChip() {
    const chip = $('#modeChip');
    if (!chip) return;
    chip.textContent = store.label;
    chip.hidden = false;
  }

  // ---------- init ----------
  (async function init() {
    const cfg = window.TUKAI_SUPABASE;
    if (cfg && cfg.url && cfg.anonKey) {
      try {
        await CloudStore.init(cfg);
        store = CloudStore;
        cloudMode = true;
      } catch (err) {
        console.error(err);
        showToast('เชื่อมต่อฐานข้อมูลกลางไม่ได้ ใช้ข้อมูลในเครื่องแทน');
      }
    }
    if (!store) {
      store = LocalStore;
      await LocalStore.init();
      cabinets = await LocalStore.all();
    }
    setModeChip();

    if (cloudMode) {
      $('#resultCount').textContent = 'กำลังโหลดข้อมูลจากฐานข้อมูลกลาง...';
      await CloudStore.subscribe(() => {
        renderList();
        if (detailId && !$('#viewDetail').classList.contains('hidden')) openDetail(detailId);
      });
    }

    await seedFromStarterFile();
    renderList();
  })();
})();
