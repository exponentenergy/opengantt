import React, { useEffect, useMemo, useState } from 'react';
import { rollupTaskTree, TaskNode } from './packages/core';
import { parseSheet, TemplateConfig, ParsedTask } from './packages/parser';
import { frappeApi } from './lib/api';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

type Screen = 'templates' | 'templateEditor' | 'gantts' | 'ganttEditor' | 'settings';
type TemplateDoc = { name: string; description?: string; field_map?: string; grouping?: string; display_columns?: string; owner?: string };
type GanttDoc = { name: string; template?: string | null; field_map?: string; grouping?: string; display_columns?: string; active_style?: string; source_file?: string; parsed_at?: string; owner?: string };
type TaskDoc = { name: string; gantt: string; parent_task?: string; task_name: string; kind: 'group' | 'leaf'; start_date?: string; end_date?: string; actual_start?: string; actual_end?: string; sort_order: number; fields?: string };
type StyleDoc = { name: string; template: string; config?: string };
type StyleConfig = {
  canvas?: 'light' | 'dark';
  font?: string;
  header?: string;
  footer?: string;
  colors?: { leaf?: string; group?: string };
  colors_by_status?: Record<string, string>;
  status_field?: string;
};

const FONT_OPTIONS = ['Inter', 'system-ui', 'Georgia', 'Helvetica', 'JetBrains Mono'];
const STATUS_ORDER = ['scope', 'planned', 'prog', 'in-progress', 'dev', 'uat', 'migr', 'migration', 'golive', 'done', 'block', 'blocked'];

