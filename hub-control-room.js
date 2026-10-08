/**
 * Control Room UI — Operations → Control Room
 * Reuses hub shell patterns (hubFetch / hub-panel / hub-loading / hub-empty).
 */
(function (global) {
  'use strict';

  let _booted = false;
  let _state = {
    stationId: null,
    current: null,
    sub: 'current',
    busy: false,
    schedView: 'week',
    schedAnchor: null,
    stations: [],
  };

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hubFetch(path, init) {
    if (typeof global.proxyFetch !== 'function') {
      return Promise.reject(new Error('proxyFetch not available'));
    }
    return global.proxyFetch(path, init);
  }

  function hasPerm(id) {
    if (global.RbacClient) {
      const perms = global.RbacClient.getPermissions ? global.RbacClient.getPermissions() : [];
      return global.RbacClient.hasPerm(perms, id);
    }
    const perms =
      (global.HubUI && global.HubUI.getPermissions && global.HubUI.getPermissions()) || [];
    return perms.includes(id) || perms.includes('admin') || perms.includes('hub_admin');
  }

  async function crAlert(message, title) {
    if (global.streamlineModal && typeof global.streamlineModal.alert === 'function') {
      await global.streamlineModal.alert({
        title: title || 'Control Room',
        body: String(message || ''),
      });
      return;
    }
    window.alert(String(message || ''));
  }

  async function crPrompt(opts) {
    if (global.streamlineModal && typeof global.streamlineModal.prompt === 'function') {
      return global.streamlineModal.prompt(opts);
    }
    const v = window.prompt(opts.title || opts.body || '', opts.defaultValue || '');
    return v == null ? undefined : v;
  }

  async function crForm(opts) {
    if (global.streamlineModal && typeof global.streamlineModal.form === 'function') {
      return global.streamlineModal.form(opts);
    }
    const out = {};
    for (const f of opts.fields || []) {
      const v = window.prompt(f.label || f.name, f.defaultValue || '');
      if (v == null) return undefined;
      out[f.name] = v;
    }
    return out;
  }

  async function api(path, opts = {}) {
    const res = await hubFetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function rootEl() {
    return document.getElementById('hubControlRoomRoot');
  }

  function setBusy(v) {
    _state.busy = !!v;
    const btns = rootEl()?.querySelectorAll('button[data-cr-submit]');
    btns?.forEach((b) => {
      b.disabled = !!v;
    });
  }

  function subNavHtml() {
    const items = [
      ['current', 'Current Shift'],
      ['handover', 'Handover'],
      ['board', 'Operating Board'],
      ['tasks', 'Tasks'],
      ['schedule', 'Schedule'],
      ['history', 'History'],
    ];
    if (hasPerm('control_room_supervisor')) items.push(['supervisor', 'Supervisor']);
    return `<div class="hub-inline-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${items
        .map(
          ([id, label]) =>
            `<button type="button" class="hub-btn ${_state.sub === id ? 'hub-btn-primary' : 'hub-btn-ghost'}" data-cr-sub="${id}">${esc(label)}</button>`
        )
        .join('')}
    </div>`;
  }

  function kpiRow(current) {
    if (!current) return '';
    const shift = current.shift;
    return `<div class="cr-summary-grid">
      <div class="hub-kpi hub-panel--glass"><div class="hub-kpi-label">Station</div><div class="hub-kpi-value" style="font-size:1.05rem">${esc(current.station?.name || '—')}</div></div>
      <div class="hub-kpi hub-panel--glass"><div class="hub-kpi-label">Shift</div><div class="hub-kpi-value" style="font-size:1.05rem">${esc(shift?.name || 'None')}</div>
        <div class="hub-kpi-trend">${esc(shift ? `${new Date(shift.starts_at).toLocaleString()} – ${new Date(shift.ends_at).toLocaleTimeString()}` : '—')}</div></div>
      <div class="hub-kpi hub-panel--glass"><div class="hub-kpi-label">Needs attention</div><div class="hub-kpi-value ${current.unacknowledged_count ? 'warn' : ''}">${esc(current.unacknowledged_count)}</div>
        <div class="hub-kpi-trend">Unacked Attention/Urgent</div></div>
      <div class="hub-kpi hub-panel--glass"><div class="hub-kpi-label">Open work</div><div class="hub-kpi-value">${esc((current.open_board_count || 0) + (current.open_task_count || 0))}</div>
        <div class="hub-kpi-trend">Board ${esc(current.open_board_count)} · Tasks ${esc(current.open_task_count)}</div></div>
    </div>
    <p class="hub-sub" style="margin:0 0 14px">Operators: ${esc((current.assignments || []).map((a) => a.operator_email).join(', ') || '—')} · Now ${esc(new Date(current.current_time).toLocaleString())}</p>`;
  }

  function canManageStations() {
    return (
      hasPerm('control_room_supervisor') ||
      hasPerm('hub_admin') ||
      hasPerm('admin')
    );
  }

  function bootstrapBanner(current, meta) {
    if (!current?.needs_bootstrap && (meta?.stations || []).length) return '';
    const canSetup = canManageStations();
    const stations = meta?.stations || [];
    if (!canSetup) {
      return `<div class="hub-panel" style="margin-bottom:14px">
        <div class="hub-panel-head"><h2>Control Room</h2></div>
        <div class="hub-panel-body pad">
          <p class="hub-empty" style="display:block;margin:0">Control Room has not been configured yet.</p>
          <p class="hub-sub" style="margin:10px 0 0">An administrator will set up your station before logging and shifts become available.</p>
        </div>
      </div>`;
    }
    const existing = stations.length
      ? `<p class="hub-sub" style="margin:0 0 10px">${esc(stations[0].name)} is ready. Add a unit to finish setup.</p>`
      : '';
    const setupForm = `<form id="crBootstrapForm" class="cr-bootstrap-form" style="margin-top:4px;display:grid;gap:12px;max-width:420px">
          ${
            stations.length
              ? ''
              : `<label>Station name
            <input class="input" name="station_name" required maxlength="120" placeholder="Plant A Control Room" />
          </label>`
          }
          <label>First unit name
            <input class="input" name="unit_name" required maxlength="120" placeholder="Unit 100" />
          </label>
          <details class="cr-bootstrap-advanced">
            <summary>Advanced options</summary>
            <div class="cr-bootstrap-advanced-body">
              ${
                stations.length
                  ? ''
                  : `<label>Station ID override
                <input class="input" name="station_key" maxlength="64" placeholder="Auto-generated from station name" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
              </label>`
              }
              <label>Unit ID override
                <input class="input" name="unit_key" maxlength="64" placeholder="Auto-generated from unit name" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
              </label>
            </div>
          </details>
          <button type="submit" class="hub-btn hub-btn-primary" data-cr-submit>${
            stations.length ? 'Add unit' : 'Set up Control Room'
          }</button>
          <p class="hub-sub" id="crBootstrapMsg" style="display:none;margin:0"></p>
        </form>`;
    return `<div class="hub-panel" style="margin-bottom:14px">
      <div class="hub-panel-head"><h2>Welcome — set up your station</h2></div>
      <div class="hub-panel-body pad">
        <p class="hub-sub" style="margin:0 0 8px">
          ${esc(
            current?.bootstrap_message ||
              'Create your Control Room station to start logging shifts and handovers.'
          )}
        </p>
        ${existing}
        ${setupForm}
      </div>
    </div>`;
  }

  function wireBootstrapForm(root) {
    const form = root.querySelector('#crBootstrapForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (_state.busy) return;
      const fd = new FormData(form);
      const stationName = String(fd.get('station_name') || '').trim();
      const stationKey = String(fd.get('station_key') || '').trim();
      const unitName = String(fd.get('unit_name') || '').trim();
      const unitKey = String(fd.get('unit_key') || '').trim();
      const msg = root.querySelector('#crBootstrapMsg');
      const btn = form.querySelector('[data-cr-submit]');
      try {
        _state.busy = true;
        if (btn) btn.disabled = true;
        if (msg) {
          msg.style.display = 'block';
          msg.textContent = 'Saving…';
          msg.className = 'hub-sub';
        }
        const stRes = await api('/hub/control-room/stations', {
          method: 'POST',
          body: { name: stationName, key: stationKey || undefined },
        });
        const stationId = stRes.station?.id;
        if (!stationId) throw new Error('Station was not created');
        await api('/hub/control-room/units', {
          method: 'POST',
          body: {
            station_id: stationId,
            name: unitName,
            key: unitKey || undefined,
          },
        });
        _state.stationId = stationId;
        await render();
      } catch (err) {
        if (msg) {
          msg.style.display = 'block';
          msg.textContent = err.message || 'Could not create station.';
          msg.className = 'hub-empty';
        } else {
          await crAlert(err.message || 'Could not create station.');
        }
      } finally {
        _state.busy = false;
        if (btn) btn.disabled = false;
      }
    });
  }

  async function renderCurrent(root) {
    const current = await api('/hub/control-room/current' + (_state.stationId ? `?station_id=${encodeURIComponent(_state.stationId)}` : ''));
    _state.current = current;
    _state.stationId = current.station?.id || _state.stationId;
    const meta = await api('/hub/control-room/meta' + (_state.stationId ? `?station_id=${encodeURIComponent(_state.stationId)}` : ''));
    if (current.needs_bootstrap || !(meta.stations || []).length) {
      root.innerHTML = `${subNavHtml()}${bootstrapBanner(current, meta)}`;
      root.querySelectorAll('[data-cr-sub]').forEach((b) =>
        b.addEventListener('click', () => {
          _state.sub = b.getAttribute('data-cr-sub');
          render();
        })
      );
      wireBootstrapForm(root);
      return;
    }
    // Station exists but no units — setup for supervisors only
    if (!(meta.units || []).length) {
      root.innerHTML = `${subNavHtml()}${bootstrapBanner(
        {
          needs_bootstrap: true,
          bootstrap_message: 'Add at least one unit so operators can start logging.',
        },
        meta
      )}`;
      root.querySelectorAll('[data-cr-sub]').forEach((b) =>
        b.addEventListener('click', () => {
          _state.sub = b.getAttribute('data-cr-sub');
          render();
        })
      );
      if (canManageStations()) {
        const form = root.querySelector('#crBootstrapForm');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (_state.busy) return;
            const fd = new FormData(form);
            const msg = root.querySelector('#crBootstrapMsg');
            const btn = form.querySelector('[data-cr-submit]');
            try {
              _state.busy = true;
              if (btn) btn.disabled = true;
              await api('/hub/control-room/units', {
                method: 'POST',
                body: {
                  station_id: meta.stations[0].id,
                  name: String(fd.get('unit_name') || '').trim(),
                  key: String(fd.get('unit_key') || '').trim() || undefined,
                },
              });
              await render();
            } catch (err) {
              if (msg) {
                msg.style.display = 'block';
                msg.textContent = err.message || 'Could not create unit.';
              }
            } finally {
              _state.busy = false;
              if (btn) btn.disabled = false;
            }
          });
        }
      }
      return;
    }
    const logs = await api(
      '/hub/control-room/logs?shift_id=' + encodeURIComponent(current.shift?.id || '') + '&station_id=' + encodeURIComponent(_state.stationId || '')
    );
    const units = meta.units || [];
    const recentImportant = current.recent_important || [];
    root.innerHTML = `${subNavHtml()}${kpiRow(current)}
      <div class="cr-workspace">
        <div class="hub-panel cr-shift-activity">
          <div class="hub-panel-head"><h2>Recent important activity</h2>
            <div class="cr-timeline-filters" style="display:flex;gap:6px">
              <select id="crFilterPriority" class="input" style="width:auto" aria-label="Filter priority"><option value="">Priority</option><option>Normal</option><option>Attention</option><option>Urgent</option></select>
              <select id="crFilterAck" class="input" style="width:auto" aria-label="Filter acknowledgement"><option value="">Ack</option><option value="unacked">Unacked</option><option value="acked">Acked</option></select>
            </div>
          </div>
          <div class="hub-panel-body pad cr-shift-activity-body">
            <div class="cr-recent-important" id="crRecentImportant">
              ${
                recentImportant.length
                  ? renderTimeline(recentImportant, { compact: true })
                  : '<p class="hub-empty cr-empty-inline">No attention or urgent items yet this shift.</p>'
              }
            </div>
            <div class="cr-timeline-section">
              <h3 class="cr-section-title">Shift timeline</h3>
              <div id="crTimelineBody">${renderTimeline(logs.logs || [])}</div>
            </div>
          </div>
        </div>
        <div class="hub-panel cr-quick-log">
          <div class="hub-panel-head"><h2>Quick Log</h2></div>
          <div class="hub-panel-body pad">
            ${
              hasPerm('control_room_log')
                ? `<form id="crQuickLogForm">
              <label>Unit<select name="unit_id" class="input">${
                units.length
                  ? units.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')
                  : '<option value="">No units configured</option>'
              }</select></label>
              <label>Category<select name="category" class="input">
                ${['Operations', 'Maintenance', 'Safety', 'Process', 'Communication', 'Other'].map((c) => `<option>${c}</option>`).join('')}
              </select></label>
              <label>Priority<select name="priority" class="input">
                <option>Normal</option><option>Attention</option><option>Urgent</option>
              </select></label>
              <label>Summary<input class="input" name="summary" required maxlength="200" /></label>
              <label>Details<textarea class="input" name="details" rows="3"></textarea></label>
              <label>Related asset ID <span class="hub-sub">(optional)</span><input class="input" name="maintainx_asset_id" placeholder="Asset reference" /></label>
              <label style="display:flex;gap:8px;align-items:center;flex-direction:row;font-weight:500"><input type="checkbox" name="follow_up" /> Follow-up required</label>
              <label style="display:flex;gap:8px;align-items:center;flex-direction:row;font-weight:500"><input type="checkbox" name="carryover" /> Mark for handover</label>
              <button type="submit" class="hub-btn hub-btn-primary" data-cr-submit>Log event</button>
              <p class="hub-empty" id="crQuickLogMsg" style="display:none"></p>
            </form>`
                : '<p class="hub-empty">You do not have permission to create logs.</p>'
            }
          </div>
        </div>
      </div>`;

    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );

    const form = root.querySelector('#crQuickLogForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (_state.busy) return;
        const fd = new FormData(form);
        const msg = root.querySelector('#crQuickLogMsg');
        setBusy(true);
        try {
          await api('/hub/control-room/logs', {
            method: 'POST',
            body: {
              station_id: _state.stationId,
              shift_id: current.shift?.id,
              unit_id: fd.get('unit_id') || null,
              category: fd.get('category'),
              priority: fd.get('priority'),
              summary: fd.get('summary'),
              details: fd.get('details') || null,
              maintainx_asset_id: fd.get('maintainx_asset_id') || null,
              follow_up: fd.get('follow_up') === 'on',
              carryover: fd.get('carryover') === 'on',
            },
          });
          form.reset();
          if (msg) {
            msg.style.display = 'block';
            msg.textContent = 'Event logged.';
          }
          await render();
        } catch (err) {
          if (msg) {
            msg.style.display = 'block';
            msg.textContent = err.status === 403 ? 'Not authorized.' : err.message;
          }
        } finally {
          setBusy(false);
        }
      });
    }

    const reloadTimeline = async () => {
      const pri = root.querySelector('#crFilterPriority')?.value || '';
      const ack = root.querySelector('#crFilterAck')?.value || '';
      const qs = new URLSearchParams({
        shift_id: current.shift?.id || '',
        station_id: _state.stationId || '',
      });
      if (pri) qs.set('priority', pri);
      if (ack) qs.set('ack', ack);
      try {
        const data = await api('/hub/control-room/logs?' + qs.toString());
        const body = root.querySelector('#crTimelineBody');
        if (body) body.innerHTML = renderTimeline(data.logs || []);
        wireAckButtons(root);
      } catch (err) {
        const body = root.querySelector('#crTimelineBody');
        if (body) body.innerHTML = `<p class="hub-empty">${esc(err.message)}</p>`;
      }
    };
    root.querySelector('#crFilterPriority')?.addEventListener('change', reloadTimeline);
    root.querySelector('#crFilterAck')?.addEventListener('change', reloadTimeline);
    wireAckButtons(root);
  }

  function renderTimeline(logs, opts = {}) {
    if (!logs.length) return '<p class="hub-empty">No events yet.</p>';
    return `<table class="hub-table"><thead><tr>
      <th>Time</th><th>Pri</th><th>Cat</th><th>Summary</th><th>By</th><th>Ack</th><th></th>
    </tr></thead><tbody>
      ${logs
        .map((l) => {
          const acks = l.acknowledgements || [];
          return `<tr>
          <td>${esc(new Date(l.event_at).toLocaleString())}</td>
          <td><strong>${esc(l.priority)}</strong></td>
          <td>${esc(l.category)}</td>
          <td>${esc(l.summary)}${l.follow_up ? ' · follow-up' : ''}${l.carryover ? ' · carryover' : ''}${
            l.maintainx_asset_id ? ` · MX ${esc(l.maintainx_asset_id)}` : ''
          }</td>
          <td>${esc(l.created_by)}</td>
          <td>${acks.length ? esc(acks.map((a) => a.user_email).join(', ')) : '—'}</td>
          <td>${
            !opts.compact && hasPerm('control_room_acknowledge')
              ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-ack="${esc(l.id)}" data-cr-shift="${esc(l.shift_id)}">Ack</button>`
              : ''
          }</td>
        </tr>`;
        })
        .join('')}
    </tbody></table>`;
  }

  function wireAckButtons(root) {
    root.querySelectorAll('[data-cr-ack]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        setBusy(true);
        try {
          await api('/hub/control-room/acknowledgements', {
            method: 'POST',
            body: {
              target_type: 'shift_log',
              target_id: btn.getAttribute('data-cr-ack'),
              shift_id: btn.getAttribute('data-cr-shift') || null,
            },
          });
          await render();
        } catch (err) {
          await crAlert(err.status === 403 ? 'Not authorized to acknowledge.' : err.message);
        } finally {
          setBusy(false);
        }
      });
    });
  }

  async function renderBoard(root) {
    const items = (
      await api('/hub/control-room/board?station_id=' + encodeURIComponent(_state.stationId || '') + '&open_only=false')
    ).items;
    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head"><h2>Operating Board</h2>
          ${
            hasPerm('control_room_board_manage')
              ? '<button type="button" class="hub-btn hub-btn-primary" id="crBoardAdd">+ Board item</button>'
              : ''
          }
        </div>
        <div class="hub-panel-body pad">
          ${
            !items.length
              ? '<p class="hub-empty">No board items. Conditions that persist across shifts appear here.</p>'
              : `<table class="hub-table"><thead><tr><th>Title</th><th>Status</th><th>Pri</th><th>Owner</th><th></th></tr></thead><tbody>
            ${items
              .map(
                (b) => `<tr>
              <td><strong>${esc(b.title)}</strong><div class="hub-sub">${esc(b.description || '')}</div></td>
              <td>${esc(b.status)}</td><td>${esc(b.priority)}</td><td>${esc(b.owner_email || '—')}</td>
              <td>${
                hasPerm('control_room_board_manage') && b.status !== 'Resolved'
                  ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-resolve="${esc(b.id)}">Resolve</button>`
                  : ''
              }</td>
            </tr>`
              )
              .join('')}
          </tbody></table>`
          }
        </div>
      </div>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelector('#crBoardAdd')?.addEventListener('click', async () => {
      if (_state.busy) return;
      const values = await crForm({
        title: 'New board item',
        body: 'Conditions that persist across shifts.',
        okLabel: 'Create',
        fields: [
          { name: 'title', label: 'Title', required: true, placeholder: 'Board item title' },
          {
            name: 'priority',
            label: 'Priority',
            type: 'select',
            defaultValue: 'Attention',
            options: [
              { value: 'Info', label: 'Info' },
              { value: 'Attention', label: 'Attention' },
              { value: 'Urgent', label: 'Urgent' },
            ],
          },
        ],
      });
      if (!values || !(values.title || '').trim()) return;
      setBusy(true);
      try {
        await api('/hub/control-room/board', {
          method: 'POST',
          body: {
            station_id: _state.stationId,
            title: values.title.trim(),
            priority: values.priority || 'Attention',
          },
        });
        await render();
      } catch (err) {
        await crAlert(err.message);
      } finally {
        setBusy(false);
      }
    });
    root.querySelectorAll('[data-cr-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        const note = await crPrompt({
          title: 'Resolve board item',
          body: 'Optional resolution note',
          okLabel: 'Resolve',
          multiline: true,
          defaultValue: '',
        });
        if (note === undefined) return;
        setBusy(true);
        try {
          await api('/hub/control-room/board/' + encodeURIComponent(btn.getAttribute('data-cr-resolve')) + '/resolve', {
            method: 'POST',
            body: { resolution_note: note || '' },
          });
          await render();
        } catch (err) {
          await crAlert(err.message);
        } finally {
          setBusy(false);
        }
      });
    });
  }

  async function renderTasks(root) {
    const tasks = (await api('/hub/control-room/tasks?station_id=' + encodeURIComponent(_state.stationId || '') + '&open_only=false'))
      .tasks;
    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head"><h2>Tasks</h2>
          ${hasPerm('control_room_task_manage') ? '<button type="button" class="hub-btn hub-btn-primary" id="crTaskAdd">+ Task</button>' : ''}
        </div>
        <div class="hub-panel-body pad">
          ${
            !tasks.length
              ? '<p class="hub-empty">No operational tasks.</p>'
              : `<table class="hub-table"><thead><tr><th>Title</th><th>Status</th><th>Due</th><th>Assignee</th><th></th></tr></thead><tbody>
            ${tasks
              .map(
                (t) => `<tr>
              <td><strong>${esc(t.title)}</strong>${t.overdue ? ' <span style="color:#b45309">OVERDUE</span>' : ''}</td>
              <td>${esc(t.status)}</td>
              <td>${t.due_at ? esc(new Date(t.due_at).toLocaleString()) : '—'}</td>
              <td>${esc(t.assignee_email || '—')}</td>
              <td>${
                hasPerm('control_room_task_manage') && t.status !== 'Completed' && t.status !== 'Cancelled'
                  ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-complete="${esc(t.id)}">Complete</button>`
                  : ''
              }</td>
            </tr>`
              )
              .join('')}
          </tbody></table>`
          }
        </div>
      </div>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelector('#crTaskAdd')?.addEventListener('click', async () => {
      if (_state.busy) return;
      const values = await crForm({
        title: 'New task',
        okLabel: 'Create',
        fields: [
          { name: 'title', label: 'Title', required: true, placeholder: 'Task title' },
          {
            name: 'due_at',
            label: 'Due (ISO, optional)',
            defaultValue: new Date(Date.now() + 3600e3).toISOString(),
            hint: 'Leave blank for no due time',
          },
        ],
      });
      if (!values || !(values.title || '').trim()) return;
      setBusy(true);
      try {
        await api('/hub/control-room/tasks', {
          method: 'POST',
          body: {
            station_id: _state.stationId,
            title: values.title.trim(),
            due_at: (values.due_at || '').trim() || null,
            priority: 'Normal',
          },
        });
        await render();
      } catch (err) {
        await crAlert(err.message);
      } finally {
        setBusy(false);
      }
    });
    root.querySelectorAll('[data-cr-complete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        const note = await crPrompt({
          title: 'Complete task',
          body: 'Completion note',
          okLabel: 'Complete',
          multiline: true,
          defaultValue: '',
        });
        if (note === undefined) return;
        setBusy(true);
        try {
          await api('/hub/control-room/tasks/' + encodeURIComponent(btn.getAttribute('data-cr-complete')), {
            method: 'PATCH',
            body: { status: 'Completed', completion_note: note || '' },
          });
          await render();
        } catch (err) {
          await crAlert(err.message);
        } finally {
          setBusy(false);
        }
      });
    });
  }

  async function renderHandover(root) {
    const handovers = (await api('/hub/control-room/handovers?station_id=' + encodeURIComponent(_state.stationId || ''))).handovers;
    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head"><h2>Handover</h2>
          ${hasPerm('control_room_handover') ? '<button type="button" class="hub-btn hub-btn-primary" id="crHandoverSubmit">Submit handover</button>' : ''}
        </div>
        <div class="hub-panel-body pad">
          <p class="hub-sub">Assembles Attention/Urgent logs, carryover items, open board items, and unfinished tasks. Unresolved board items remain after shift change.</p>
          ${
            !handovers.length
              ? '<p class="hub-empty">No handovers yet.</p>'
              : `<table class="hub-table"><thead><tr><th>When</th><th>Outgoing</th><th>Note</th><th>Incoming ack</th><th></th></tr></thead><tbody>
            ${handovers
              .map(
                (h) => `<tr>
              <td>${esc(new Date(h.outgoing_at).toLocaleString())}</td>
              <td>${esc(h.outgoing_by)}</td>
              <td>${esc(h.outgoing_note || '—')}<div class="hub-sub">board ${esc((h.payload?.unresolved_board || []).length)} · tasks ${esc((h.payload?.unfinished_tasks || []).length)}</div></td>
              <td>${h.incoming_ack_at ? esc(h.incoming_ack_by + ' @ ' + new Date(h.incoming_ack_at).toLocaleString()) : 'Pending'}</td>
              <td>${
                !h.incoming_ack_at && hasPerm('control_room_handover')
                  ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-ho-ack="${esc(h.id)}">Acknowledge</button>`
                  : ''
              }</td>
            </tr>`
              )
              .join('')}
          </tbody></table>`
          }
        </div>
      </div>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelector('#crHandoverSubmit')?.addEventListener('click', async () => {
      if (_state.busy) return;
      const openBoard = (
        await api('/hub/control-room/board?station_id=' + encodeURIComponent(_state.stationId || '') + '&open_only=true').catch(
          () => ({ items: [] })
        )
      ).items;
      const openTasks = (
        await api('/hub/control-room/tasks?station_id=' + encodeURIComponent(_state.stationId || '') + '&open_only=true').catch(
          () => ({ tasks: [] })
        )
      ).tasks;
      const carrySummary =
        `Open board items: ${(openBoard || []).length}\n` +
        `Unfinished tasks: ${(openTasks || []).length}\n` +
        ((openBoard || []).slice(0, 5).map((b) => '• ' + b.title).join('\n') || '• (none)');
      const values = await crForm({
        title: 'Submit handover',
        body: 'Document outgoing shift notes. Unresolved board items remain after shift change.',
        okLabel: 'Submit handover',
        fields: [
          {
            name: 'carryover',
            label: 'Carryover summary (read-only reference)',
            multiline: true,
            defaultValue: carrySummary,
          },
          {
            name: 'outgoing_note',
            label: 'Outgoing handover note',
            required: true,
            multiline: true,
            placeholder: 'What the incoming operator needs to know…',
          },
        ],
        validate: (v) => (!(v.outgoing_note || '').trim() ? 'Outgoing note is required' : null),
      });
      if (!values || !(values.outgoing_note || '').trim()) return;
      setBusy(true);
      try {
        await api('/hub/control-room/handovers', {
          method: 'POST',
          body: {
            station_id: _state.stationId,
            outgoing_note: values.outgoing_note.trim(),
            complete_outgoing_shift: false,
          },
        });
        await render();
      } catch (err) {
        await crAlert(err.message);
      } finally {
        setBusy(false);
      }
    });
    root.querySelectorAll('[data-cr-ho-ack]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        setBusy(true);
        try {
          await api('/hub/control-room/handovers/' + encodeURIComponent(btn.getAttribute('data-cr-ho-ack')) + '/ack', {
            method: 'POST',
            body: {},
          });
          await render();
        } catch (err) {
          await crAlert(err.message);
        } finally {
          setBusy(false);
        }
      });
    });
  }

  function toLocalDateTimeValue(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function localDateTimeToIso(localValue) {
    if (!localValue) return null;
    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function ymdLocal(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseYmdLocal(ymd) {
    const [y, m, day] = String(ymd || '')
      .split('-')
      .map(Number);
    return new Date(y, (m || 1) - 1, day || 1, 0, 0, 0, 0);
  }

  function addDaysYmd(ymd, days) {
    const d = parseYmdLocal(ymd);
    d.setDate(d.getDate() + days);
    return ymdLocal(d);
  }

  function startOfWeekMonday(ymd) {
    const d = parseYmdLocal(ymd);
    const dow = d.getDay(); // 0 Sun
    const offset = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + offset);
    return ymdLocal(d);
  }

  function weekDates(anchorYmd) {
    const mon = startOfWeekMonday(anchorYmd);
    return Array.from({ length: 7 }, (_, i) => addDaysYmd(mon, i));
  }

  function defaultShiftWindow(workDate) {
    const [y, m, day] = String(workDate || '').split('-').map(Number);
    const start = new Date(y, (m || 1) - 1, day || 1, 8, 0, 0, 0);
    const end = new Date(y, (m || 1) - 1, day || 1, 16, 0, 0, 0);
    return { start, end };
  }

  function formatRange(startsAt, endsAt) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
    const optsDate = { weekday: 'short', month: 'short', day: 'numeric' };
    const optsTime = { hour: 'numeric', minute: '2-digit' };
    const dStart = start.toLocaleDateString('en-US', optsDate);
    const tStart = start.toLocaleTimeString('en-US', optsTime);
    const dEnd = end.toLocaleDateString('en-US', optsDate);
    const tEnd = end.toLocaleTimeString('en-US', optsTime);
    if (start.toDateString() === end.toDateString()) return `${dStart} · ${tStart} – ${tEnd}`;
    return `${dStart} · ${tStart} – ${dEnd} · ${tEnd}`;
  }

  async function loadDirectoryEmployees(q) {
    try {
      const qs = q ? '?q=' + encodeURIComponent(q) : '';
      const data = await api('/hub/control-room/directory' + qs);
      return data.employees || [];
    } catch {
      return [];
    }
  }

  async function loadStations() {
    try {
      const meta = await api('/hub/control-room/meta');
      _state.stations = meta.stations || [];
      return _state.stations;
    } catch {
      return _state.stations || [];
    }
  }

  function canManageSchedule() {
    return hasPerm('control_room_schedule_manage');
  }

  async function openAssignmentForm(opts) {
    const workDate = opts.workDate || ymdLocal(new Date());
    const win = opts.startsAt
      ? { start: new Date(opts.startsAt), end: new Date(opts.endsAt) }
      : defaultShiftWindow(workDate);
    const employees = await loadDirectoryEmployees('');
    const preselected = employees.find(
      (e) => e.email === String(opts.operatorEmail || '').toLowerCase()
    );
    const values = await crForm({
      title: opts.id ? 'Edit assignment' : 'Add assignment',
      body: 'Search the directory by name or email. Times use your browser timezone and are stored in UTC.',
      okLabel: opts.id ? 'Save' : 'Create',
      fields: [
        {
          name: 'operator_email',
          label: 'Operator',
          type: 'person-search',
          required: true,
          placeholder: 'Search by name or email',
          defaultValue: opts.operatorEmail || '',
          defaultId: opts.operatorUserId || (preselected ? preselected.id : ''),
          defaultLabel: preselected
            ? (preselected.name ? preselected.name + ' · ' : '') + preselected.email
            : opts.operatorEmail || '',
          people: employees,
          idField: 'operator_user_id',
          allowManual: true,
          searchPeople: (q) => loadDirectoryEmployees(q),
        },
        {
          name: 'work_date',
          label: 'Work date',
          type: 'date',
          required: true,
          defaultValue: workDate,
        },
        {
          name: 'starts_local',
          label: 'Start (local)',
          type: 'datetime-local',
          required: true,
          defaultValue: toLocalDateTimeValue(win.start),
        },
        {
          name: 'ends_local',
          label: 'End (local)',
          type: 'datetime-local',
          required: true,
          defaultValue: toLocalDateTimeValue(win.end),
        },
        {
          name: 'role_context',
          label: 'Role',
          type: 'select',
          defaultValue: opts.roleContext || 'operator',
          options: [
            { value: 'operator', label: 'Operator' },
            { value: 'supervisor', label: 'Supervisor' },
          ],
        },
      ],
      validate: (v) => {
        const email = String(v.operator_email || '')
          .trim()
          .toLowerCase();
        if (!email || !email.includes('@')) return 'Select a directory user or enter a valid email';
        const startIso = localDateTimeToIso(v.starts_local);
        const endIso = localDateTimeToIso(v.ends_local);
        if (!startIso || !endIso) return 'Enter valid start and end times';
        if (new Date(endIso) <= new Date(startIso)) return 'End must be after start';
        return null;
      },
    });
    if (!values) return null;
    const operatorEmail = String(values.operator_email || '')
      .trim()
      .toLowerCase();
    const emp = employees.find((e) => e.email === operatorEmail);
    return {
      operator_email: operatorEmail,
      operator_user_id: values.operator_user_id || (emp ? emp.id : operatorEmail),
      work_date: values.work_date || workDate,
      starts_at: localDateTimeToIso(values.starts_local),
      ends_at: localDateTimeToIso(values.ends_local),
      role_context: values.role_context || 'operator',
    };
  }

  async function renderSchedule(root) {
    if (!_state.schedAnchor) _state.schedAnchor = ymdLocal(new Date());
    await loadStations();
    const canManage = canManageSchedule();
    const view = _state.schedView || 'week';
    const anchor = _state.schedAnchor;
    const days = view === 'day' ? [anchor] : weekDates(anchor);
    const from = days[0];
    const to = days[days.length - 1];
    const qs = new URLSearchParams({
      station_id: _state.stationId || '',
    });
    if (view === 'day') qs.set('work_date', from);
    else {
      qs.set('work_date_from', from);
      qs.set('work_date_to', to);
    }
    const data = await api('/hub/control-room/schedule?' + qs.toString());
    const assignments = data.assignments || [];
    const overlaps = data.overlaps || [];
    const overlapIds = new Set();
    overlaps.forEach((o) => {
      if (o.a) overlapIds.add(o.a);
      if (o.b) overlapIds.add(o.b);
    });
    const gapsByDate = data.gaps_by_date || {};
    if (view === 'day' && data.gaps) gapsByDate[from] = data.gaps;

    const stationOpts = (_state.stations || [])
      .map(
        (s) =>
          `<option value="${esc(s.id)}"${s.id === _state.stationId ? ' selected' : ''}>${esc(s.name || s.key)}</option>`
      )
      .join('');

    const viewBtns = ['day', 'week', 'list']
      .map(
        (v) =>
          `<button type="button" class="hub-btn ${_state.schedView === v ? 'hub-btn-primary' : 'hub-btn-ghost'}" data-cr-sched-view="${v}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>`
      )
      .join('');

    const rangeLabel =
      view === 'day'
        ? parseYmdLocal(anchor).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : `${parseYmdLocal(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseYmdLocal(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    let bodyHtml = '';
    if (view === 'list') {
      bodyHtml = !assignments.length
        ? '<p class="cr-sched-ok">No assignments in this range.</p>'
        : `<table class="hub-table"><thead><tr><th>Operator</th><th>When</th><th>Role</th><th></th></tr></thead><tbody>
          ${assignments
            .map((a) => {
              const conflict = overlapIds.has(a.id);
              return `<tr class="${conflict ? 'cr-sched-conflict' : ''}">
              <td>${esc(a.operator_email)}${conflict ? ' <span class="cr-sched-badge">Overlap</span>' : ''}</td>
              <td>${esc(formatRange(a.starts_at, a.ends_at))}</td>
              <td>${esc(a.role_context || '—')}</td>
              <td>${
                canManage
                  ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-sched-edit="${esc(a.id)}">Edit</button>
                     <button type="button" class="hub-btn hub-btn-ghost" data-cr-sched-del="${esc(a.id)}">Remove</button>`
                  : ''
              }</td>
            </tr>`;
            })
            .join('')}
        </tbody></table>`;
    } else {
      bodyHtml = `<div class="cr-sched-grid" style="--cr-days:${days.length}">
        ${days
          .map((day) => {
            const dayAssign = assignments.filter((a) => a.work_date === day);
            const gaps = gapsByDate[day] || [];
            const dayLabel = parseYmdLocal(day).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
            const blocks = dayAssign
              .map((a) => {
                const conflict = overlapIds.has(a.id);
                return `<button type="button" class="cr-sched-block${conflict ? ' is-conflict' : ''}" data-cr-sched-edit="${esc(a.id)}" ${canManage ? '' : 'disabled'}>
                  <strong>${esc(a.operator_email.split('@')[0])}</strong>
                  <span>${esc(formatRange(a.starts_at, a.ends_at))}</span>
                  <span class="hub-sub">${esc(a.role_context || 'operator')}${conflict ? ' · overlap' : ''}</span>
                </button>`;
              })
              .join('');
            const gapBlocks = gaps
              .map(
                (g) =>
                  `<button type="button" class="cr-sched-gap" data-cr-sched-gap-start="${esc(g.starts_at)}" data-cr-sched-gap-end="${esc(g.ends_at)}" data-cr-sched-gap-date="${esc(day)}" ${canManage ? '' : 'disabled'}>
                    Unassigned · ${esc(formatRange(g.starts_at, g.ends_at))}
                  </button>`
              )
              .join('');
            const emptyAdd =
              canManage && !dayAssign.length && !gaps.length
                ? `<button type="button" class="cr-sched-gap" data-cr-sched-gap-date="${esc(day)}">+ Assign coverage</button>`
                : '';
            return `<div class="cr-sched-day">
              <div class="cr-sched-day-head">${esc(dayLabel)}</div>
              <div class="cr-sched-day-body">${blocks || ''}${gapBlocks || ''}${emptyAdd || (!dayAssign.length && !gaps.length ? '<p class="hub-sub">No coverage planned</p>' : '')}</div>
            </div>`;
          })
          .join('')}
      </div>`;
    }

    const gapCount = Object.values(gapsByDate).reduce((n, g) => n + (g || []).length, 0);

    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head cr-sched-toolbar">
          <div>
            <h2>Schedule</h2>
            <p class="hub-sub" style="margin:4px 0 0">${esc(rangeLabel)} · Gaps ${gapCount} · Overlaps ${overlaps.length}</p>
          </div>
          <div class="cr-sched-controls">
            <select id="crSchedStation" class="input" style="width:auto;min-width:140px" aria-label="Station">${stationOpts}</select>
            <div class="hub-inline-tabs" style="display:flex;gap:4px">${viewBtns}</div>
            <button type="button" class="hub-btn hub-btn-ghost" id="crSchedPrev" aria-label="Previous">‹</button>
            <button type="button" class="hub-btn hub-btn-ghost" id="crSchedToday">Today</button>
            <button type="button" class="hub-btn hub-btn-ghost" id="crSchedNext" aria-label="Next">›</button>
            ${canManage ? '<button type="button" class="hub-btn hub-btn-primary" id="crSchedAdd">+ Assignment</button>' : ''}
          </div>
        </div>
        <div class="hub-panel-body pad">${bodyHtml}</div>
      </div>`;

    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelectorAll('[data-cr-sched-view]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.schedView = b.getAttribute('data-cr-sched-view');
        render();
      })
    );
    root.querySelector('#crSchedStation')?.addEventListener('change', (e) => {
      _state.stationId = e.target.value;
      _state.current = null;
      render();
    });
    root.querySelector('#crSchedPrev')?.addEventListener('click', () => {
      _state.schedAnchor = addDaysYmd(anchor, view === 'day' ? -1 : -7);
      render();
    });
    root.querySelector('#crSchedNext')?.addEventListener('click', () => {
      _state.schedAnchor = addDaysYmd(anchor, view === 'day' ? 1 : 7);
      render();
    });
    root.querySelector('#crSchedToday')?.addEventListener('click', () => {
      _state.schedAnchor = ymdLocal(new Date());
      render();
    });

    const byId = Object.fromEntries(assignments.map((a) => [a.id, a]));

    async function createOrUpdate(existing, prefill) {
      if (!canManage || _state.busy) return;
      const body = await openAssignmentForm({
        id: existing?.id,
        workDate: prefill?.work_date || existing?.work_date,
        startsAt: prefill?.starts_at || existing?.starts_at,
        endsAt: prefill?.ends_at || existing?.ends_at,
        operatorEmail: existing?.operator_email,
        operatorUserId: existing?.operator_user_id,
        roleContext: existing?.role_context,
      });
      if (!body) return;
      setBusy(true);
      try {
        if (existing?.id) {
          await api('/hub/control-room/schedule/' + encodeURIComponent(existing.id), {
            method: 'PATCH',
            body,
          });
        } else {
          await api('/hub/control-room/schedule', {
            method: 'POST',
            body: { ...body, station_id: _state.stationId },
          });
        }
        await render();
      } catch (err) {
        await crAlert(err.message);
      } finally {
        setBusy(false);
      }
    }

    root.querySelector('#crSchedAdd')?.addEventListener('click', () => createOrUpdate(null, { work_date: anchor }));
    root.querySelectorAll('[data-cr-sched-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = byId[btn.getAttribute('data-cr-sched-edit')];
        if (a) createOrUpdate(a);
      });
    });
    root.querySelectorAll('[data-cr-sched-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!canManage || _state.busy) return;
        const id = btn.getAttribute('data-cr-sched-del');
        const ok = global.streamlineModal?.confirm
          ? await global.streamlineModal.confirm({
              title: 'Remove assignment?',
              body: 'This permanently removes the schedule assignment.',
              okLabel: 'Remove',
            })
          : window.confirm('Remove assignment?');
        if (!ok) return;
        setBusy(true);
        try {
          await api('/hub/control-room/schedule/' + encodeURIComponent(id), { method: 'DELETE' });
          await render();
        } catch (err) {
          await crAlert(err.message);
        } finally {
          setBusy(false);
        }
      });
    });
    root.querySelectorAll('[data-cr-sched-gap-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = btn.getAttribute('data-cr-sched-gap-date');
        const gs = btn.getAttribute('data-cr-sched-gap-start');
        const ge = btn.getAttribute('data-cr-sched-gap-end');
        createOrUpdate(null, {
          work_date: day,
          starts_at: gs || undefined,
          ends_at: ge || undefined,
        });
      });
    });
  }

  function compactStatus(label, okText, items, renderItem, onNavigate) {
    const list = items || [];
    if (!list.length) {
      return `<div class="cr-sup-ok"><strong>${esc(label)}</strong> · ${esc(okText)}</div>`;
    }
    return `<div class="hub-panel">
      <div class="hub-panel-head"><h2>${esc(label)} <span class="cr-sched-badge">${list.length}</span></h2>
        ${onNavigate ? `<button type="button" class="hub-btn hub-btn-ghost" data-cr-nav="${esc(onNavigate)}">Open</button>` : ''}
      </div>
      <div class="hub-panel-body pad">
        <ul class="cr-sup-list">${list
          .slice(0, 8)
          .map((it) => `<li>${renderItem(it)}</li>`)
          .join('')}${list.length > 8 ? `<li class="hub-sub">+${list.length - 8} more</li>` : ''}</ul>
      </div>
    </div>`;
  }

  async function renderSupervisor(root) {
    if (!hasPerm('control_room_supervisor')) {
      root.innerHTML = `${subNavHtml()}<p class="hub-empty">Supervisor access required.</p>`;
      root.querySelectorAll('[data-cr-sub]').forEach((b) =>
        b.addEventListener('click', () => {
          _state.sub = b.getAttribute('data-cr-sub');
          render();
        })
      );
      return;
    }
    const ov = await api('/hub/control-room/supervisor?station_id=' + encodeURIComponent(_state.stationId || ''));
    const operators = ov.active_operators || [];
    const gaps = ov.coverage_gaps || [];
    const unacked = ov.unacknowledged_attention_urgent || [];
    const overdue = ov.overdue_tasks || [];
    const board = ov.open_board_items || [];
    const pending = ov.pending_handover;

    const staffing = `<div class="hub-panel">
      <div class="hub-panel-head"><h2>Current staffing</h2>
        <button type="button" class="hub-btn hub-btn-ghost" data-cr-nav="schedule">Schedule</button>
      </div>
      <div class="hub-panel-body pad">
        ${
          operators.length
            ? `<ul class="cr-sup-list">${operators.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
            : '<div class="cr-sup-ok">No active operators on the current shift.</div>'
        }
      </div>
    </div>`;

    root.innerHTML = `${subNavHtml()}
      <div class="cr-sup-stack">
        ${staffing}
        ${compactStatus(
          'Coverage gaps',
          'Full coverage for today',
          gaps,
          (g) => esc(formatRange(g.starts_at, g.ends_at)),
          'schedule'
        )}
        ${compactStatus(
          'Unacknowledged important events',
          'All clear',
          unacked,
          (l) => `${esc(l.priority)} · ${esc((l.body || l.summary || '').slice(0, 80))}`,
          'current'
        )}
        ${compactStatus(
          'Open board issues',
          'No open board items',
          board,
          (b) => `${esc(b.title)} · ${esc(b.priority || '')}`,
          'board'
        )}
        ${compactStatus(
          'Overdue tasks',
          'No overdue tasks',
          overdue,
          (t) => `${esc(t.title)} · ${esc(t.assignee_email || 'unassigned')}`,
          'tasks'
        )}
        ${
          pending
            ? `<div class="hub-panel"><div class="hub-panel-head"><h2>Pending handover</h2>
                <button type="button" class="hub-btn hub-btn-ghost" data-cr-nav="handover">Open</button></div>
                <div class="hub-panel-body pad"><p>${esc(pending.outgoing_note || 'Awaiting acknowledgement')} · ${esc(pending.outgoing_by || '')}</p></div></div>`
            : '<div class="cr-sup-ok"><strong>Pending handovers</strong> · None</div>'
        }
      </div>`;

    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelectorAll('[data-cr-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-nav');
        render();
      })
    );
  }

  async function renderHistory(root) {
    const items = (
      await api('/hub/control-room/history?station_id=' + encodeURIComponent(_state.stationId || ''))
    ).items;
    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head"><h2>Operational history</h2>
          <select id="crHistType" class="input" style="width:auto">
            <option value="">All types</option>
            <option value="shift_log">Logs</option>
            <option value="board">Board</option>
            <option value="task">Tasks</option>
            <option value="handover">Handover</option>
            <option value="acknowledgement">Acknowledgements</option>
          </select>
        </div>
        <div class="hub-panel-body pad" id="crHistBody">${renderHistoryTable(items)}</div>
      </div>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelector('#crHistType')?.addEventListener('change', async (e) => {
      const t = e.target.value;
      const qs = new URLSearchParams({ station_id: _state.stationId || '' });
      if (t) qs.set('record_type', t);
      const data = await api('/hub/control-room/history?' + qs.toString());
      const body = root.querySelector('#crHistBody');
      if (body) body.innerHTML = renderHistoryTable(data.items || []);
    });
  }

  function renderHistoryTable(items) {
    if (!items.length) return '<p class="hub-empty">No history for this filter.</p>';
    return `<table class="hub-table"><thead><tr><th>When</th><th>Type</th><th>Summary</th><th>Operator</th><th>Pri</th><th>Status</th></tr></thead><tbody>
      ${items
        .map(
          (i) => `<tr>
        <td>${esc(new Date(i.at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td>
        <td>${esc(i.record_type)}</td>
        <td>${esc(i.summary)}</td>
        <td>${esc(i.operator || '—')}</td>
        <td>${esc(i.priority || '—')}</td>
        <td>${esc(i.status || '—')}</td>
      </tr>`
        )
        .join('')}
    </tbody></table>`;
  }

  async function render() {
    const root = rootEl();
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading Control Room…</div>';
    try {
      if (!_state.stationId || !_state.current) {
        const cur = await api('/hub/control-room/current');
        _state.current = cur;
        _state.stationId = cur.station?.id || null;
      }
      if (_state.sub === 'current') await renderCurrent(root);
      else if (_state.sub === 'board') await renderBoard(root);
      else if (_state.sub === 'tasks') await renderTasks(root);
      else if (_state.sub === 'handover') await renderHandover(root);
      else if (_state.sub === 'schedule') await renderSchedule(root);
      else if (_state.sub === 'history') await renderHistory(root);
      else if (_state.sub === 'supervisor') await renderSupervisor(root);
      else await renderCurrent(root);
    } catch (err) {
      const msg =
        err.status === 401
          ? 'Session expired. Sign in again.'
          : err.status === 403
            ? 'Control Room access not granted.'
            : err.message || 'Failed to load Control Room';
      root.innerHTML = `<p class="hub-empty">${esc(msg)}</p>`;
    }
  }

  function initHubControlRoom() {
    if (typeof global.HubUI?.showHubPage === 'function') {
      global.HubUI.showHubPage('hub-control-room');
    }
    const root = rootEl();
    if (!root) return;
    if (global.RbacClient && !global.RbacClient.isPortalNoAuthMode()) {
      const perms = global.RbacClient.getPermissions ? global.RbacClient.getPermissions() : [];
      if (!global.RbacClient.canAccessHubTab(perms, 'hub-control-room')) {
        root.innerHTML = `<div class="hub-access-restricted" role="status">
          <h2>Access restricted</h2>
          <p>You do not have permission to view Control Room. Contact an administrator if you need access.</p>
        </div>`;
        return;
      }
    }
    _booted = true;
    render();
  }

  global.initHubControlRoom = initHubControlRoom;
  global.HubControlRoom = { init: initHubControlRoom, render };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
