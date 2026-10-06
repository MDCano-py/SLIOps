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
    return `<div class="hub-kpi-row">
      <div class="hub-kpi"><div class="hub-kpi-label">Station</div><div class="hub-kpi-value">${esc(current.station?.name || '—')}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Shift</div><div class="hub-kpi-value">${esc(shift?.name || 'None')}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Window</div><div class="hub-kpi-value" style="font-size:13px">${esc(shift ? `${new Date(shift.starts_at).toLocaleString()} – ${new Date(shift.ends_at).toLocaleString()}` : '—')}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Now</div><div class="hub-kpi-value" style="font-size:13px">${esc(new Date(current.current_time).toLocaleString())}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Unacked</div><div class="hub-kpi-value">${esc(current.unacknowledged_count)}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Board</div><div class="hub-kpi-value">${esc(current.open_board_count)}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">Tasks</div><div class="hub-kpi-value">${esc(current.open_task_count)}</div></div>
    </div>
    <p class="hub-sub" style="margin:8px 0 14px">Operators: ${esc((current.assignments || []).map((a) => a.operator_email).join(', ') || '—')}</p>`;
  }

  async function renderCurrent(root) {
    const current = await api('/hub/control-room/current' + (_state.stationId ? `?station_id=${encodeURIComponent(_state.stationId)}` : ''));
    _state.current = current;
    _state.stationId = current.station?.id || _state.stationId;
    const meta = await api('/hub/control-room/meta?station_id=' + encodeURIComponent(_state.stationId || ''));
    const logs = await api(
      '/hub/control-room/logs?shift_id=' + encodeURIComponent(current.shift?.id || '') + '&station_id=' + encodeURIComponent(_state.stationId || '')
    );
    const units = meta.units || [];
    root.innerHTML = `${subNavHtml()}${kpiRow(current)}
      <div class="hub-dash-grid" style="grid-template-columns:1fr 1fr;gap:14px">
        <div class="hub-panel">
          <div class="hub-panel-head"><h2>Quick Log</h2></div>
          <div class="hub-panel-body pad">
            ${
              hasPerm('control_room_log')
                ? `<form id="crQuickLogForm">
              <label>Unit<select name="unit_id" class="input">${units.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
              <label>Category<select name="category" class="input">
                ${['Operations', 'Maintenance', 'Safety', 'Process', 'Communication', 'Other'].map((c) => `<option>${c}</option>`).join('')}
              </select></label>
              <label>Priority<select name="priority" class="input">
                <option>Normal</option><option>Attention</option><option>Urgent</option>
              </select></label>
              <label>Summary<input class="input" name="summary" required maxlength="200" /></label>
              <label>Details<textarea class="input" name="details" rows="3"></textarea></label>
              <label>MaintainX asset ID<input class="input" name="maintainx_asset_id" placeholder="optional" /></label>
              <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="follow_up" /> Follow-up required</label>
              <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="carryover" /> Mark for handover</label>
              <button type="submit" class="hub-btn hub-btn-primary" data-cr-submit>Log event</button>
              <p class="hub-empty" id="crQuickLogMsg" style="display:none"></p>
            </form>`
                : '<p class="hub-empty">You do not have permission to create logs.</p>'
            }
          </div>
        </div>
        <div class="hub-panel">
          <div class="hub-panel-head"><h2>Shift timeline</h2>
            <div style="display:flex;gap:6px">
              <select id="crFilterPriority" class="input" style="width:auto"><option value="">Priority</option><option>Normal</option><option>Attention</option><option>Urgent</option></select>
              <select id="crFilterAck" class="input" style="width:auto"><option value="">Ack</option><option value="unacked">Unacked</option><option value="acked">Acked</option></select>
            </div>
          </div>
          <div class="hub-panel-body pad" id="crTimelineBody">${renderTimeline(logs.logs || [])}</div>
        </div>
      </div>
      <div class="hub-panel" style="margin-top:14px">
        <div class="hub-panel-head"><h2>Recent important activity</h2></div>
        <div class="hub-panel-body pad">${renderTimeline(current.recent_important || [], { compact: true })}</div>
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
          alert(err.status === 403 ? 'Not authorized to acknowledge.' : err.message);
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
      const title = prompt('Board item title');
      if (!title || _state.busy) return;
      setBusy(true);
      try {
        await api('/hub/control-room/board', {
          method: 'POST',
          body: { station_id: _state.stationId, title, priority: 'Attention' },
        });
        await render();
      } catch (err) {
        alert(err.message);
      } finally {
        setBusy(false);
      }
    });
    root.querySelectorAll('[data-cr-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        const note = prompt('Resolution note (optional)') || '';
        setBusy(true);
        try {
          await api('/hub/control-room/board/' + encodeURIComponent(btn.getAttribute('data-cr-resolve')) + '/resolve', {
            method: 'POST',
            body: { resolution_note: note },
          });
          await render();
        } catch (err) {
          alert(err.message);
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
      const title = prompt('Task title');
      if (!title || _state.busy) return;
      const due = prompt('Due time ISO or blank', new Date(Date.now() + 3600e3).toISOString()) || null;
      setBusy(true);
      try {
        await api('/hub/control-room/tasks', {
          method: 'POST',
          body: { station_id: _state.stationId, title, due_at: due, priority: 'Normal' },
        });
        await render();
      } catch (err) {
        alert(err.message);
      } finally {
        setBusy(false);
      }
    });
    root.querySelectorAll('[data-cr-complete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (_state.busy) return;
        const note = prompt('Completion note') || '';
        setBusy(true);
        try {
          await api('/hub/control-room/tasks/' + encodeURIComponent(btn.getAttribute('data-cr-complete')), {
            method: 'PATCH',
            body: { status: 'Completed', completion_note: note },
          });
          await render();
        } catch (err) {
          alert(err.message);
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
      const note = prompt('Outgoing handover note') || '';
      setBusy(true);
      try {
        await api('/hub/control-room/handovers', {
          method: 'POST',
          body: { station_id: _state.stationId, outgoing_note: note, complete_outgoing_shift: false },
        });
        await render();
      } catch (err) {
        alert(err.message);
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
          alert(err.message);
        } finally {
          setBusy(false);
        }
      });
    });
  }

  async function renderSchedule(root) {
    const today = new Date().toISOString().slice(0, 10);
    const data = await api(
      '/hub/control-room/schedule?station_id=' +
        encodeURIComponent(_state.stationId || '') +
        '&work_date=' +
        encodeURIComponent(today)
    );
    root.innerHTML = `${subNavHtml()}
      <div class="hub-panel">
        <div class="hub-panel-head"><h2>Schedule · ${esc(today)}</h2>
          ${
            hasPerm('control_room_schedule_manage')
              ? '<button type="button" class="hub-btn hub-btn-primary" id="crSchedAdd">+ Assignment</button>'
              : ''
          }
        </div>
        <div class="hub-panel-body pad">
          <p class="hub-sub">Gaps: ${(data.gaps || []).length} · Overlaps: ${(data.overlaps || []).length}</p>
          ${
            !(data.assignments || []).length
              ? '<p class="hub-empty">No schedule assignments for today.</p>'
              : `<table class="hub-table"><thead><tr><th>Operator</th><th>Start</th><th>End</th><th>Role</th></tr></thead><tbody>
            ${(data.assignments || [])
              .map(
                (a) => `<tr>
              <td>${esc(a.operator_email)}</td>
              <td>${esc(new Date(a.starts_at).toLocaleString())}</td>
              <td>${esc(new Date(a.ends_at).toLocaleString())}</td>
              <td>${esc(a.role_context || '—')}</td>
            </tr>`
              )
              .join('')}
          </tbody></table>`
          }
          ${
            (data.gaps || []).length
              ? `<h3 style="margin-top:16px">Coverage gaps</h3><ul>${data.gaps
                  .map((g) => `<li>${esc(new Date(g.starts_at).toLocaleString())} – ${esc(new Date(g.ends_at).toLocaleString())}</li>`)
                  .join('')}</ul>`
              : ''
          }
        </div>
      </div>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
    root.querySelector('#crSchedAdd')?.addEventListener('click', async () => {
      if (_state.busy) return;
      const operator = prompt('Operator email');
      if (!operator) return;
      const start = prompt('Start ISO', new Date().toISOString());
      const end = prompt('End ISO', new Date(Date.now() + 8 * 3600e3).toISOString());
      setBusy(true);
      try {
        await api('/hub/control-room/schedule', {
          method: 'POST',
          body: {
            station_id: _state.stationId,
            operator_email: operator,
            work_date: today,
            starts_at: start,
            ends_at: end,
            role_context: 'operator',
          },
        });
        await render();
      } catch (err) {
        alert(err.message);
      } finally {
        setBusy(false);
      }
    });
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
        <td>${esc(new Date(i.at).toLocaleString())}</td>
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
    root.innerHTML = `${subNavHtml()}${kpiRow(ov.current)}
      <div class="hub-dash-grid" style="grid-template-columns:1fr 1fr;gap:14px">
        <div class="hub-panel"><div class="hub-panel-head"><h2>Active operators</h2></div>
          <div class="hub-panel-body pad">${(ov.active_operators || []).length ? `<ul>${ov.active_operators.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="hub-empty">None</p>'}</div></div>
        <div class="hub-panel"><div class="hub-panel-head"><h2>Coverage gaps (today)</h2></div>
          <div class="hub-panel-body pad">${(ov.coverage_gaps || []).length ? `<ul>${ov.coverage_gaps.map((g) => `<li>${esc(new Date(g.starts_at).toLocaleString())} – ${esc(new Date(g.ends_at).toLocaleString())}</li>`).join('')}</ul>` : '<p class="hub-empty">No gaps detected</p>'}</div></div>
        <div class="hub-panel"><div class="hub-panel-head"><h2>Unacked Attention/Urgent</h2></div>
          <div class="hub-panel-body pad">${renderTimeline(ov.unacknowledged_attention_urgent || [], { compact: true })}</div></div>
        <div class="hub-panel"><div class="hub-panel-head"><h2>Overdue tasks</h2></div>
          <div class="hub-panel-body pad">${
            !(ov.overdue_tasks || []).length
              ? '<p class="hub-empty">None</p>'
              : `<ul>${ov.overdue_tasks.map((t) => `<li>${esc(t.title)} · ${esc(t.assignee_email || 'unassigned')}</li>`).join('')}</ul>`
          }</div></div>
      </div>
      <p class="hub-sub" style="margin-top:12px">Pending handover: ${
        ov.pending_handover ? esc(ov.pending_handover.id) : 'none'
      } · Open board: ${esc((ov.open_board_items || []).length)} · Units with issues: ${esc((ov.units_with_issues || []).length)}</p>`;
    root.querySelectorAll('[data-cr-sub]').forEach((b) =>
      b.addEventListener('click', () => {
        _state.sub = b.getAttribute('data-cr-sub');
        render();
      })
    );
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
    const root = rootEl();
    if (!root) return;
    _booted = true;
    render();
  }

  global.initHubControlRoom = initHubControlRoom;
  global.HubControlRoom = { init: initHubControlRoom, render };
})(typeof window !== 'undefined' ? window : global);
