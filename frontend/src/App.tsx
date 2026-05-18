import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rollupTaskTree, TaskNode } from './packages/core';
import { parseSheet, TemplateConfig, ParsedTask } from './packages/parser';
import { frappeApi } from './lib/api';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

type Screen = 'templates' | 'templateEditor' | 'gantts' | 'ganttEditor' | 'settings';
type TemplateDoc = { name: string; description?: string; field_map?: string; grouping?: string; display_columns?: string; owner?: string };
type GanttDoc = { name: string; template: string; active_style?: string; source_file?: string; parsed_at?: string; owner?: string };
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

function safeJson<T>(s: string | undefined, fallback: T): T { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }
function toNodes(tasks: TaskDoc[]): TaskNode[] {
  return tasks.map((t) => ({
    id: t.name, parentId: t.parent_task || null, path: [t.name], depth: 0, wbsCode: '',
    name: t.task_name, owner: '', status: 'planned', priority: 'medium', taskType: t.kind,
    startDate: t.start_date || '', endDate: t.end_date || '',
    actualStartDate: t.actual_start, actualEndDate: t.actual_end,
    progress: 0, color: '#2563eb', resourceLoad: 0,
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
      <div className="topbar">
        <div className="brand">OpenGantt</div>
        <div className="nav">
          <button className={screen==='templates'||screen==='templateEditor'?'active':''} onClick={()=>setScreen('templates')}>Templates</button>
          <button className={screen==='gantts'||screen==='ganttEditor'?'active':''} onClick={()=>setScreen('gantts')}>Gantts</button>
          <button className={screen==='settings'?'active':''} onClick={()=>setScreen('settings')}>Settings</button>
        </div>
      </div>
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
  const refresh = () => { setLoading(true); frappeApi.list('OG Template').then((r: any) => { setItems(r || []); setLoading(false); }); };
  useEffect(() => { refresh(); }, []);
  const create = async () => {
    if (!newName.trim()) return;
    try { await frappeApi.create('OG Template', { name: newName }); toast(`Template "${newName}" created`); }
    catch (e: any) { toast(e?.message || 'Failed to create template', 'error'); return; }
    setNewName(''); setShowNew(false); refresh();
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>My Templates</h1><p>Describe the shape of your input files so they parse into Gantts.</p></div><button className="btn btn-primary" onClick={()=>setShowNew(true)}>New Template</button></div>
      {showNew && (
        <div className="card" style={{ display:'flex', gap:8 }}>
          <input placeholder="Template name" value={newName} onChange={e=>setNewName(e.target.value)} autoFocus />
          <button className="btn btn-primary" onClick={create}>Save</button>
          <button className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button>
        </div>
      )}
      {loading ? <div className="empty-state"><span>Loading templates…</span></div> :
        <div className="list">
          {items.map(t => (
            <div key={t.name} className="row">
              <div><strong>{t.name}</strong><span>{t.description || 'No description'}</span></div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost" onClick={()=>onEdit(t.name)}>Edit</button>
                <button className="btn btn-danger" onClick={async ()=>{
                  if(!confirm(`Delete template "${t.name}"?`)) return;
                  try { await frappeApi.delete('OG Template', t.name); toast(`Template "${t.name}" deleted`); refresh(); }
                  catch(e:any){ toast(e?.message || 'Delete failed', 'error'); }
                }}>Delete</button>
              </div>
            </div>
          ))}
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
        <div><h1>{doc.name}</h1><p>{doc.description || 'Template'}</p></div>
        <div style={{display:'flex',gap:8}}><button className="btn btn-ghost" onClick={onBack}>Cancel</button><button className="btn btn-primary" onClick={save}>Save changes</button></div>
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
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); frappeApi.list('OG Gantt').then((r: any) => { setItems(r||[]); setLoading(false); }); };
  useEffect(() => { refresh(); frappeApi.list('OG Template').then((r: any)=>setTemplates(r||[])); }, []);
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
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
      const g = await frappeApi.create('OG Gantt', { name: newName, template: selTemplate, parsed_at: new Date().toISOString() });
      const r: any = await frappeApi.parseUpload({ gantt: g.name, tasks: preview });
      toast(`Gantt "${newName}" created (${r?.message?.count ?? preview.length} tasks)`);
    } catch (e: any) { toast(e?.message || 'Failed to create Gantt', 'error'); return; }
    setShowNew(false); setPreview(null); setNewName(''); setSelTemplate(''); refresh();
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>My Gantts</h1><p>Upload spreadsheets against templates to generate Gantts.</p></div><button className="btn btn-primary" onClick={()=>setShowNew(true)} disabled={templates.length===0}>New Gantt</button></div>
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
            <button className="btn btn-ghost" onClick={()=>{setShowNew(false);setPreview(null);}}>Cancel</button>
            <button className="btn btn-primary" onClick={saveGantt} disabled={!preview||!newName.trim()}>Save Gantt</button>
          </div>
        </div>
      )}
      {loading ? <div className="empty-state"><span>Loading Gantts…</span></div> :
        <div className="list">
          {items.map(g => (
            <div key={g.name} className="row">
              <div><strong>{g.name}</strong><span>{g.template}{g.parsed_at?` · parsed ${new Date(g.parsed_at).toLocaleDateString()}`:''}</span></div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" onClick={()=>onOpen(g.name)}>Open</button>
                <button className="btn btn-danger" onClick={async ()=>{
                  if(!confirm(`Delete Gantt "${g.name}" and all its tasks?`)) return;
                  try { await frappeApi.delete('OG Gantt', g.name); toast(`Gantt "${g.name}" deleted`); refresh(); }
                  catch(e:any){ toast(e?.message || 'Delete failed', 'error'); }
                }}>Delete</button>
              </div>
            </div>
          ))}
          {items.length===0 && !loading && <div className="empty-state"><strong>No Gantts yet</strong><span>Upload a file against a template to create one.</span></div>}
        </div>
      }
    </div>
  );
}

