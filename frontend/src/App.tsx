import React, { useEffect, useMemo, useState } from 'react';
import { rollupTaskTree, TaskNode } from './packages/core';
import { parseSheet, TemplateConfig, ParsedTask } from './packages/parser';
import { frappeApi } from './lib/api';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

type Screen = 'templates' | 'templateEditor' | 'gantts' | 'ganttEditor' | 'settings';
type TemplateDoc = { name: string; template_name?: string; description?: string; field_map?: string; grouping?: string; display_columns?: string; owner: string };
type GanttDoc = { name: string; template: string; active_style?: string; source_file?: string; parsed_at?: string; owner: string };
type TaskDoc = { name: string; gantt: string; parent_task?: string; task_name: string; kind: 'group' | 'leaf'; start_date?: string; end_date?: string; actual_start?: string; actual_end?: string; sort_order: number; fields?: string };
type StyleDoc = { name: string; template: string; config?: string };

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

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('templates');
  const [editTemplate, setEditTemplate] = useState<string | null>(null);
  const [openGantt, setOpenGantt] = useState<string | null>(null);
  useEffect(() => { frappeApi.getUser().then((r: any) => setUser(r.message)); }, []);
  if (!user) return <div className="empty-state" style={{ height: '100vh' }}><strong>OpenGantt</strong><span>Loading...</span></div>;

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">OpenGantt</div>
        <div className="nav">
          <button className={screen==='templates'?'active':''} onClick={()=>setScreen('templates')}>Templates</button>
          <button className={screen==='gantts'?'active':''} onClick={()=>setScreen('gantts')}>Gantts</button>
          <button className={screen==='settings'?'active':''} onClick={()=>setScreen('settings')}>Settings</button>
        </div>
      </div>
      <div className="page" style={{ padding: 0 }}>
        {screen==='templates' && <TemplatesScreen onEdit={(n)=>{setEditTemplate(n);setScreen('templateEditor');}} />}
        {screen==='templateEditor' && <TemplateEditorScreen name={editTemplate} onBack={()=>setScreen('templates')} />}
        {screen==='gantts' && <GanttsScreen onOpen={(n)=>{setOpenGantt(n);setScreen('ganttEditor');}} />}
        {screen==='ganttEditor' && <GanttEditorScreen name={openGantt} onBack={()=>setScreen('gantts')} />}
        {screen==='settings' && <SettingsScreen user={user} />}
      </div>
    </div>
  );
}

function TemplatesScreen({ onEdit }: { onEdit: (n: string) => void }) {
  const [items, setItems] = useState<TemplateDoc[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const refresh = () => frappeApi.list('OG Template').then((r: any) => setItems(r || []));
  useEffect(() => { refresh(); }, []);
  const create = async () => { if (!newName.trim()) return; await frappeApi.create('OG Template', { name: newName }); setNewName(''); setShowNew(false); refresh(); };
  return (
    <div className="page">
      <div className="page-head"><h1>My Templates</h1><button className="btn btn-primary" onClick={()=>setShowNew(true)}>New Template</button></div>
      {showNew && (
        <div className="card" style={{ display:'flex', gap:8 }}>
          <input placeholder="Template name" value={newName} onChange={e=>setNewName(e.target.value)} />
          <button className="btn btn-primary" onClick={create}>Save</button>
          <button className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button>
        </div>
      )}
      <div className="list">
        {items.map(t => (
          <div key={t.name} className="row">
            <div><strong>{t.name}</strong><span>{t.description || 'No description'}</span></div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>onEdit(t.name)}>Edit</button>
              <button className="btn btn-danger" onClick={async ()=>{await frappeApi.delete('OG Template', t.name); refresh();}}>Delete</button>
            </div>
          </div>
        ))}
        {items.length===0 && <div className="empty-state"><strong>No templates yet</strong><span>Create a template to describe your file shape.</span></div>}
      </div>
    </div>
  );
}