function safeJson<T>(s: string | undefined, fallback: T): T { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }
function toNodes(tasks: TaskDoc[]): TaskNode[] {
  return tasks.map((t) => ({
    id: t.name, parentId: t.parent_task || null, path: [t.name], depth: 0, wbsCode: '',
    name: t.task_name, owner: String(fieldsOf(t).Owner || fieldsOf(t)['Data pack Owner'] || fieldsOf(t).owner || ''),
    status: normalizeStatus(fieldsOf(t).Status || fieldsOf(t).Phase || fieldsOf(t).status),
    priority: 'medium', taskType: t.kind,
    startDate: t.start_date || '', endDate: t.end_date || '',
    actualStartDate: t.actual_start, actualEndDate: t.actual_end,
    progress: progressOf(t), color: '#2563eb', resourceLoad: 0,
  }));
}
function addDays(d: Date, days: number) { const r = new Date(d); r.setDate(r.getDate() + days); return r; }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }
function fieldsOf(t: TaskDoc | undefined): Record<string, any> {
  if (!t || !t.fields) return {};
  try { return JSON.parse(t.fields); } catch { return {}; }
}
function sortBySortOrder(a: TaskDoc, b: TaskDoc) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}
function normalizeStatus(value: any): any {
  const s = String(value || 'planned').toLowerCase();
  if (s.includes('block')) return 'blocked';
  if (s.includes('risk')) return 'at-risk';
  if (s.includes('done') || s.includes('complete') || s.includes('live')) return 'done';
  if (s.includes('prog') || s.includes('migr') || s.includes('dev') || s.includes('uat')) return 'in-progress';
  return 'planned';
}
function statusClass(value: any): string {
  const s = String(value || '').toLowerCase();
  if (s.includes('block')) return 'block';
  if (s.includes('go') || s.includes('done') || s.includes('complete')) return 'golive';
  if (s.includes('migr')) return 'migr';
  if (s.includes('uat') || s.includes('test')) return 'uat';
  if (s.includes('dev') || s.includes('build')) return 'dev';
  if (s.includes('prog')) return 'prog';
  if (s.includes('scope') || s.includes('plan')) return 'scope';
  return 'scope';
}
function statusLabel(value: any): string {
  const raw = String(value || 'Scope').trim();
  return raw.length > 13 ? raw.slice(0, 12) + '…' : raw;
}
function progressOf(t: TaskDoc | undefined): number {
  const f = fieldsOf(t);
  const raw = f.Progress ?? f.progress ?? f['% Complete'] ?? f.Complete ?? 0;
  const n = Number(String(raw).replace('%', ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
function ownerOf(t: TaskDoc | undefined): string {
  const f = fieldsOf(t);
  return String(f.Owner || f['Data pack Owner'] || f.owner || f.Assignee || '—');
}
function initials(name: string): string {
  if (!name || name === '—') return '—';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('');
}
function durationDays(n: TaskNode): number {
  const s = n.rollupStartDate || n.startDate;
  const e = n.rollupEndDate || n.endDate || s;
  return s ? Math.max(1, daysBetween(new Date(`${s}T00:00:00Z`), new Date(`${e}T00:00:00Z`)) + 1) : 0;
}

async function copyToClipboard(text: string): Promise<boolean> {
  // Modern API: only works in secure contexts (https / localhost).
  if (typeof navigator !== 'undefined' && navigator.clipboard && (window as any).isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  // Fallback for http://hostname:port etc.: dummy textarea + execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/* ---------- Toast (module-level emitter, no provider) ---------- */
type ToastKind = 'success' | 'error' | 'info';
let _toastEmit: ((msg: string, kind?: ToastKind) => void) | null = null;
export function toast(msg: string, kind: ToastKind = 'success') { _toastEmit?.(msg, kind); }

function ToastHost() {
  const [items, setItems] = useState<Array<{id:number; msg:string; kind:ToastKind}>>([]);
  useEffect(() => {
    let n = 0;
    _toastEmit = (msg, kind = 'success') => {
      const id = ++n;
      setItems(curr => [...curr, { id, msg, kind }]);
      setTimeout(() => setItems(curr => curr.filter(t => t.id !== id)), 2800);
    };
    return () => { _toastEmit = null; };
  }, []);
  if (!items.length) return null;
  return (
    <div className="toast-host">
      {items.map(t => <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>)}
    </div>
  );
}

// Apply persisted theme as soon as the bundle loads so we don't flash white-then-dark.
if (typeof document !== 'undefined') {
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('og-theme')) || '';
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
}

export default function App() {
  // Share-mode: server-rendered template injects window.__OG_SHARE_SNAPSHOT__
  const shareSnapshot = (window as any).__OG_SHARE_SNAPSHOT__;
  if (shareSnapshot) return <SharePage snapshot={shareSnapshot} />;

  const [user, setUser] = useState<string | null>(null);
  // Initial nav state may come from window.history (browser back/forward into the SPA)
  const initial = (typeof history !== 'undefined' && history.state && history.state.__og)
    ? history.state.__og as { screen: Screen; editTemplate: string | null; openGantt: string | null }
    : { screen: 'templates' as Screen, editTemplate: null, openGantt: null };
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [editTemplate, setEditTemplate] = useState<string | null>(initial.editTemplate);
  const [openGantt, setOpenGantt] = useState<string | null>(initial.openGantt);

  useEffect(() => { frappeApi.getUser().then((r: any) => setUser(r.message)).catch(()=>setUser('Guest')); }, []);

  // History: push on screen change, restore on back/forward
  useEffect(() => {
    history.replaceState({ __og: { screen, editTemplate, openGantt } }, '');
  }, []); // run once to seed current entry
  useEffect(() => {
    const state = { __og: { screen, editTemplate, openGantt } };
    // Skip pushing the very first render (replaceState handled it)
    if (history.state && history.state.__og &&
        history.state.__og.screen === screen &&
        history.state.__og.editTemplate === editTemplate &&
        history.state.__og.openGantt === openGantt) return;
    history.pushState(state, '');
  }, [screen, editTemplate, openGantt]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (e.state && e.state.__og) {
        setScreen(e.state.__og.screen);
        setEditTemplate(e.state.__og.editTemplate);
        setOpenGantt(e.state.__og.openGantt);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (!user) return <div className="empty-state" style={{ height: '100vh' }}><strong>OpenGantt</strong><span>Loading...</span></div>;

  return (
    <div className="app-shell">
      <aside className="sidenav">
        <div className="sidenav-brand">
          <img src="/assets/opengantt/logo.svg" alt="" width="28" height="28" />
          <span>OpenGantt</span>
        </div>
        <nav className="sidenav-links">
          <button className={screen==='templates'||screen==='templateEditor'?'active':''} onClick={()=>setScreen('templates')}>
            <span className="icon">▤</span> Templates
          </button>
          <button className={screen==='gantts'||screen==='ganttEditor'?'active':''} onClick={()=>{setOpenGantt(null);setScreen('gantts');}}>
            <span className="icon">▦</span> Gantts
          </button>
        </nav>
        <div className="sidenav-foot">
          <button className={screen==='settings'?'active':''} onClick={()=>setScreen('settings')}>
            <span className="icon">⚙</span> Settings
          </button>
          <div className="sidenav-user">
            <div className="avatar">{(user||'?').slice(0,1).toUpperCase()}</div>
            <span title={user}>{user}</span>
          </div>
        </div>
      </aside>
      <div className="page-wrap">
        {screen==='templates' && <TemplatesScreen onEdit={(n)=>{setEditTemplate(n);setScreen('templateEditor');}} />}
        {screen==='templateEditor' && <TemplateEditorScreen name={editTemplate} onBack={()=>setScreen('templates')} />}
        {screen==='gantts' && <GanttsScreen onOpen={(n)=>{setOpenGantt(n);setScreen('ganttEditor');}} />}
        {screen==='ganttEditor' && <GanttEditorScreen name={openGantt} onBack={()=>setScreen('gantts')} />}
        {screen==='settings' && <SettingsScreen user={user} />}
      </div>
      <ToastHost />
    </div>
  );
}

function TemplatesScreen({ onEdit }: { onEdit: (n: string) => void }) {
  const [items, setItems] = useState<TemplateDoc[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'name-asc'|'name-desc'|'newest'|'oldest'>('name-asc');
  const refresh = () => { setLoading(true); frappeApi.list('OG Template').then((r: any) => { setItems(r || []); setLoading(false); }); };
  useEffect(() => { refresh(); }, []);
  const create = async () => {
    if (!newName.trim()) return;
    try { await frappeApi.create('OG Template', { name: newName }); toast(`Template "${newName}" created`); }
    catch (e: any) { toast(e?.message || 'Failed to create template', 'error'); return; }
    setNewName(''); setShowNew(false); refresh();
  };
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let arr = !f ? items : items.filter(t => t.name.toLowerCase().includes(f) || (t.description||'').toLowerCase().includes(f));
    arr = [...arr].sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name);
      if (sort === 'name-desc') return b.name.localeCompare(a.name);
      const am = (a as any).modified || (a as any).creation || '';
      const bm = (b as any).modified || (b as any).creation || '';
      return sort === 'newest' ? bm.localeCompare(am) : am.localeCompare(bm);
    });
    return arr;
  }, [items, filter, sort]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My Templates</h1><p>Describe the shape of your input files so they parse into Gantts.</p></div>
        <button className="btn btn-primary" onClick={()=>setShowNew(true)}>+ New Template</button>
      </div>
      <div className="filters-bar">
        <input className="filter-input" placeholder="Search templates by name or description…" value={filter} onChange={e=>setFilter(e.target.value)} />
        <select className="filter-select" value={sort} onChange={e=>setSort(e.target.value as any)}>
          <option value="name-asc">Name A→Z</option>
          <option value="name-desc">Name Z→A</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <span className="filter-count">{filtered.length} of {items.length}</span>
      </div>
      {showNew && (
        <div className="card" style={{ display:'flex', gap:8 }}>
          <input placeholder="Template name" value={newName} onChange={e=>setNewName(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==='Enter')create();}} />
          <button className="btn btn-primary" onClick={create}>Save</button>
          <button className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button>
        </div>
      )}
      {loading ? <div className="empty-state"><span>Loading templates…</span></div> :
        <div className="list">
          {filtered.map(t => (
            <div key={t.name} className="row">
              <div onClick={()=>onEdit(t.name)} style={{cursor:'pointer',flex:1,minWidth:0}}>
                <strong>{t.name}</strong><span>{t.description || 'No description'}</span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost" onClick={()=>onEdit(t.name)}>Edit</button>
                <button className="btn btn-danger" onClick={async ()=>{
                  if(!confirm(`Delete template "${t.name}"?\n\nExisting Gantts will keep working. Their "created from template" link will be cleared; tasks and shares are untouched.`)) return;
                  try {
                    const r: any = await frappeApi.deleteTemplate(t.name);
                    const n = r?.message?.detached_gantts ?? 0;
                    toast(`Template "${t.name}" deleted${n?` (${n} Gantt${n>1?'s':''} detached)`:''}`);
                    refresh();
                  } catch(e:any){ toast(e?.message || 'Delete failed', 'error'); }
                }}>Delete</button>
              </div>
            </div>
          ))}
          {filtered.length===0 && items.length>0 && <div className="empty-state"><span>No templates match "{filter}".</span></div>}
          {items.length===0 && <div className="empty-state"><strong>No templates yet</strong><span>Create one to describe your spreadsheet's columns.</span></div>}
        </div>
      }
    </div>
  );
}

function TemplateEditorScreen({ name, onBack }: { name: string | null; onBack: () => void }) {
  const [doc, setDoc] = useState<TemplateDoc | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string,string>>({});
  const [grouping, setGrouping] = useState<string[]>([]);
  const [displayColumns, setDisplayColumns] = useState<string[]>([]);
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [editingStyle, setEditingStyle] = useState<StyleDoc | null>(null);
  const [sampleCols, setSampleCols] = useState<string[]>([]);
  const reload = (n: string) => {
    frappeApi.read('OG Template', n).then((r: any) => {
      setDoc(r);
      setFieldMap(safeJson(r.field_map, {}));
      setGrouping(safeJson(r.grouping, []));
      setDisplayColumns(safeJson(r.display_columns, []));
    });
    frappeApi.list('OG Style').then((r: any) => setStyles((r || []).filter((s: StyleDoc) => s.template === n)));
  };
  useEffect(() => { if (name) reload(name); }, [name]);

  // Merge previously-saved column references so the dropdowns aren't blank without a sample
  const allCols = useMemo(() => {
    const set = new Set<string>(sampleCols);
    Object.values(fieldMap).forEach(c => c && set.add(c));
    grouping.forEach(c => set.add(c));
    displayColumns.forEach(c => set.add(c));
    return Array.from(set);
  }, [sampleCols, fieldMap, grouping, displayColumns]);

  const save = async () => {
    if (!doc) return;
    try {
      await frappeApi.update('OG Template', {
        name: doc.name,
        field_map: JSON.stringify(fieldMap),
        grouping: JSON.stringify(grouping),
        display_columns: JSON.stringify(displayColumns),
      });
      toast(`Template "${doc.name}" saved`);
    } catch (e: any) { toast(e?.message || 'Save failed', 'error'); return; }
    onBack();
  };
  const onSample = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      try {
        const wb = XLSX.read(data, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        if (json.length) setSampleCols(json[0].map((c: any) => String(c ?? '')).filter(Boolean));
      } catch {
        Papa.parse(String(data), { header: true, complete: (res) => { if (res.meta.fields) setSampleCols(res.meta.fields); } });
      }
    };
    reader.readAsBinaryString(file);
  };
  const deleteStyle = async (s: StyleDoc) => {
    if (!confirm(`Delete style "${s.name}"?`)) return;
    try { await frappeApi.delete('OG Style', s.name); toast(`Style "${s.name}" deleted`); }
    catch(e:any){ toast(e?.message || 'Delete failed', 'error'); return; }
    if (doc) reload(doc.name);
  };
  if (!doc) return <div className="page"><div className="empty-state">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{doc.name}</h1><p>{doc.description || 'Preset for creating new Gantts'}</p></div>
        <div style={{display:'flex',gap:8}}><button className="btn btn-ghost" onClick={onBack}>Cancel</button><button className="btn btn-primary" onClick={save}>Save changes</button></div>
      </div>
      <div className="note-card">
        Templates are presets. Changes here affect only Gantts created after this save; existing Gantts keep their own stamped schema.
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Sample file</h3>
        <div className="form"><label>Upload a sample to populate the column dropdowns. Saved values are kept even without a sample.<input type="file" accept=".xlsx,.csv,.xls" onChange={onSample} /></label></div>
        {allCols.length>0 && <div style={{fontSize:12,color:'var(--text-muted)'}}>{allCols.length} columns available</div>}
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Field map</h3>
        <p style={{margin:0,color:'var(--text-muted)',fontSize:12}}>Map your file's columns to canonical task fields. <code>name</code> is required for sensible rendering.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
          {['name','start_date','end_date','actual_start','actual_end'].map(k => (
            <div key={k} className="form"><label>{k}
              <select value={fieldMap[k]||''} onChange={e=>setFieldMap({...fieldMap,[k]:e.target.value})}>
                <option value="">— none —</option>
                {allCols.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </label></div>
          ))}
        </div>
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Grouping</h3>
        <p style={{margin:0,color:'var(--text-muted)',fontSize:12}}>Each column adds a hierarchy layer of group rows above the leaves.</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {grouping.map((g,i)=> (
            <span key={i} className="chip">{g} <button onClick={()=>setGrouping(grouping.filter((_,idx)=>idx!==i))} aria-label="remove">×</button></span>
          ))}
          {grouping.length===0 && <span style={{color:'var(--text-faint)',fontSize:12}}>Flat list (no grouping)</span>}
        </div>
        <div className="form"><label>Add grouping column
          <select value="" onChange={e=>{if(e.target.value){setGrouping([...grouping,e.target.value]);}}}>
            <option value="">— pick a column —</option>
            {allCols.filter(c=>!grouping.includes(c)).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </label></div>
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Display columns</h3>
        <p style={{margin:0,color:'var(--text-muted)',fontSize:12}}>These appear next to each row in the Gantt sidebar.</p>
        {allCols.length===0 ? <span style={{color:'var(--text-faint)',fontSize:12}}>Upload a sample to pick columns.</span> :
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {allCols.map(c => (
              <label key={c} className="checkbox-pill">
                <input type="checkbox" checked={displayColumns.includes(c)} onChange={()=>setDisplayColumns(displayColumns.includes(c)?displayColumns.filter(x=>x!==c):[...displayColumns,c])} /> {c}
              </label>
            ))}
          </div>
        }
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3 style={{margin:0}}>Styles</h3><button className="btn btn-primary" onClick={()=>setEditingStyle({name:'', template:doc.name, config:'{}'})}>New Style</button></div>
        <div className="list">
          {styles.map(s => {
            const cfg = safeJson<StyleConfig>(s.config, {});
            return (
              <div key={s.name} className="row">
                <div>
                  <strong>{s.name}</strong>
                  <span>{cfg.canvas||'light'} · {cfg.font||'Inter'}{cfg.colors_by_status && Object.keys(cfg.colors_by_status).length>0 ? ' · colored by status':''}</span>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{width:14,height:14,borderRadius:3,background:cfg.colors?.leaf||'#2563eb',border:'1px solid var(--line)'}} />
                  <button className="btn btn-ghost" onClick={()=>setEditingStyle(s)}>Edit</button>
                  <button className="btn btn-danger" onClick={()=>deleteStyle(s)}>Delete</button>
                </div>
              </div>
            );
          })}
          {styles.length===0 && <div className="empty-state"><span>No styles yet — add one to control colours and theme.</span></div>}
        </div>
      </div>
      {editingStyle && <StyleEditorModal style={editingStyle} templateName={doc.name} displayColumns={displayColumns} onClose={()=>setEditingStyle(null)} onSaved={()=>{ setEditingStyle(null); if (doc) reload(doc.name); }} />}
    </div>
  );
}

function StyleEditorModal({ style, templateName, displayColumns, onClose, onSaved }: { style: StyleDoc; templateName: string; displayColumns: string[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !style.name;
  const [name, setName] = useState(style.name);
  const initial = safeJson<StyleConfig>(style.config, {});
  const [canvas, setCanvas] = useState<'light'|'dark'>(initial.canvas || 'light');
  const [font, setFont] = useState(initial.font || 'Inter');
  const [header, setHeader] = useState(initial.header || '');
  const [footer, setFooter] = useState(initial.footer || '');
  const [leafColor, setLeafColor] = useState(initial.colors?.leaf || '#2563eb');
  const [groupColor, setGroupColor] = useState(initial.colors?.group || '#0f172a');
  const [statusField, setStatusField] = useState(initial.status_field || '');
  const [colorsByStatus, setColorsByStatus] = useState<Record<string,string>>(initial.colors_by_status || {});
  const [newStatusKey, setNewStatusKey] = useState('');
  const save = async () => {
    if (!name.trim()) return;
    const config: StyleConfig = {
      canvas, font, header, footer,
      colors: { leaf: leafColor, group: groupColor },
      status_field: statusField || undefined,
      colors_by_status: Object.keys(colorsByStatus).length ? colorsByStatus : undefined,
    };
    const body: any = { name, template: templateName, config: JSON.stringify(config) };
    try {
      if (isNew) await frappeApi.create('OG Style', body);
      else await frappeApi.update('OG Style', body);
      toast(`Style "${name}" saved`);
    } catch(e:any){ toast(e?.message || 'Save failed', 'error'); return; }
    onSaved();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>{isNew ? 'New style' : `Edit style: ${name}`}</h2>
        {isNew && <div className="form"><label>Style name<input value={name} onChange={e=>setName(e.target.value)} autoFocus /></label></div>}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="form"><label>Canvas
            <select value={canvas} onChange={e=>setCanvas(e.target.value as any)}><option value="light">Light</option><option value="dark">Dark</option></select>
          </label></div>
          <div className="form"><label>Font
            <select value={font} onChange={e=>setFont(e.target.value)}>{FONT_OPTIONS.map(f=><option key={f}>{f}</option>)}</select>
          </label></div>
        </div>
        <div className="form"><label>Header text<input value={header} onChange={e=>setHeader(e.target.value)} /></label></div>
        <div className="form"><label>Footer text<input value={footer} onChange={e=>setFooter(e.target.value)} /></label></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="form"><label>Leaf bar colour<input type="color" value={leafColor} onChange={e=>setLeafColor(e.target.value)} /></label></div>
          <div className="form"><label>Group bar colour<input type="color" value={groupColor} onChange={e=>setGroupColor(e.target.value)} /></label></div>
        </div>
        <div className="form"><label>Status field (optional)
          <select value={statusField} onChange={e=>setStatusField(e.target.value)}>
            <option value="">— none —</option>
            {displayColumns.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </label>
          <span style={{fontSize:11,color:'var(--text-muted)'}}>If set, leaf bars colour by this field's value using the map below.</span>
        </div>
        {statusField && (
          <div style={{display:'grid',gap:8,border:'1px solid var(--line)',borderRadius:8,padding:12}}>
            <strong style={{fontSize:12}}>Colours by {statusField}</strong>
            {Object.entries(colorsByStatus).map(([k,v]) => (
              <div key={k} style={{display:'grid',gridTemplateColumns:'1fr 60px 30px',gap:8,alignItems:'center'}}>
                <span style={{fontSize:12}}>{k}</span>
                <input type="color" value={v} onChange={e=>setColorsByStatus({...colorsByStatus,[k]:e.target.value})} />
                <button className="btn btn-ghost" onClick={()=>{ const next = {...colorsByStatus}; delete next[k]; setColorsByStatus(next); }}>×</button>
              </div>
            ))}
            <div style={{display:'flex',gap:8}}>
              <input placeholder="status value" value={newStatusKey} onChange={e=>setNewStatusKey(e.target.value)} style={{flex:1}} />
              <button className="btn btn-ghost" onClick={()=>{ if(!newStatusKey.trim()) return; setColorsByStatus({...colorsByStatus,[newStatusKey]:'#2563eb'}); setNewStatusKey(''); }}>Add</button>
            </div>
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function GanttsScreen({ onOpen }: { onOpen: (n: string) => void }) {
  const [items, setItems] = useState<GanttDoc[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [selTemplate, setSelTemplate] = useState('');
  const [preview, setPreview] = useState<ParsedTask[] | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [sort, setSort] = useState<'newest'|'oldest'|'name-asc'|'name-desc'>('newest');
  const refresh = () => { setLoading(true); frappeApi.list('OG Gantt').then((r: any) => { setItems(r||[]); setLoading(false); }); };
  useEffect(() => { refresh(); frappeApi.list('OG Template').then((r: any)=>setTemplates(r||[])); }, []);
  const filteredItems = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let arr = items;
    if (templateFilter) arr = arr.filter(g => g.template === templateFilter);
    if (f) arr = arr.filter(g => g.name.toLowerCase().includes(f) || (g.template||'').toLowerCase().includes(f));
    arr = [...arr].sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name);
      if (sort === 'name-desc') return b.name.localeCompare(a.name);
      const am = a.parsed_at || (a as any).modified || '';
      const bm = b.parsed_at || (b as any).modified || '';
      return sort === 'newest' ? bm.localeCompare(am) : am.localeCompare(bm);
    });
    return arr;
  }, [items, filter, templateFilter, sort]);
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPickedFile(f);
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      let rows: Record<string,any>[] = [];
      try {
        const wb = XLSX.read(data, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string,any>>(ws, { defval: '' });
      } catch {
        Papa.parse(String(data), { header: true, skipEmptyLines: true, complete: (res) => { rows = res.data as Record<string,any>[]; } });
      }
      if (!selTemplate) return;
      const t = templates.find(x=>x.name===selTemplate);
      if (!t) return;
      const cfg: TemplateConfig = { field_map: safeJson(t.field_map,{}), grouping: safeJson(t.grouping,[]), display_columns: safeJson(t.display_columns,[]) };
      setPreview(parseSheet(rows, cfg));
    };
    reader.readAsBinaryString(f);
  };
  const saveGantt = async () => {
    if (!newName.trim() || !selTemplate || !preview) return;
    try {
      const t = templates.find(x=>x.name===selTemplate);
      const g = await frappeApi.create('OG Gantt', {
        name: newName,
        template: selTemplate,
        field_map: t?.field_map || '{}',
        grouping: t?.grouping || '[]',
        display_columns: t?.display_columns || '[]',
      });
      const r: any = await frappeApi.parseUpload({ gantt: g.name, tasks: preview });
      // Attach the original source file so Re-import works later. Non-fatal if it fails.
      if (pickedFile) {
        try { await frappeApi.uploadFile(pickedFile, 'OG Gantt', g.name, 'source_file'); }
        catch (uploadErr: any) { toast(`Tasks saved, but source file attach failed: ${uploadErr?.message || 'unknown'} — Re-import won't be available.`, 'info'); }
      }
      toast(`Gantt "${newName}" created (${r?.message?.count ?? preview.length} tasks)`);
    } catch (e: any) { toast(e?.message || 'Failed to create Gantt', 'error'); return; }
    setShowNew(false); setPreview(null); setPickedFile(null); setNewName(''); setSelTemplate(''); refresh();
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My Gantts</h1><p>Upload spreadsheets against templates to generate Gantts.</p></div>
        <button className="btn btn-primary" onClick={()=>setShowNew(true)} disabled={templates.length===0}>+ New Gantt</button>
      </div>
      <div className="filters-bar">
        <input className="filter-input" placeholder="Search Gantts…" value={filter} onChange={e=>setFilter(e.target.value)} />
        <select className="filter-select" value={templateFilter} onChange={e=>setTemplateFilter(e.target.value)}>
          <option value="">All templates</option>
          {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <select className="filter-select" value={sort} onChange={e=>setSort(e.target.value as any)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name-asc">Name A→Z</option>
          <option value="name-desc">Name Z→A</option>
        </select>
        <span className="filter-count">{filteredItems.length} of {items.length}</span>
      </div>
      {templates.length===0 && <div className="empty-state"><strong>You need a template first</strong><span>Create one on the Templates screen, then return here.</span></div>}
      {showNew && (
        <div className="card" style={{display:'grid',gap:12}}>
          <div className="form"><label>Gantt name<input value={newName} onChange={e=>setNewName(e.target.value)} autoFocus /></label></div>
          <div className="form"><label>Template
            <select value={selTemplate} onChange={e=>setSelTemplate(e.target.value)}><option value="">— pick —</option>{templates.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}</select>
          </label></div>
          <div className="form"><label>Upload file (xlsx / csv)<input type="file" accept=".xlsx,.csv,.xls" onChange={onUpload} /></label></div>
          {preview && (
            <div style={{maxHeight:240,overflow:'auto',border:'1px solid var(--line)',borderRadius:6}}>
              <table className="preview"><thead><tr><th>Task</th><th>Kind</th><th>Start</th><th>End</th></tr></thead>
                <tbody>{preview.slice(0,60).map((t,i)=><tr key={i}><td style={{paddingLeft:`${(t.parent_temp_id?16:0)+8}px`}}>{t.task_name}</td><td>{t.kind}</td><td>{t.start_date||''}</td><td>{t.end_date||''}</td></tr>)}</tbody>
              </table>
              {preview.length>60 && <div style={{padding:8,fontSize:11,color:'var(--text-muted)'}}>…and {preview.length-60} more rows</div>}
            </div>
          )}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button className="btn btn-ghost" onClick={()=>{setShowNew(false);setPreview(null);setPickedFile(null);}}>Cancel</button>
            <button className="btn btn-primary" onClick={saveGantt} disabled={!preview||!newName.trim()}>Save Gantt</button>
          </div>
        </div>
      )}
      {loading ? <div className="empty-state"><span>Loading Gantts…</span></div> :
        <div className="list">
          {filteredItems.map(g => (
            <div key={g.name} className="row">
              <div onClick={()=>onOpen(g.name)} style={{cursor:'pointer',flex:1,minWidth:0}}>
                <strong>{g.name}</strong><span>{g.template}{g.parsed_at?` · parsed ${new Date(g.parsed_at).toLocaleDateString()}`:''}</span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" onClick={()=>onOpen(g.name)}>Open</button>
                <button className="btn btn-danger" onClick={async ()=>{
                  if(!confirm(`Delete Gantt "${g.name}"?\n\nThis also removes its tasks and any public share links. This cannot be undone.`)) return;
                  try { await frappeApi.deleteGantt(g.name); toast(`Gantt "${g.name}" deleted`); refresh(); }
                  catch(e:any){ toast(e?.message || 'Delete failed', 'error'); }
                }}>Delete</button>
              </div>
            </div>
          ))}
          {filteredItems.length===0 && items.length>0 && <div className="empty-state"><span>No Gantts match the current filter.</span></div>}
          {items.length===0 && !loading && <div className="empty-state"><strong>No Gantts yet</strong><span>Upload a file against a template to create one.</span></div>}
        </div>
      }
    </div>
  );
}

function useTaskTree(tasks: TaskDoc[]) {
  return useMemo(() => rollupTaskTree(toNodes(tasks)), [tasks]);
}

function GanttEditorScreen({ name, onBack }: { name: string | null; onBack: () => void }) {
  const [gantt, setGantt] = useState<GanttDoc | null>(null);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [template, setTemplate] = useState<TemplateDoc | null>(null);
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [selStyle, setSelStyle] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState<{ parent: string | null } | null>(null);
  const [zoom, setZoom] = useState<'day'|'week'|'month'|'quarter'>('month');
  const [filter, setFilter] = useState('');
  const [schemaOpen, setSchemaOpen] = useState<'template'|'grouping'|'columns'|null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = (n: string) => Promise.all([
    frappeApi.read('OG Gantt', n).then((r:any)=>setGantt(r)),
    frappeApi.list('OG Task').then((r:any)=>setTasks(((r||[]).filter((t:TaskDoc)=>t.gantt===n)).sort(sortBySortOrder))),
  ]).then(()=>setLoading(false));
  useEffect(() => { if (name) { setLoading(true); reload(name); } }, [name]);
  useEffect(() => {
    if (!gantt) return;
    setSelStyle(gantt.active_style || '');
    if (gantt.template) frappeApi.read('OG Template', gantt.template).then((r:any)=>setTemplate(r)).catch(()=>setTemplate(null));
    else setTemplate(null);
    frappeApi.list('OG Style').then((r:any)=>setStyles((r||[]).filter((s:StyleDoc)=>!gantt.template || s.template===gantt.template)));
  }, [gantt]);

  const styleCfg = useMemo<StyleConfig>(() => {
    const s = styles.find(x=>x.name===selStyle);
    return s ? safeJson(s.config, {}) : {};
  }, [styles, selStyle]);
  const fieldMap = useMemo(() => safeJson<Record<string,string>>(gantt?.field_map, {}), [gantt]);
  const displayColumns: string[] = useMemo(() => safeJson<string[]>(gantt?.display_columns, []), [gantt]);
  const grouping: string[] = useMemo(() => safeJson<string[]>(gantt?.grouping, []), [gantt]);
  const allSchemaColumns = useMemo(() => {
    const set = new Set<string>();
    Object.values(fieldMap).forEach(v => v && set.add(v));
    grouping.forEach(v => set.add(v));
    displayColumns.forEach(v => set.add(v));
    tasks.forEach(t => Object.keys(fieldsOf(t)).forEach(k => set.add(k)));
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }, [fieldMap, grouping, displayColumns, tasks]);

  const nodes = useTaskTree(tasks);
  const docById = useMemo(() => Object.fromEntries(tasks.map(t=>[t.name, t])) as Record<string, TaskDoc>, [tasks]);

  // Apply filter + collapse
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matches = (n: TaskNode) => !f || n.name.toLowerCase().includes(f) || displayColumns.some(c => String(fieldsOf(docById[n.id])[c]||'').toLowerCase().includes(f));
    // Build child index
    const childrenOf = new Map<string|null,TaskNode[]>();
    for (const n of nodes) {
      const arr = childrenOf.get(n.parentId) || [];
      arr.push(n);
      childrenOf.set(n.parentId, arr);
    }
    const out: Array<TaskNode & { depth: number }> = [];
    function walk(parentId: string|null, depth: number) {
      for (const n of (childrenOf.get(parentId) || [])) {
        const cn = { ...n, depth };
        if (!f || matches(n) || hasMatchingDescendant(n, childrenOf, matches)) {
          out.push(cn);
          if (!collapsed.has(n.id)) walk(n.id, depth + 1);
        }
      }
    }
    walk(null, 0);
    return out;
  }, [nodes, filter, collapsed, displayColumns, docById]);

  const datedTasks = useMemo(() => visible.filter(n => n.rollupStartDate || n.startDate), [visible]);
  const hasDates = datedTasks.length > 0;
  const dates = useMemo(() => {
    if (!hasDates) { const today=new Date(); return {start: addDays(today,-15), end: addDays(today, 45)}; }
    const starts = datedTasks.map(n => n.rollupStartDate || n.startDate).filter(Boolean) as string[];
    const ends = datedTasks.map(n => n.rollupEndDate || n.endDate || n.startDate).filter(Boolean) as string[];
    const s = new Date(`${starts.reduce((a,b)=>a<b?a:b)}T00:00:00Z`);
    const e = new Date(`${ends.reduce((a,b)=>a>b?a:b)}T00:00:00Z`);
    return { start: addDays(s,-7), end: addDays(e,7) };
  }, [datedTasks, hasDates]);
  const pxPerDay = zoom==='day'?40:zoom==='week'?12:zoom==='month'?4:1.8;
  const totalDays = Math.max(1, daysBetween(dates.start, dates.end));
  const timelineWidth = totalDays * pxPerDay;

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsed(next);
  };

  const share = async () => {
    if (!gantt) return;
    const snapshot = { tasks, gantt, template, style: styleCfg, displayColumns };
    try {
      const r: any = await frappeApi.publishShare({ gantt: gantt.name, snapshot });
      const url = r?.message?.url || r?.url;
      setShareUrl(window.location.origin + url);
      setShowShare(true);
      toast('Share link created');
    } catch (e:any) { toast(e?.message || 'Share failed', 'error'); }
  };
  const exportHtml = async () => {
    if (!gantt) return;
    try {
      // Fetch the JS + CSS so the saved file works without any server.
      const [jsRes, cssRes] = await Promise.all([
        fetch('/assets/opengantt/opengantt/main.js'),
        fetch('/assets/opengantt/opengantt/main.css'),
      ]);
      if (!jsRes.ok || !cssRes.ok) throw new Error('Couldn’t load bundle for inlining');
      const [js, css] = await Promise.all([jsRes.text(), cssRes.text()]);
      const payload = { tasks, gantt, template, style: styleCfg, displayColumns };
      const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c');
      const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
      const html =
        `<!doctype html><html><head><meta charset="utf-8">` +
        `<title>${(gantt.name || 'OpenGantt Export').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]!))}</title>` +
        `<style>${css}</style></head><body><div id="root"></div>` +
        `<script>window.__OG_SHARE_SNAPSHOT__=${payloadJson};</script>` +
        `<script>${safeJs}</script></body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${gantt.name}.html`;
      document.body.appendChild(a);
      a.click();
      requestAnimationFrame(() => { URL.revokeObjectURL(a.href); a.remove(); });
      toast(`Downloaded ${gantt.name}.html`);
    } catch (e: any) {
      toast(e?.message || 'Export failed', 'error');
    }
  };
  const reimport = async () => {
    if (!gantt) return;
    if (!confirm('Re-import will replace all tasks (any side-panel edits since last import will be lost). Continue?')) return;
    try {
      const r: any = await frappeApi.reimport({ gantt: gantt.name });
      toast(`Re-imported ${r?.message?.count ?? ''} tasks`);
      if (name) reload(name);
    } catch (e: any) {
      toast(e?.message || 'Re-import failed. Attach a source_file first.', 'error');
    }
  };
  const changeStyle = async (val: string) => {
    setSelStyle(val);
    if (gantt) {
      try { await frappeApi.update('OG Gantt', { name: gantt.name, active_style: val || null }); }
      catch (e:any){ toast(e?.message || 'Failed to update style', 'error'); }
    }
  };
  const saveGanttSchema = async (updates: Partial<Pick<GanttDoc, 'field_map'|'grouping'|'display_columns'>>, rebucket = false, rebucketArgs: Record<string, any> = {}) => {
    if (!gantt) return;
    const next = { ...gantt, ...updates };
    setGantt(next);
    try {
      await frappeApi.update('OG Gantt', { name: gantt.name, ...updates });
      if (rebucket && updates.grouping) {
        await frappeApi.rebucketGantt({ gantt: gantt.name, grouping: safeJson<string[]>(updates.grouping, []), ...rebucketArgs });
        await reload(gantt.name);
      }
      toast('Gantt schema saved');
    } catch (e:any) {
      toast(e?.message || 'Failed to save schema', 'error');
      if (name) reload(name);
    }
  };
  const setGroupingColumns = (cols: string[]) => {
    const nameCol = fieldMap.name;
    const nameColIndex = nameCol ? cols.indexOf(nameCol) : -1;
    const hasTaskLevelAfterName = nameColIndex >= 0 && cols.length > nameColIndex + 1;
    if (hasTaskLevelAfterName) {
      const leafNameField = cols[cols.length - 1];
      const nextGrouping = cols.slice(0, -1);
      saveGanttSchema(
        { grouping: JSON.stringify(nextGrouping), field_map: JSON.stringify({ ...fieldMap, name: leafNameField }) },
        true,
        { leaf_name_field: leafNameField },
      );
      toast(`${leafNameField} is the dated task level, so it was set as the task name instead of a repeated group.`, 'info');
    } else {
      saveGanttSchema({ grouping: JSON.stringify(cols) }, true);
    }
    setSchemaOpen(null);
  };
  const setDisplayColumn = (col: string) => {
    const next = displayColumns.includes(col) ? displayColumns.filter(c => c !== col) : [...displayColumns, col];
    saveGanttSchema({ display_columns: JSON.stringify(next) });
  };
  const setFieldMapValue = (key: string, col: string) => {
    saveGanttSchema({ field_map: JSON.stringify({ ...fieldMap, [key]: col }) });
  };

  if (loading || !gantt) return <div className="page"><div className="empty-state">Loading Gantt…</div></div>;

  const selectedNode = selectedTask ? nodes.find(n=>n.id===selectedTask) : null;
  const selectedDoc = selectedTask ? docById[selectedTask] : undefined;
  const monthTitle = `${dates.start.toLocaleString('default',{month:'long'})} — ${dates.end.toLocaleString('default',{month:'long'})}`;
  const todayLeft = daysBetween(dates.start, new Date()) * pxPerDay;
  const pxPerDayText = pxPerDay.toFixed(1);
  const gridCols = '28px 220px 92px 110px 50px minmax(520px, 1fr)';
  return (
    <div className="gantt-screen og-dark">
      <header className="topbar">
        <button className="btn workspace" onClick={onBack}>
          <span className="ws-mark">o</span><span className="ws-org">OpenGantt</span><span className="sep">/</span><span className="ws-name">Gantts</span>
        </button>
        <div className="gantt-title"><span className="name">{gantt.name}</span><span className="sub">schema stamped · {gantt.template ? `created from ${gantt.template}` : 'source template deleted'}</span></div>
        <div className="top-actions">
          <button className="btn" onClick={()=>setNewTaskOpen({parent: null})}>+ New task</button>
          <button className="btn" onClick={exportHtml}>Export HTML</button>
          <button className="btn primary" onClick={share}>Share</button>
        </div>
      </header>

      <div className="subtoolbar">
        <button className="btn chip" onClick={()=>setSchemaOpen(schemaOpen==='template'?null:'template')}><span className="lbl">Template</span><span className="val">{gantt.template || 'Deleted'}</span><span className="caret">⌄</span></button>
        <button className="btn chip" onClick={()=>setSchemaOpen(schemaOpen==='grouping'?null:'grouping')}><span className="lbl">Group by</span><span className="val">{grouping.length ? grouping.join(' → ') : 'None'}</span><span className="caret">⌄</span></button>
        <button className="btn chip" onClick={()=>setSchemaOpen(schemaOpen==='columns'?null:'columns')}><span className="lbl">Columns</span><span className="val">{displayColumns.length}</span><span className="caret">⌄</span></button>
        <span className="subt-divider" />
        <button className="btn" onClick={reimport} disabled={!gantt.source_file}>Re-import</button>
        <label className="inline-control">Style
          <select value={selStyle} onChange={e=>changeStyle(e.target.value)}>
            <option value="">Default</option>{styles.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <div className="search"><span>⌕</span><input placeholder="Find task or owner…" value={filter} onChange={e=>setFilter(e.target.value)} /><span className="kbd">⌘K</span></div>
        <span className="subt-divider" />
        <div className="btn-group">
          {(['day','week','month','quarter'] as const).map(z => <button key={z} className={zoom===z?'on':''} onClick={()=>setZoom(z)}>{z[0].toUpperCase()+z.slice(1)}</button>)}
        </div>
        {schemaOpen && (
          <div className="schema-popover">
            {schemaOpen === 'template' && <SchemaFieldMap fieldMap={fieldMap} columns={allSchemaColumns} onChange={setFieldMapValue} />}
            {schemaOpen === 'grouping' && <SchemaGrouping grouping={grouping} columns={allSchemaColumns} fieldMap={fieldMap} onApply={setGroupingColumns} />}
            {schemaOpen === 'columns' && <SchemaColumns columns={allSchemaColumns} selected={displayColumns} onToggle={setDisplayColumn} />}
          </div>
        )}
      </div>

      <div className="editor-shell">
        <div className="canvas-col">
          <div className="scale">
            <div className="scale-left"><div className="range-name">{monthTitle}</div><div className="range">{dates.start.getUTCFullYear()} · {Math.ceil(totalDays/7)} weeks · {totalDays} days</div></div>
            <div className="scale-right" style={{width: timelineWidth}}><div className="time-row months">{renderMonthSpans(dates.start, totalDays, pxPerDay)}</div><div className="time-row days">{renderDayTicks(dates.start, totalDays, pxPerDay, zoom)}</div></div>
          </div>
          <div className="col-head" style={{gridTemplateColumns: gridCols}}>
            <div></div><div>Task</div><div>Status</div><div>Owner</div><div>Dur</div><div>Timeline <span className="pxday">PX/DAY · {pxPerDayText}</span></div>
          </div>
          <div className="rows-wrap">
            {hasDates && todayLeft >= 0 && todayLeft <= timelineWidth && <div className="today" style={{left: 28+220+92+110+50+todayLeft}} />}
            {visible.map((n) => {
              const doc = docById[n.id];
              const isGroup = n.taskType === 'group';
              const f = fieldsOf(doc);
              const statusValue = f.Status || f.Phase || f.status || (isGroup ? n.rollupStatus : n.status);
              const sc = statusClass(statusValue);
              const ds = n.rollupStartDate || n.startDate;
              const de = n.rollupEndDate || n.endDate || ds;
              const left = ds ? Math.max(0, daysBetween(dates.start, new Date(`${ds}T00:00:00Z`)) * pxPerDay) : 0;
              const bw = ds ? Math.max(4, (daysBetween(new Date(`${ds}T00:00:00Z`), new Date(`${de}T00:00:00Z`))+1) * pxPerDay) : 0;
              if (isGroup) {
                return <GroupBand key={n.id} node={n} allNodes={nodes} collapsed={collapsed.has(n.id)} onToggle={()=>toggleCollapse(n.id)} left={left} width={bw} gridCols={gridCols} />;
              }
              return (
                <div key={n.id} className={`og-row ${selectedTask===n.id?'selected':''}`} style={{gridTemplateColumns: gridCols}} onClick={()=>setSelectedTask(n.id)}>
                  <div className="gutter"><div className="depth-rule" /></div>
                  <div className="cell"><span className="taskname" style={{paddingLeft: Math.max(0, n.depth-1)*18}}>{n.name}</span></div>
                  <div className="cell"><span className={`pill ${sc}`}><span className={`st-ico ${sc==='golive'?'done':sc}`} />{statusLabel(statusValue)}</span></div>
                  <div className="cell">{ownerOf(doc) === '—' ? <span className="dim">—</span> : <span className="owner"><span className={`avatar b${(n.depth%6)+1}`}>{initials(ownerOf(doc))}</span><span className="nm">{ownerOf(doc)}</span></span>}</div>
                  <div className="cell dur">{durationDays(n)}<span className="tail">d</span></div>
                  <div className="cell timeline-cell"><div className="timeline" style={{width: timelineWidth}}>
                    {f.stated_start && f.stated_end && <div className="stated" style={{left: daysBetween(dates.start, new Date(`${f.stated_start}T00:00:00Z`))*pxPerDay, width: Math.max(4, daysBetween(new Date(`${f.stated_start}T00:00:00Z`), new Date(`${f.stated_end}T00:00:00Z`))*pxPerDay)}} />}
                    {ds && <div className={`bar ${sc}`} style={{left, width: bw}}><div className="progress" style={{width:`${progressOf(doc)}%`}} /><span className={`st-ico ${sc==='golive'?'done':sc}`} /><span className="label">{n.name}</span></div>}
                    {n.actualStartDate && n.actualEndDate && <div className="actual" style={{left: daysBetween(dates.start, new Date(`${n.actualStartDate}T00:00:00Z`))*pxPerDay, width: Math.max(3, daysBetween(new Date(`${n.actualStartDate}T00:00:00Z`), new Date(`${n.actualEndDate}T00:00:00Z`))*pxPerDay)}} />}
                  </div></div>
                </div>
              );
            })}
            {visible.length===0 && <div className="empty-state"><span>No tasks match the filter.</span></div>}
          </div>
        </div>
        <aside className="panel">
          {selectedNode ? <TaskPanel task={selectedNode} doc={selectedDoc} displayColumns={displayColumns} allTasks={tasks} onClose={()=>setSelectedTask(null)} onSaved={()=>{ if (name) reload(name); }} /> : <div className="panel-empty"><h2 className="panel-title">No task selected</h2><p>Pick a row to edit schedule, status, owner, and hierarchy. Bars are read-only.</p></div>}
        </aside>
      </div>
      <div className="statusbar"><div className="item"><span className="led"></span>Synced</div><div className="item">{gantt.name}</div><div className="item">{tasks.length} tasks · {tasks.filter(t=>t.kind==='group').length} groups</div><div className="grow"></div><div className="item">Today · <span>{new Date().toISOString().slice(0,10)}</span></div><div className="item">Px / day · {pxPerDayText}</div></div>
      {newTaskOpen && gantt && (
        <NewTaskPanel
          gantt={gantt.name}
          allTasks={tasks}
          defaultParent={newTaskOpen.parent}
          displayColumns={displayColumns}
          onClose={()=>setNewTaskOpen(null)}
          onCreated={()=>{ setNewTaskOpen(null); if (name) reload(name); }}
        />
      )}
      {showShare && (
        <div className="modal-overlay" onClick={()=>setShowShare(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h2>Public share URL</h2>
            <p style={{margin:0,color:'var(--text-muted)',fontSize:12}}>This is a frozen snapshot — future edits do not affect it. Re-share to publish a new version.</p>
            <input value={shareUrl} readOnly onFocus={e=>e.target.select()} style={{width:'100%'}} />
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-primary" onClick={()=>{ copyToClipboard(shareUrl).then(ok => { toast(ok ? 'Link copied to clipboard' : 'Couldn’t copy — select the URL above and copy manually', ok?'success':'error'); if (ok) setShowShare(false); }); }}>Copy</button>
              <button className="btn btn-ghost" onClick={()=>setShowShare(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaFieldMap({ fieldMap, columns, onChange }: { fieldMap: Record<string,string>; columns: string[]; onChange: (key:string, col:string)=>void }) {
  return (
    <div className="schema-panel">
      <strong>Stamped field map</strong>
      <p>Edits affect the next re-import only. Existing rows stay as-is until re-import replaces tasks.</p>
      {['name','start_date','end_date','actual_start','actual_end'].map(k => (
        <label key={k}>{k}
          <select value={fieldMap[k] || ''} onChange={e=>onChange(k, e.target.value)}>
            <option value="">none</option>{columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function SchemaGrouping({ grouping, columns, fieldMap, onApply }: { grouping: string[]; columns: string[]; fieldMap: Record<string,string>; onApply: (cols:string[])=>void }) {
  const [draft, setDraft] = useState(grouping);
  useEffect(() => setDraft(grouping), [grouping.join('|')]);
  const nameCol = fieldMap.name;
  const nameColIndex = nameCol ? draft.indexOf(nameCol) : -1;
  const taskLevelCandidate = nameColIndex >= 0 && draft.length > nameColIndex + 1 ? draft[draft.length - 1] : '';
  return (
    <div className="schema-panel">
      <strong>Group bands</strong>
      <p>Saving regenerates persisted group rows from current leaves and preserves leaf edits.</p>
      {taskLevelCandidate && (
        <div className="schema-warning">
          {taskLevelCandidate} looks like the dated task level. Saving will use it as the row label and keep grouping at {draft.slice(0, -1).join(' → ')}.
        </div>
      )}
      <div className="schema-chip-list">
        {draft.map((g,i)=><span key={`${g}-${i}`} className="chip">{g}<button onClick={()=>setDraft(draft.filter((_,idx)=>idx!==i))}>×</button></span>)}
        {!draft.length && <span className="dim">No grouping columns</span>}
      </div>
      <select value="" onChange={e=>{ if(e.target.value) setDraft([...draft, e.target.value]); }}>
        <option value="">add column</option>{columns.filter(c=>!draft.includes(c)).map(c=><option key={c}>{c}</option>)}
      </select>
      <button className="btn primary sm" onClick={()=>onApply(draft)}>Save grouping</button>
    </div>
  );
}

function SchemaColumns({ columns, selected, onToggle }: { columns: string[]; selected: string[]; onToggle: (col:string)=>void }) {
  return (
    <div className="schema-panel">
      <strong>Visible columns</strong>
      <p>Checked fields appear in the side panel and export snapshot metadata.</p>
      <div className="schema-checks">
        {columns.map(c => <label key={c}><input type="checkbox" checked={selected.includes(c)} onChange={()=>onToggle(c)} />{c}</label>)}
      </div>
    </div>
  );
}

function GroupBand({ node, allNodes, collapsed, onToggle, left, width, gridCols }: { node: TaskNode; allNodes: TaskNode[]; collapsed: boolean; onToggle: ()=>void; left: number; width: number; gridCols: string }) {
  const descendants = allNodes.filter(n => {
    let p = n.parentId;
    const byId = new Map(allNodes.map(x => [x.id, x]));
    while (p) {
      if (p === node.id) return true;
      p = byId.get(p)?.parentId || null;
    }
    return false;
  });
  const leaves = descendants.filter(n => n.taskType !== 'group');
  const counts = leaves.reduce<Record<string, number>>((acc, n) => {
    const cls = statusClass(n.rollupStatus || n.status);
    acc[cls] = (acc[cls] || 0) + 1;
    return acc;
  }, {});
  const total = Math.max(1, leaves.length);
  return (
    <div className={`band depth-${Math.min(node.depth, 2)}`} style={{gridTemplateColumns: gridCols}} onClick={onToggle}>
      <div className="gutter"><div className="depth-rule" /></div>
      <div className="band-label">
        <button className={`caret-btn ${collapsed?'closed':''}`} onClick={(e)=>{e.stopPropagation(); onToggle();}}>⌄</button>
        <span className="label-text">{node.name}</span>
        <span className="label-meta"><span>{leaves.length} tasks</span><span className="dot" /><span>{durationDays(node)}d</span></span>
      </div>
      <div className="band-canvas"><div className="dist" style={{left, width: Math.max(12, width)}}>
        {STATUS_ORDER.filter(s=>counts[s]).map(s => <span key={s} className={`seg-${statusClass(s)}`} style={{width:`${(counts[s]/total)*100}%`}} />)}
        {!leaves.length && <span className="seg-empty" />}
      </div></div>
    </div>
  );
}

function hasMatchingDescendant(n: TaskNode, idx: Map<string|null,TaskNode[]>, matches: (n:TaskNode)=>boolean): boolean {
  const children = idx.get(n.id) || [];
  for (const c of children) {
    if (matches(c)) return true;
    if (hasMatchingDescendant(c, idx, matches)) return true;
  }
  return false;
}

function renderMonthSpans(start: Date, totalDays: number, pxPerDay: number) {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < totalDays) {
    const d = addDays(start, i);
    const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1));
    const remaining = Math.min(totalDays - i, Math.ceil((monthEnd.getTime() - d.getTime())/86_400_000));
    const w = remaining * pxPerDay;
    out.push(<div key={i} className="month-cell" style={{width: w}}>{d.toLocaleString('default',{month:'short', year:'2-digit'})}</div>);
    i += remaining;
  }
  return out;
}
function renderDayTicks(start: Date, totalDays: number, pxPerDay: number, zoom: string) {
  // Skip per-day ticks at coarse zooms to keep DOM small
  if (zoom === 'quarter' || zoom === 'month') {
    const out: React.ReactNode[] = [];
    let i = 0;
    while (i < totalDays) {
      const d = addDays(start, i);
      const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1));
      const remaining = Math.min(totalDays - i, Math.ceil((monthEnd.getTime() - d.getTime())/86_400_000));
      out.push(<div key={i} className="day-cell" style={{width: remaining*pxPerDay}}></div>);
      i += remaining;
    }
    return out;
  }
  const out: React.ReactNode[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(start, i);
    out.push(<div key={i} className="day-cell" style={{width: pxPerDay}}>{zoom==='day'?d.getUTCDate():''}</div>);
  }
  return out;
}

function TaskPanel({ task, doc, displayColumns, allTasks, onClose, onSaved }: { task: TaskNode; doc: TaskDoc | undefined; displayColumns: string[]; allTasks: TaskDoc[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(task.name);
  const [kind, setKind] = useState<'group'|'leaf'>(doc?.kind || 'leaf');
  const [parent, setParent] = useState(doc?.parent_task || '');
  const [start, setStart] = useState((doc?.start_date||'').slice(0,10));
  const [end, setEnd] = useState((doc?.end_date||'').slice(0,10));
  const [fields, setFields] = useState<Record<string,any>>(() => fieldsOf(doc));
  useEffect(() => {
    setName(task.name);
    setKind(doc?.kind || 'leaf');
    setParent(doc?.parent_task || '');
    setStart((doc?.start_date||'').slice(0,10));
    setEnd((doc?.end_date||'').slice(0,10));
    setFields(fieldsOf(doc));
  }, [task.id, doc]);
  const save = async () => {
    if (!doc) return;
    try {
      await frappeApi.update('OG Task', {
        name: doc.name,
        task_name: name,
        kind,
        parent_task: parent || null,
        start_date: kind === 'group' ? null : (start || null),
        end_date: kind === 'group' ? null : (end || null),
        fields: JSON.stringify(fields),
      });
      toast(`Task "${name}" saved`);
    } catch (e:any) { toast(e?.message || 'Save failed', 'error'); return; }
    onSaved(); onClose();
  };
  const del = async () => {
    if (!doc) return;
    if (!confirm(`Delete task "${name}" and all its children?`)) return;
    try {
      // delete descendants first to avoid orphan-FK lookups
      const toDelete = collectDescendants(doc.name, allTasks);
      for (const id of toDelete) await frappeApi.delete('OG Task', id);
      await frappeApi.delete('OG Task', doc.name);
      toast(`Deleted "${name}"${toDelete.length?` + ${toDelete.length} children`:''}`);
    } catch (e:any) { toast(e?.message || 'Delete failed', 'error'); return; }
    onSaved(); onClose();
  };
  // Show every display_column even if absent from fields, so user can add values
  const fieldKeys = Array.from(new Set([...displayColumns, ...Object.keys(fields)]));
  const parentOptions = allTasks.filter(t => t.kind === 'group' && t.name !== doc?.name);
  return (
    <div className="inspector-panel">
      <div className="side-panel-head"><h3>Edit task</h3><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      <div className="form"><label>Name<input value={name} onChange={e=>setName(e.target.value)} /></label></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <div className="form"><label>Kind
          <select value={kind} onChange={e=>setKind(e.target.value as any)}>
            <option value="leaf">Leaf (has dates)</option>
            <option value="group">Group (rolls up children)</option>
          </select>
        </label></div>
        <div className="form"><label>Parent
          <select value={parent} onChange={e=>setParent(e.target.value)}>
            <option value="">— root —</option>
            {parentOptions.map(p => <option key={p.name} value={p.name}>{p.task_name}</option>)}
          </select>
        </label></div>
      </div>
      {kind === 'leaf' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div className="form"><label>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)} /></label></div>
          <div className="form"><label>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label></div>
        </div>
      )}
      {fieldKeys.map(k => (
        <div key={k} className="form"><label>{k}<input value={fields[k] ?? ''} onChange={e=>setFields({...fields,[k]:e.target.value})} /></label></div>
      ))}
      {!doc && <div style={{color:'var(--text-muted)',fontSize:12}}>Generated group — not persisted. Edit underlying leaves to change.</div>}
      <div style={{marginTop:'auto',display:'flex',gap:8,justifyContent:'space-between'}}>
        <button className="btn btn-danger" onClick={del} disabled={!doc}>Delete</button>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!doc}>Save</button>
        </div>
      </div>
    </div>
  );
}

function collectDescendants(rootId: string, all: TaskDoc[]): string[] {
  const byParent = new Map<string, TaskDoc[]>();
  for (const t of all) {
    if (!t.parent_task) continue;
    const arr = byParent.get(t.parent_task) || [];
    arr.push(t);
    byParent.set(t.parent_task, arr);
  }
  const out: string[] = [];
  function walk(id: string) {
    for (const c of (byParent.get(id) || [])) { out.push(c.name); walk(c.name); }
  }
  walk(rootId);
  return out;
}

function NewTaskPanel({ gantt, allTasks, defaultParent, displayColumns, onClose, onCreated }: { gantt: string; allTasks: TaskDoc[]; defaultParent: string | null; displayColumns: string[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'group'|'leaf'>('leaf');
  const [parent, setParent] = useState(defaultParent || '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [fields, setFields] = useState<Record<string,any>>({});
  const parentOptions = allTasks.filter(t => t.kind === 'group');
  const sortBase = allTasks.length ? Math.max(...allTasks.map(t => t.sort_order || 0)) + 1 : 0;
  const create = async () => {
    if (!name.trim()) { toast('Task name is required', 'error'); return; }
    try {
      await frappeApi.create('OG Task', {
        gantt,
        task_name: name,
        kind,
        parent_task: parent || null,
        start_date: kind === 'group' ? null : (start || null),
        end_date: kind === 'group' ? null : (end || null),
        sort_order: sortBase,
        fields: JSON.stringify(fields),
      });
      toast(`Task "${name}" created`);
    } catch (e:any) { toast(e?.message || 'Failed to create task', 'error'); return; }
    onCreated();
  };
  return (
    <div className="side-panel">
      <div className="side-panel-head"><h3>New task</h3><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      <div className="form"><label>Name<input value={name} onChange={e=>setName(e.target.value)} autoFocus placeholder="e.g. Kickoff meeting" /></label></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <div className="form"><label>Kind
          <select value={kind} onChange={e=>setKind(e.target.value as any)}>
            <option value="leaf">Leaf (has dates)</option>
            <option value="group">Group (rolls up children)</option>
          </select>
        </label></div>
        <div className="form"><label>Parent
          <select value={parent} onChange={e=>setParent(e.target.value)}>
            <option value="">— root —</option>
            {parentOptions.map(p => <option key={p.name} value={p.name}>{p.task_name}</option>)}
          </select>
        </label></div>
      </div>
      {kind === 'leaf' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div className="form"><label>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)} /></label></div>
          <div className="form"><label>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label></div>
        </div>
      )}
      {displayColumns.map(k => (
        <div key={k} className="form"><label>{k}<input value={fields[k] ?? ''} onChange={e=>setFields({...fields,[k]:e.target.value})} /></label></div>
      ))}
      <div style={{marginTop:'auto',display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}>Create task</button>
      </div>
    </div>
  );
}

function SettingsScreen({ user }: { user: string }) {
  const [theme, setTheme] = useState<'light'|'dark'>(() => (localStorage.getItem('og-theme') as any) || 'light');
  const [counts, setCounts] = useState<{templates:number; gantts:number; styles:number; tasks:number} | null>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('og-theme', theme); }, [theme]);
  useEffect(() => {
    Promise.all([
      frappeApi.list('OG Template'), frappeApi.list('OG Gantt'),
      frappeApi.list('OG Style'),    frappeApi.list('OG Task'),
    ]).then(([t,g,s,k]: any[]) => setCounts({ templates:(t||[]).length, gantts:(g||[]).length, styles:(s||[]).length, tasks:(k||[]).length })).catch(()=>{});
  }, []);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Preferences and account info.</p></div></div>

      <div className="card" style={{display:'grid',gap:14}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div className="avatar lg">{(user||'?').slice(0,1).toUpperCase()}</div>
          <div style={{display:'flex',flexDirection:'column'}}>
            <strong style={{fontSize:15}}>{user}</strong>
            <span style={{color:'var(--text-muted)',fontSize:12}}>Signed in</span>
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:8}}>
            <button className="btn btn-ghost" onClick={()=>{window.location.href='/app';}}>Frappe Desk</button>
            <button className="btn btn-danger" onClick={()=>{window.location.href='/api/method/logout';}}>Sign out</button>
          </div>
        </div>
      </div>

      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Appearance</h3>
        <p style={{margin:0,color:'var(--text-muted)',fontSize:12}}>Affects the entire app. Individual Gantts can still override via their style.</p>
        <div style={{display:'flex',gap:8}}>
          <button className={`theme-tile ${theme==='light'?'active':''}`} onClick={()=>setTheme('light')}>
            <span className="swatch light"></span><span>Light</span>
          </button>
          <button className={`theme-tile ${theme==='dark'?'active':''}`} onClick={()=>setTheme('dark')}>
            <span className="swatch dark"></span><span>Dark</span>
          </button>
        </div>
      </div>

      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Your workspace</h3>
        {counts ? (
          <div className="stats-grid">
            <div><strong>{counts.templates}</strong><span>Templates</span></div>
            <div><strong>{counts.gantts}</strong><span>Gantts</span></div>
            <div><strong>{counts.styles}</strong><span>Styles</span></div>
            <div><strong>{counts.tasks}</strong><span>Tasks</span></div>
          </div>
        ) : <span style={{color:'var(--text-muted)',fontSize:12}}>Loading…</span>}
      </div>

      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>About</h3>
        <div className="kv">
          <span>App</span><span>OpenGantt</span>
          <span>Version</span><span>0.1.0</span>
          <span>Source</span><a href="https://github.com/askysh/opengantt" target="_blank" rel="noreferrer">github.com/askysh/opengantt</a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Share / Export mode ---------- */
function SharePage({ snapshot }: { snapshot: any }) {
  const tasks: TaskDoc[] = snapshot.tasks || [];
  const template: TemplateDoc | undefined = snapshot.template;
  const styleCfg: StyleConfig = snapshot.style || {};
  const displayColumns: string[] = snapshot.displayColumns || safeJson<string[]>(template?.display_columns, []);
  const nodes = useMemo(()=>rollupTaskTree(toNodes(tasks)),[tasks]);
  const docById = useMemo(()=>Object.fromEntries(tasks.map(t=>[t.name,t])) as Record<string,TaskDoc>,[tasks]);
  const ordered = useMemo(() => {
    const childrenOf = new Map<string|null, TaskNode[]>();
    for (const n of nodes) {
      const a = childrenOf.get(n.parentId) || [];
      a.push(n);
      childrenOf.set(n.parentId, a);
    }
    const out: Array<TaskNode & {depth:number}> = [];
    function walk(pid: string|null, depth: number) {
      for (const c of childrenOf.get(pid) || []) { out.push({...c, depth}); walk(c.id, depth+1); }
    }
    walk(null, 0);
    return out;
  }, [nodes]);
  const dated = ordered.filter(n => n.rollupStartDate || n.startDate);
  const hasDates = dated.length > 0;
  const dates = useMemo(() => {
    if (!hasDates) { const t=new Date(); return {start:addDays(t,-15), end:addDays(t,45)}; }
    const starts = dated.map(n=>n.rollupStartDate||n.startDate).filter(Boolean) as string[];
    const ends = dated.map(n=>n.rollupEndDate||n.endDate||n.startDate).filter(Boolean) as string[];
    const s = new Date(`${starts.reduce((a,b)=>a<b?a:b)}T00:00:00Z`);
    const e = new Date(`${ends.reduce((a,b)=>a>b?a:b)}T00:00:00Z`);
    return {start: addDays(s,-7), end: addDays(e,7)};
  }, [dated, hasDates]);
  const pxPerDay = 4;
  const totalDays = Math.max(1, daysBetween(dates.start, dates.end));
  const w = totalDays * pxPerDay;
  return (
    <div className="gantt-screen share" data-theme={styleCfg.canvas==='dark'?'dark':'light'} style={{fontFamily: styleCfg.font?`${styleCfg.font}, ui-sans-serif`:undefined}}>
      <div className="gantt-toolbar"><strong>{styleCfg.header || 'Shared Gantt'}</strong><span style={{marginLeft:'auto',color:'var(--text-muted)',fontSize:12}}>Read-only snapshot</span></div>
      <div className="gantt-body">
        <div className="gantt-sidebar">
          <div className="gantt-sidebar-head" style={{gridTemplateColumns:`minmax(180px,1fr) ${displayColumns.map(()=>'minmax(80px,140px)').join(' ')}`}}>
            <span>Task</span>{displayColumns.map(c=><span key={c}>{c}</span>)}
          </div>
          <div className="gantt-sidebar-body">
            {ordered.map(n => {
              const f = fieldsOf(docById[n.id]);
              return (
                <div key={n.id} className={`task-row ${n.taskType==='group'?'is-group':''}`} style={{gridTemplateColumns:`minmax(180px,1fr) ${displayColumns.map(()=>'minmax(80px,140px)').join(' ')}`, paddingLeft:`${8+n.depth*16}px`}}>
                  <span className="task-name">{n.name}</span>
                  {displayColumns.map(c=><span key={c} className="cell">{f[c]!=null&&f[c]!==''?String(f[c]):<span className="dim">—</span>}</span>)}
                </div>
              );
            })}
          </div>
        </div>
        <div className="gantt-canvas">
          {hasDates && <div className="gantt-time-header" style={{width:w}}><div className="time-row months">{renderMonthSpans(dates.start, totalDays, pxPerDay)}</div></div>}
          <div className="gantt-rows" style={{width:w}}>
            {ordered.map(n => {
              const ds = n.rollupStartDate || n.startDate;
              const de = n.rollupEndDate || n.endDate || ds;
              if (!ds) return <div key={n.id} className="task-row canvas" />;
              const s = new Date(`${ds}T00:00:00Z`);
              const e = new Date(`${de}T00:00:00Z`);
              const left = daysBetween(dates.start, s) * pxPerDay;
              const bw = Math.max(3, (daysBetween(s,e)+1)*pxPerDay);
              const isGroup = n.taskType==='group';
              let bg = isGroup ? (styleCfg.colors?.group || '#0f172a') : (styleCfg.colors?.leaf || '#2563eb');
              if (!isGroup && styleCfg.status_field && styleCfg.colors_by_status) {
                const sv = fieldsOf(docById[n.id])[styleCfg.status_field];
                const c = sv != null ? styleCfg.colors_by_status[String(sv)] : undefined;
                if (c) bg = c;
              }
              return (
                <div key={n.id} className="task-row canvas">
                  <div className="bar" style={{left, width: bw, background: bg, opacity: isGroup?0.6:1}}>
                    <strong>{n.name}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {styleCfg.footer && <div className="footer-text">{styleCfg.footer}</div>}
    </div>
  );
}