function useTaskTree(tasks: TaskDoc[], groupBy: string | null) {
  // If groupBy is set, ignore stored parent_task and re-group leaves by fields[groupBy]
  return useMemo(() => {
    if (!groupBy || groupBy === '__stored__') {
      return rollupTaskTree(toNodes(tasks));
    }
    if (groupBy === '__flat__') {
      const flat = tasks.filter(t=>t.kind==='leaf').map(t => ({ ...t, parent_task: undefined }));
      return rollupTaskTree(toNodes(flat));
    }
    // Re-group by field value
    const leaves = tasks.filter(t=>t.kind==='leaf');
    const groupMap = new Map<string, TaskDoc>();
    const out: TaskDoc[] = [];
    for (const t of leaves) {
      const value = String(fieldsOf(t)[groupBy] ?? '—');
      const key = `__grp__${groupBy}__${value}`;
      if (!groupMap.has(key)) {
        const g: TaskDoc = {
          name: key, gantt: t.gantt, task_name: value, kind: 'group',
          sort_order: 0, parent_task: undefined,
        };
        groupMap.set(key, g);
        out.push(g);
      }
      out.push({ ...t, parent_task: key });
    }
    return rollupTaskTree(toNodes(out));
  }, [tasks, groupBy]);
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
  const [groupBy, setGroupBy] = useState<string>('__stored__');
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
    frappeApi.read('OG Template', gantt.template).then((r:any)=>setTemplate(r));
    frappeApi.list('OG Style').then((r:any)=>setStyles((r||[]).filter((s:StyleDoc)=>s.template===gantt.template)));
  }, [gantt]);

  const styleCfg = useMemo<StyleConfig>(() => {
    const s = styles.find(x=>x.name===selStyle);
    return s ? safeJson(s.config, {}) : {};
  }, [styles, selStyle]);
  const displayColumns: string[] = useMemo(() => safeJson<string[]>(template?.display_columns, []), [template]);
  const grouping: string[] = useMemo(() => safeJson<string[]>(template?.grouping, []), [template]);

  const nodes = useTaskTree(tasks, groupBy);
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

  // Synchronized vertical scroll
  const sidebarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const syncFrom = (src: 'sidebar'|'canvas') => () => {
    if (syncing.current) return;
    const a = sidebarRef.current, b = canvasRef.current;
    if (!a || !b) return;
    syncing.current = true;
    if (src==='sidebar') b.scrollTop = a.scrollTop; else a.scrollTop = b.scrollTop;
    requestAnimationFrame(() => { syncing.current = false; });
  };

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsed(next);
  };

  const share = async () => {
    if (!gantt) return;
    const snapshot = { tasks, template, style: styleCfg, displayColumns };
    try {
      const r: any = await frappeApi.publishShare({ gantt: gantt.name, snapshot });
      const url = r?.message?.url || r?.url;
      setShareUrl(window.location.origin + url);
      setShowShare(true);
      toast('Share link created');
    } catch (e:any) { toast(e?.message || 'Share failed', 'error'); }
  };
  const exportHtml = () => {
    if (!gantt) return;
    const css = Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules).map(r=>r.cssText); } catch { return []; } }).join('\n');
    const payload = { tasks, template, style: styleCfg, displayColumns };
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${gantt.name}</title><style>${css}</style></head><body><div id="root"></div><script>window.__OG_SHARE_SNAPSHOT__=${JSON.stringify(payload)};</script><script src="/assets/opengantt/opengantt/main.js"></script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${gantt.name}.html`; a.click();
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

  if (loading || !gantt) return <div className="page"><div className="empty-state">Loading Gantt…</div></div>;

  const themeAttr = styleCfg.canvas==='dark' ? 'dark' : 'light';
  return (
    <div className="gantt-screen" data-theme={themeAttr} style={{ fontFamily: styleCfg.font ? `${styleCfg.font}, ui-sans-serif, system-ui` : undefined }}>
      <div className="gantt-toolbar">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <strong style={{fontSize:14}}>{gantt.name}</strong>
        {styleCfg.header && <span className="header-text">{styleCfg.header}</span>}
        <input className="searchbox" placeholder="Filter…" value={filter} onChange={e=>setFilter(e.target.value)} />
        <label className="inline-control">Group by
          <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
            <option value="__stored__">As imported</option>
            <option value="__flat__">Flat</option>
            {grouping.map(g => <option key={g} value={g}>{g}</option>)}
            {displayColumns.filter(c=>!grouping.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="inline-control">Zoom
          <select value={zoom} onChange={e=>setZoom(e.target.value as any)}>
            <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option>
          </select>
        </label>
        <label className="inline-control">Style
          <select value={selStyle} onChange={e=>changeStyle(e.target.value)}>
            <option value="">Default</option>
            {styles.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={()=>setNewTaskOpen({parent: null})}>+ New Task</button>
        <button className="btn btn-ghost" onClick={share}>Share</button>
        <button className="btn btn-ghost" onClick={exportHtml}>Export HTML</button>
        <button className="btn btn-ghost" onClick={reimport}>Re-import</button>
      </div>
      <div className="gantt-body">
        <div className="gantt-sidebar">
          <div className="gantt-sidebar-head" style={{gridTemplateColumns: `28px minmax(180px,1fr) ${displayColumns.map(()=>'minmax(80px,140px)').join(' ')}`}}>
            <span></span><span>Task</span>
            {displayColumns.map(c => <span key={c}>{c}</span>)}
          </div>
          <div className="gantt-sidebar-body" ref={sidebarRef} onScroll={syncFrom('sidebar')}>
            {visible.map(n => {
              const doc = docById[n.id];
              const isGroup = n.taskType === 'group';
              const fields = fieldsOf(doc);
              const isCollapsed = collapsed.has(n.id);
              const statusField = styleCfg.status_field;
              return (
                <div key={n.id}
                     className={`task-row ${selectedTask===n.id?'selected':''} ${isGroup?'is-group':''}`}
                     style={{gridTemplateColumns:`28px minmax(180px,1fr) ${displayColumns.map(()=>'minmax(80px,140px)').join(' ')}`, paddingLeft: `${8 + n.depth*16}px`}}
                     onClick={()=>setSelectedTask(n.id)}>
                  <span className="caret" onClick={e=>{e.stopPropagation(); if (isGroup) toggleCollapse(n.id);}}>
                    {isGroup ? (isCollapsed ? '▸' : '▾') : ''}
                  </span>
                  <span className="task-name">{n.name}</span>
                  {displayColumns.map(c => {
                    const v = fields[c];
                    const isStatus = statusField && c === statusField && styleCfg.colors_by_status?.[String(v)];
                    return (
                      <span key={c} className="cell">
                        {v != null && v !== '' ? (
                          isStatus ? <span className="pill" style={{background: styleCfg.colors_by_status![String(v)]}}>{String(v)}</span> : String(v)
                        ) : <span className="dim">—</span>}
                      </span>
                    );
                  })}
                </div>
              );
            })}
            {visible.length===0 && <div className="empty-state"><span>No tasks match the filter.</span></div>}
          </div>
        </div>
        <div className="gantt-canvas" ref={canvasRef} onScroll={syncFrom('canvas')}>
          {!hasDates ? (
            <div className="empty-state" style={{margin:24}}>
              <strong>No timeline yet</strong>
              <span>None of the visible tasks have Start / End dates. Click a row to set dates in the side panel, or re-import a file that includes dates.</span>
            </div>
          ) : (
            <>
              <div className="gantt-time-header" style={{width: timelineWidth}}>
                <div className="time-row months">{renderMonthSpans(dates.start, totalDays, pxPerDay)}</div>
                <div className="time-row days">{renderDayTicks(dates.start, totalDays, pxPerDay, zoom)}</div>
              </div>
              <div className="gantt-rows" style={{width: timelineWidth}}>
                {visible.map(n => {
                  const ds = n.rollupStartDate || n.startDate;
                  const de = n.rollupEndDate || n.endDate || ds;
                  if (!ds) return <div key={n.id} className={`task-row canvas ${selectedTask===n.id?'selected':''}`} />;
                  const s = new Date(`${ds}T00:00:00Z`);
                  const e = new Date(`${de}T00:00:00Z`);
                  const left = daysBetween(dates.start, s) * pxPerDay;
                  const width = Math.max(3, (daysBetween(s, e)+1) * pxPerDay);
                  const isGroup = n.taskType === 'group';
                  let bg = isGroup ? (styleCfg.colors?.group || '#0f172a') : (styleCfg.colors?.leaf || '#2563eb');
                  if (!isGroup && styleCfg.status_field && styleCfg.colors_by_status) {
                    const sv = fieldsOf(docById[n.id])[styleCfg.status_field];
                    const c = sv != null ? styleCfg.colors_by_status[String(sv)] : undefined;
                    if (c) bg = c;
                  }
                  return (
                    <div key={n.id} className={`task-row canvas ${selectedTask===n.id?'selected':''}`} onClick={()=>setSelectedTask(n.id)}>
                      <div className="bar" style={{ left, width, background: bg, opacity: isGroup?0.6:1 }}>
                        <strong>{n.name}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {styleCfg.footer && <div className="footer-text">{styleCfg.footer}</div>}
      {selectedTask && (
        <TaskPanel
          task={nodes.find(n=>n.id===selectedTask)!}
          doc={docById[selectedTask]}
          displayColumns={displayColumns}
          allTasks={tasks}
          onClose={()=>setSelectedTask(null)}
          onSaved={()=>{ if (name) reload(name); }}
        />
      )}
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
    <div className="side-panel">
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
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="card"><strong>Signed in as</strong><span>{user}</span></div>
      <div className="card"><button className="btn btn-ghost" onClick={()=>{window.location.href='/app';}}>Go to Frappe Desk</button></div>
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