function TemplateEditorScreen({ name, onBack }: { name: string | null; onBack: () => void }) {
  const [doc, setDoc] = useState<TemplateDoc | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string,string>>({});
  const [grouping, setGrouping] = useState<string[]>([]);
  const [displayColumns, setDisplayColumns] = useState<string[]>([]);
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [showStyle, setShowStyle] = useState(false);
  const [styleName, setStyleName] = useState('');
  const [styleConfig, setStyleConfig] = useState('');
  const [sampleCols, setSampleCols] = useState<string[]>([]);
  useEffect(() => { if (!name) return; frappeApi.read('OG Template', name).then((r: any)=>{ setDoc(r); setFieldMap(safeJson(r.field_map,{})); setGrouping(safeJson(r.grouping,[])); setDisplayColumns(safeJson(r.display_columns,[])); }); frappeApi.list('OG Style').then((r: any)=>setStyles((r||[]).filter((s:StyleDoc)=>s.template===name))); }, [name]);
  const save = async () => { if (!doc) return; await frappeApi.update('OG Template', { name: doc.name, field_map: JSON.stringify(fieldMap), grouping: JSON.stringify(grouping), display_columns: JSON.stringify(displayColumns) }); onBack(); };
  const createStyle = async () => { if (!doc || !styleName.trim()) return; await frappeApi.create('OG Style', { name: styleName, template: doc.name, config: styleConfig || '{}' }); setShowStyle(false); setStyleName(''); setStyleConfig(''); const r = await frappeApi.list('OG Style'); setStyles((r||[]).filter((s:StyleDoc)=>s.template===doc.name)); };
  const onSample = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      try {
        const wb = XLSX.read(data, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        if (json.length) setSampleCols(json[0].map(String));
      } catch {
        Papa.parse(String(data), { header: true, complete: (res) => { if (res.meta.fields) setSampleCols(res.meta.fields); } });
      }
    };
    reader.readAsBinaryString(file);
  };
  if (!doc) return <div className="page">Loading...</div>;
  return (
    <div className="page">
      <div className="page-head"><h1>{doc.name}</h1><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={save}>Save</button></div></div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Field Map</h3>
        {['name','start_date','end_date','actual_start','actual_end'].map(k => (
          <div key={k} className="form"><label>{k}
            <select value={fieldMap[k]||''} onChange={e=>setFieldMap({...fieldMap,[k]:e.target.value})}>
              <option value="">--</option>
              {sampleCols.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </label></div>
        ))}
        <div className="form"><label>Upload sample file to see columns<input type="file" accept=".xlsx,.csv,.xls" onChange={onSample} /></label></div>
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Grouping</h3>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {grouping.map((g,i)=> (
            <span key={i} style={{background:'var(--surface-sunk)',padding:'4px 8px',borderRadius:6,fontSize:12}}>{g} <button onClick={()=>setGrouping(grouping.filter((_,idx)=>idx!==i))}>x</button></span>
          ))}
        </div>
        <div className="form"><label>Add grouping column
          <select value="" onChange={e=>{if(e.target.value){setGrouping([...grouping,e.target.value]);e.target.value='';}}}>
            <option value="">--</option>
            {sampleCols.filter(c=>!grouping.includes(c)).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </label></div>
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <h3 style={{margin:0}}>Display Columns</h3>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {sampleCols.map(c => (
            <label key={c} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12}}>
              <input type="checkbox" checked={displayColumns.includes(c)} onChange={()=>setDisplayColumns(displayColumns.includes(c)?displayColumns.filter(x=>x!==c):[...displayColumns,c])} /> {c}
            </label>
          ))}
        </div>
      </div>
      <div className="card" style={{display:'grid',gap:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3 style={{margin:0}}>Styles</h3><button className="btn btn-primary" onClick={()=>setShowStyle(true)}>New Style</button></div>
        <div className="list">
          {styles.map(s => <div key={s.name} className="row"><strong>{s.name}</strong><span>{s.config || '{}'}</span></div>)}
          {styles.length===0 && <span style={{color:'var(--text-muted)',fontSize:12}}>No styles yet.</span>}
        </div>
      </div>
      {showStyle && (
        <div className="modal-overlay" onClick={()=>setShowStyle(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h2>New Style</h2>
            <input placeholder="Style name" value={styleName} onChange={e=>setStyleName(e.target.value)} />
            <textarea rows={4} placeholder='Config JSON' value={styleConfig} onChange={e=>setStyleConfig(e.target.value)} />
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={()=>setShowStyle(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createStyle}>Save</button>
            </div>
          </div>
        </div>
      )}
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
  const refresh = () => frappeApi.list('OG Gantt').then((r: any) => setItems(r || []));
  useEffect(() => { refresh(); frappeApi.list('OG Template').then((r: any)=>setTemplates(r||[])); }, []);
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      let rows: Record<string,any>[] = [];
      try {
        const wb = XLSX.read(data, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string,any>>(ws);
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
    const g = await frappeApi.create('OG Gantt', { name: newName, template: selTemplate });
    await frappeApi.parseUpload({ gantt: g.name, tasks: preview });
    setShowNew(false); setPreview(null); setNewName(''); setSelTemplate(''); refresh();
  };
  return (
    <div className="page">
      <div className="page-head"><h1>My Gantts</h1><button className="btn btn-primary" onClick={()=>setShowNew(true)}>New Gantt</button></div>
      {showNew && (
        <div className="card" style={{display:'grid',gap:12}}>
          <div className="form"><label>Gantt name<input value={newName} onChange={e=>setNewName(e.target.value)} /></label></div>
          <div className="form"><label>Template
            <select value={selTemplate} onChange={e=>setSelTemplate(e.target.value)}><option value="">--</option>{templates.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}</select>
          </label></div>
          <div className="form"><label>Upload file (xlsx/csv)<input type="file" accept=".xlsx,.csv,.xls" onChange={onUpload} /></label></div>
          {preview && (
            <div style={{maxHeight:220,overflow:'auto',border:'1px solid var(--line)',borderRadius:6}}>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <thead style={{background:'var(--surface-soft)'}}><tr>{['name','kind','parent'].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left'}}>{h}</th>)}</tr></thead>
                <tbody>{preview.slice(0,30).map((t,i)=><tr key={i} style={{borderTop:'1px solid var(--line-soft)'}}><td style={{padding:'4px 8px'}}>{t.task_name}</td><td style={{padding:'4px 8px'}}>{t.kind}</td><td style={{padding:'4px 8px'}}>{t.parent_temp_id?.slice(0,6)||'-'}</td></tr>)}</tbody>
              </table>
              {preview.length>30 && <div style={{padding:8,fontSize:11,color:'var(--text-muted)'}}>...and {preview.length-30} more rows</div>}
            </div>
          )}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button className="btn btn-ghost" onClick={()=>{setShowNew(false);setPreview(null);}}>Cancel</button>
            <button className="btn btn-primary" onClick={saveGantt} disabled={!preview}>Save Gantt</button>
          </div>
        </div>
      )}
      <div className="list">
        {items.map(g => (
          <div key={g.name} className="row">
            <div><strong>{g.name}</strong><span>{g.template}</span></div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>onOpen(g.name)}>Open</button>
              <button className="btn btn-danger" onClick={async ()=>{await frappeApi.delete('OG Gantt', g.name); refresh();}}>Delete</button>
            </div>
          </div>
        ))}
        {items.length===0 && <div className="empty-state"><strong>No Gantts yet</strong><span>Upload a file against a template to create one.</span></div>}
      </div>
    </div>
  );
}

function GanttEditorScreen({ name, onBack }: { name: string | null; onBack: () => void }) {
  const [gantt, setGantt] = useState<GanttDoc | null>(null);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [selStyle, setSelStyle] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string>('week');
  const [filter, setFilter] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => { if (!name) return; frappeApi.read('OG Gantt', name).then((r: any)=>{setGantt(r);setSelStyle(r.active_style||'');}); frappeApi.list('OG Task').then((r: any)=>setTasks((r||[]).filter((t:TaskDoc)=>t.gantt===name))); }, [name]);
  useEffect(() => { if (!gantt) return; frappeApi.list('OG Style').then((r: any)=>setStyles((r||[]).filter((s:StyleDoc)=>s.template===gantt.template))); }, [gantt]);

  const nodes = useMemo(()=>rollupTaskTree(toNodes(tasks)), [tasks]);
  const filtered = useMemo(()=>{
    if (!filter.trim()) return nodes;
    const f = filter.toLowerCase();
    return nodes.filter(n=>n.name.toLowerCase().includes(f));
  }, [nodes, filter]);
  const dates = useMemo(()=>{
    const starts = filtered.map(n=>n.rollupStartDate||n.startDate).filter(Boolean) as string[];
    const ends = filtered.map(n=>n.rollupEndDate||n.endDate).filter(Boolean) as string[];
    if (!starts.length) { const today=new Date(); return {start:today,end:addDays(today,30)}; }
    const s = new Date(`${starts.reduce((a,b)=>a<b?a:b)}T00:00:00Z`);
    const e = new Date(`${ends.reduce((a,b)=>a>b?a:b)}T00:00:00Z`);
    return {start: addDays(s,-7), end: addDays(e,7)};
  }, [filtered]);
  const pxPerDay = zoom==='day'?40:zoom==='week'?20:zoom==='month'?8:4;
  const totalDays = Math.max(1, daysBetween(dates.start, dates.end));
  const timelineWidth = totalDays * pxPerDay;
  const share = async () => {
    if (!gantt) return;
    const snapshot = { tasks, style: selStyle };
    const r = await frappeApi.publishShare({ gantt: gantt.name, snapshot });
    setShareUrl(window.location.origin + r.url);
    setShowShare(true);
  };
  const exportHtml = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>OpenGantt Export</title><style>${document.querySelector('style')?.innerHTML||''}</style></head><body><div id="root"></div><script>window.__OG_EXPORT__=${JSON.stringify({tasks,style:selStyle})};</script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${gantt?.name||'gantt'}.html`; a.click();
  };
  const reimport = async () => {
    if (!gantt || !window.confirm('Re-import will replace all tasks. Continue?')) return;
    // For now just a stub: would re-read source_file and re-parse
    alert('Re-import not fully wired in this build.');
  };
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <div className="topbar" style={{borderBottom:'1px solid var(--line)'}}>
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <strong style={{fontSize:15}}>{gantt?.name}</strong>
        <input className="searchbox" style={{flex:1,minWidth:200}} placeholder="Filter tasks..." value={filter} onChange={e=>setFilter(e.target.value)} />
        <select value={zoom} onChange={e=>setZoom(e.target.value)} style={{height:30}}><option>day</option><option>week</option><option>month</option><option>quarter</option></select>
        <select value={selStyle} onChange={e=>{setSelStyle(e.target.value); if(gantt)frappeApi.update('OG Gantt',{name:gantt.name,active_style:e.target.value});}} style={{height:30}}><option value="">Default</option>{styles.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select>
        <button className="btn btn-ghost" onClick={share}>Share</button>
        <button className="btn btn-ghost" onClick={exportHtml}>Export HTML</button>
        <button className="btn btn-ghost" onClick={reimport}>Re-import</button>
      </div>
      <div className="gantt-layout" style={{flex:1,minHeight:0}}>
        <div className="gantt-sidebar">
          <div style={{display:'grid',gridTemplateColumns:'24px 1fr',padding:'8px 12px',borderBottom:'1px solid var(--line)',background:'var(--surface-soft)',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
            <span></span><span>Task</span>
          </div>
          <div style={{overflow:'auto',flex:1}}>
            {filtered.map(t => (
              <div key={t.id} className={`task-row ${selectedTask===t.id?'selected':''}`} style={{paddingLeft: `${12 + (t.depth||0)*16}px`}} onClick={()=>setSelectedTask(t.id)}>
                <span>{t.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="gantt-canvas">
          <div style={{position:'relative',height:'100%',overflow:'auto'}}>
            <div style={{position:'sticky',top:0,zIndex:4,display:'grid',gridTemplateRows:'24px 22px',borderBottom:'1px solid var(--line)',background:'var(--surface-soft)',width:timelineWidth}}>
              <div style={{display:'flex',fontSize:10.5,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em'}}>
                {Array.from({length:totalDays}).map((_,i)=>{ const d=addDays(dates.start,i); if (d.getDate()===1) return <div key={i} style={{width:pxPerDay,boxSizing:'border-box',borderRight:'1px solid var(--line-soft)',paddingLeft:4}}>{d.toLocaleString('default',{month:'short'})}</div>; return <div key={i} style={{width:pxPerDay,borderRight:'1px solid var(--line-soft)'}} />; })}
              </div>
              <div style={{display:'flex',fontSize:10.5,color:'var(--text-faint)',fontWeight:600}}>
                {Array.from({length:totalDays}).map((_,i)=>{ const d=addDays(dates.start,i); return <div key={i} style={{width:pxPerDay,display:'grid',placeItems:'center',borderRight:'1px solid var(--line-soft)'}}>{d.getDate()}</div>; })}
              </div>
            </div>
            <div style={{position:'relative',width:timelineWidth}}>
              {filtered.map((t) => {
                const s = new Date(`${t.rollupStartDate||t.startDate}T00:00:00Z`);
                const e = new Date(`${t.rollupEndDate||t.endDate}T00:00:00Z`);
                const left = daysBetween(dates.start, s) * pxPerDay;
                const width = Math.max(2, (daysBetween(s, e)+1) * pxPerDay);
                return (
                  <div key={t.id} className={`task-row ${selectedTask===t.id?'selected':''}`} style={{position:'relative',height:36,borderBottom:'1px solid var(--line-soft)'}}>
                    {(t.rollupStartDate||t.startDate) && (
                      <div className="bar" style={{left, width, background: t.kind==='group'?'var(--text)':'var(--blue)'}}>
                        <strong>{t.name}</strong>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selectedTask && (
        <TaskPanel task={nodes.find(n=>n.id===selectedTask)!} tasks={tasks} onClose={()=>setSelectedTask(null)} onUpdate={()=>{ if(name)frappeApi.list('OG Task').then((r:any)=>setTasks((r||[]).filter((t:TaskDoc)=>t.gantt===name))); }} />
      )}
      {showShare && (
        <div className="modal-overlay" onClick={()=>setShowShare(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h2>Share URL</h2>
            <input value={shareUrl} readOnly onFocus={e=>e.target.select()} style={{width:'100%'}} />
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-primary" onClick={()=>{navigator.clipboard.writeText(shareUrl);setShowShare(false);}}>Copy</button>
              <button className="btn btn-ghost" onClick={()=>setShowShare(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskPanel({ task, tasks, onClose, onUpdate }: { task: TaskNode; tasks: TaskDoc[]; onClose: () => void; onUpdate: () => void }) {
  const doc = tasks.find(t=>t.name===task.id);
  const [name, setName] = useState(task.name);
  const [start, setStart] = useState(task.startDate||'');
  const [end, setEnd] = useState(task.endDate||'');
  const [fields, setFields] = useState<Record<string,any>>({});
  useEffect(() => { if (!doc) return; try { setFields(JSON.parse(doc.fields||'{}')); } catch {} }, [doc]);
  const save = async () => {
    if (!doc) return;
    await frappeApi.update('OG Task', { name: doc.name, task_name: name, start_date: start||null, end_date: end||null, fields: JSON.stringify(fields) });
    onUpdate();
    onClose();
  };
  return (
    <div style={{position:'fixed',right:0,top:56,bottom:0,width:340,borderLeft:'1px solid var(--line)',background:'var(--surface)',zIndex:10,padding:16,display:'flex',flexDirection:'column',gap:12,overflow:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3 style={{margin:0}}>Edit Task</h3><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      <div className="form"><label>Name<input value={name} onChange={e=>setName(e.target.value)} /></label></div>
      <div className="form"><label>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)} /></label></div>
      <div className="form"><label>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label></div>
      {Object.entries(fields).map(([k,v])=> (
        <div key={k} className="form"><label>{k}<input value={v||''} onChange={e=>setFields({...fields,[k]:e.target.value})} /></label></div>
      ))}
      <div style={{marginTop:'auto',display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function SettingsScreen({ user }: { user: string }) {
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="card"><strong>User</strong><span>{user}</span></div>
      <div className="card"><button className="btn btn-ghost" onClick={()=>{window.location.href='/app';}}>Go to Desk</button></div>
    </div>
  );
}
