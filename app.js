/* SSRP Forge Studio v3 — stable mobile-first vanilla canvas editor */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const supportsWebp = (() => { try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }})();
  const MAX_HISTORY = 18;
  const MAX_IMAGE_EDGE = 8192;

  const DEFAULT_SERVER = {
    name:'SSRP Classic',
    font:'Arial', fontSize:18, radius:8, padding:9, panel:'semi', panelOpacity:.72, shadow:true,
    timestamp:true, timestampFormat:'HH:MM:SS', nameEnabled:true, nameFormat:'name_message',
    meColor:'#d7b6ff', doColor:'#82e7ff', icColor:'#ffffff', whisperColor:'#ffe48a', shoutColor:'#a7ff9c', systemColor:'#ff9292'
  };
  const LOOKS = {
    'Natural RP': {brightness:0,contrast:3,saturation:0,warmth:0,vignette:0,grain:0,fade:0,blur:0},
    'Old School': {brightness:2,contrast:-5,saturation:-5,warmth:10,vignette:10,grain:4,fade:2,blur:0},
    'Night RP': {brightness:-7,contrast:9,saturation:-5,warmth:4,vignette:17,grain:2,fade:0,blur:0},
    'Cinematic': {brightness:0,contrast:14,saturation:-8,warmth:1,vignette:18,grain:3,fade:1,blur:0},
    'Street': {brightness:2,contrast:10,saturation:5,warmth:-1,vignette:6,grain:1,fade:0,blur:0},
    'Clean HD': {brightness:3,contrast:6,saturation:2,warmth:0,vignette:2,grain:0,fade:0,blur:0}
  };
  const ACTIONS = {
    Movement:['berjalan menuju pintu','berdiri dari kursinya','duduk di sofa','masuk ke dalam kendaraan','keluar dari kendaraan','berjalan mendekati seseorang'],
    Body:['menghela napas pelan','mengangkat tangan kanannya','menoleh ke arah samping','mengangguk singkat','merapikan pakaiannya','memasukkan tangan ke saku'],
    Interaction:['mengambil ponsel dari sakunya','membuka pintu','mengetuk pintu dua kali','mengulurkan tangannya','menyalakan mesin kendaraan','memeriksa isi tas'],
    Reaction:['terlihat terkejut','memperhatikan keadaan sekitar','terlihat bingung sejenak','tetap tenang sambil menunggu','tersenyum tipis','mengernyitkan dahi']
  };
  const TOOL_META = {
    move:['MOVE','Transform'],crop:['CROP','Crop & Canvas'],brush:['BRUSH','Freehand'],shape:['SHAPE','Shapes & Arrows'],text:['TEXT','Caption / Text'],
    act:['ACT BUILDER','Game Chat Composer'],chat:['CHAT','Message Stack'],mask:['HUD CLEANER','Cover / Erase'],blur:['BLUR','Blur / Pixelate'],effects:['IMAGE FX','Color & Finish'],layer:['LAYERS','Layer Stack'],canvas:['CANVAS','Canvas & Guides']
  };

  const state = {
    project:null,
    tool:'move',
    selectedLayerId:null,
    selectedMessageId:null,
    history:[], historyIndex:-1,
    assets:new Map(),
    imageCache:new Map(),
    drawCache:new Map(),
    stageScale:1,
    camera:{zoom:1,panX:0,panY:0},
    pointers:new Map(),
    gesture:null,
    cropRect:null,
    draftMessage:null,
    editingLayerId:null,
    autosaveTimer:null,
    saveSeq:0,
    renderQueued:false,
    grainCache:new Map(),
    adjustedImageCache:new Map(),
    adjustedImagePending:new Map(),
    maskCache:new Map(),
    sampleMode:false,
    dirty:false
  };

  const els = {
    app:$('#app'), canvas:$('#editorCanvas'), frame:$('#canvasFrame'), stage:$('#stage'),
    projectName:$('#projectName'), undo:$('#undoBtn'), redo:$('#redoBtn'), save:$('#saveBtn'), export:$('#exportBtn'), menu:$('#menuBtn'),
    empty:$('#emptyHint'), stagePill:$('#stagePill'), zoomLabel:$('#zoomLabel'), canvasMeta:$('#canvasMeta'), status:$('#statusText'), autosave:$('#autosaveState'),
    fit:$('#fitBtn'), zoomIn:$('#zoomInBtn'), zoomOut:$('#zoomOutBtn'), rotate:$('#rotateBtn'), fullscreen:$('#fullscreenBtn'), guides:$('#guidesBtn'), grid:$('#gridBtn'),
    bottomSheet:$('#bottomSheet'), sheetBackdrop:$('#sheetBackdrop'), sheetContent:$('#sheetContent'), sheetKicker:$('#sheetKicker'), sheetTitle:$('#sheetTitle'), sheetClose:$('#sheetClose'),
    menuModal:$('#menuModal'), menuClose:$('#menuClose'), exportModal:$('#exportModal'), exportClose:$('#exportClose'), welcomeModal:$('#welcomeModal'),
    imageInput:$('#imageInput'), projectInput:$('#projectInput'), toast:$('#toast'), exportFormat:$('#exportFormat'), exportQuality:$('#exportQuality'), exportResolution:$('#exportResolution'), exportMeta:$('#exportMeta')
  };
  const ctx = els.canvas.getContext('2d', {alpha:false, desynchronized:true});

  function freshProject(){
    return {
      version:3,id:uid('project'),name:'Untitled Project',width:1280,height:720,
      layers:[],adjustments:clone(LOOKS['Natural RP']),server:clone(DEFAULT_SERVER),
      guides:{center:false,safe:false,grid:false},camera:{zoom:1,panX:0,panY:0},createdAt:Date.now(),updatedAt:Date.now()
    };
  }
  state.project=freshProject();

  function notify(message){
    els.toast.textContent=message;
    els.toast.classList.add('show');
    clearTimeout(notify.timer); notify.timer=setTimeout(()=>els.toast.classList.remove('show'),1900);
  }
  function setStatus(message){ els.status.textContent=message; }
  function markDirty(){
    state.dirty=true; els.autosave.textContent='Saving…';
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer=setTimeout(()=>saveProject(true),700);
  }
  function commit(label='Edit'){
    const snapshot=serialize(false);
    state.history=state.history.slice(0,state.historyIndex+1);
    state.history.push({label,snapshot});
    if(state.history.length>MAX_HISTORY) state.history.shift();
    state.historyIndex=state.history.length-1;
    markDirty(); updateUndoRedo(); queueRender();
  }
  function initHistory(){
    state.history=[{label:'Initial',snapshot:serialize(false)}]; state.historyIndex=0; updateUndoRedo();
  }
  function restoreSnapshot(snapshot){
    try{
      const data=JSON.parse(snapshot);
      state.project=data;
      state.project.server={...DEFAULT_SERVER,...(data.server||{})};
      state.project.adjustments={...LOOKS['Natural RP'],...(data.adjustments||{})};
      state.project.guides={center:false,safe:false,grid:false,...(data.guides||{})};
      state.project.camera={zoom:1,panX:0,panY:0,...(data.camera||{})};
      state.selectedLayerId=null; state.selectedMessageId=null; state.editingLayerId=null; state.cropRect=null;
      hydrateRuntimeLayers(); updateUI(); queueRender();
    }catch(error){ console.error(error); notify('History rusak — perubahan ini dilewati.'); }
  }
  function undo(){
    if(state.historyIndex<=0){notify('Belum ada yang bisa di-undo');return;}
    state.historyIndex--; restoreSnapshot(state.history[state.historyIndex].snapshot); markDirty(); updateUndoRedo(); notify('Undo');
  }
  function redo(){
    if(state.historyIndex>=state.history.length-1){notify('Belum ada yang bisa di-redo');return;}
    state.historyIndex++; restoreSnapshot(state.history[state.historyIndex].snapshot); markDirty(); updateUndoRedo(); notify('Redo');
  }
  function updateUndoRedo(){
    els.undo.disabled=state.historyIndex<=0;
    els.redo.disabled=state.historyIndex>=state.history.length-1;
  }

  /* Storage: history/project metadata never contains image bytes. Saved project includes assets once. */
  function serialize(includeAssets=true){
    const p=clone(state.project);
    delete p._runtime; delete p.camera; delete p.updatedAt;
    if(!includeAssets) return JSON.stringify(p);
    p.camera=clone(state.camera);
    p.updatedAt=Date.now();
    p.assets={}; state.assets.forEach((src,id)=>{p.assets[id]=src;});
    return JSON.stringify(p);
  }
  function hydrateRuntimeLayers(){
    for(const layer of state.project.layers){
      if(layer.type==='image' && layer.assetId){ layer.src=state.assets.get(layer.assetId)||layer.src||null; }
      if(layer.type==='image' && !layer.assetId && layer.src){ layer.assetId=uid('asset'); state.assets.set(layer.assetId,layer.src); delete layer.src; }
    }
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(new Error('IndexedDB unsupported'));return;}
      const request=indexedDB.open('ssrp-forge-studio',2);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('projects')) db.createObjectStore('projects',{keyPath:'id'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB error'));
    });
  }
  async function idbPut(record){
    const db=await openDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readwrite');
      tx.objectStore('projects').put(record); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    }); db.close();
  }
  async function idbGetAll(){
    const db=await openDb();
    const rows=await new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});
    db.close(); return rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  }
  async function idbGet(id){
    try{const db=await openDb();const row=await new Promise((resolve,reject)=>{const r=db.transaction('projects','readonly').objectStore('projects').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return row;}catch{return null;}
  }
  async function idbDelete(id){try{const db=await openDb();await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}catch(error){console.warn(error);}}

  async function makeThumb(){
    try{
      const c=document.createElement('canvas'); c.width=320;c.height=180;
      await renderTo(c,{exportMode:true,forceSize:[320,180],showSelection:false});
      return c.toDataURL('image/jpeg',.68);
    }catch{return null;}
  }
  async function saveProject(silent=false){
    if(state.saveSeq) return;
    state.saveSeq=1;
    try{
      const parsed=JSON.parse(serialize(true));
      parsed.thumb=await makeThumb();
      await idbPut(parsed);
      state.project.updatedAt=Date.now(); state.dirty=false; els.autosave.textContent='Saved';
      if(!silent) notify('Project tersimpan di perangkat');
    }catch(error){
      console.error(error); els.autosave.textContent='Local only';
      try{
        const tiny={name:state.project.name,width:state.project.width,height:state.project.height,updatedAt:Date.now()};
        localStorage.setItem('ssrp-forge-last',JSON.stringify(tiny));
      }catch{}
      if(!silent) notify('Storage tidak tersedia — project tetap terbuka');
    }finally{state.saveSeq=0;}
  }
  async function openProjects(){
    let rows=[]; try{rows=await idbGetAll();}catch{}
    openSheet('PROJECTS','Recent Projects',`
      <div class="section"><div class="section-title">RECENT PROJECTS</div>
      ${rows.length?rows.map((p,i)=>`<div class="project-row" data-project-id="${esc(p.id)}">
        <div class="layer-thumb">${p.thumb?`<img src="${p.thumb}" alt="" style="width:42px;height:34px;object-fit:cover;border-radius:7px">`:'✦'}</div>
        <div class="row-main"><strong>${esc(p.name||'Untitled')}</strong><span>${p.width}×${p.height} · ${new Date(p.updatedAt||Date.now()).toLocaleString()}</span></div>
        <div class="row-actions"><button class="small-icon" data-action="loadProject">↗</button><button class="small-icon" data-action="deleteProject">×</button></div>
      </div>`).join(''):'<div class="helper">Belum ada project tersimpan.</div>'}</div>
      <div class="section"><div class="section-actions"><button class="primary" data-action="newProject">+ New Project</button><button class="secondary" data-action="saveProject">Save Current</button></div></div>
    `);
  }
  async function loadProject(id){
    const record=await idbGet(id); if(!record){notify('Project tidak ditemukan');return;}
    state.assets=new Map(Object.entries(record.assets||{}));
    const data=clone(record); delete data.assets; delete data.thumb;
    state.project=data; state.project.server={...DEFAULT_SERVER,...(data.server||{})}; state.project.adjustments={...LOOKS['Natural RP'],...(data.adjustments||{})};
    state.camera={zoom:1,panX:0,panY:0,...(data.camera||{})}; state.project.camera=clone(state.camera);
    hydrateRuntimeLayers(); state.selectedLayerId=null; initHistory(); closeSheet(); updateUI(); fitCamera(); queueRender(); notify('Project dibuka');
  }
  function newProject(){
    state.assets=new Map(); state.imageCache.clear(); state.drawCache.clear(); state.maskCache.clear(); state.project=freshProject();state.camera={zoom:1,panX:0,panY:0};
    state.selectedLayerId=null;state.selectedMessageId=null;state.cropRect=null;initHistory();updateUI();closeModals();fitCamera();queueRender();els.welcomeModal.setAttribute('aria-hidden','true');notify('Project baru dibuat');
  }

  async function fileToDataUrl(file){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(r.error);r.onload=()=>resolve(r.result);r.readAsDataURL(file);});
  }
  function loadImage(src){
    const cached=state.imageCache.get(src);
    if(cached instanceof HTMLImageElement) return Promise.resolve(cached);
    if(cached instanceof Promise) return cached;
    const promise=new Promise((resolve,reject)=>{
      const img=new Image();
      img.decoding='async';
      img.onload=()=>{state.imageCache.set(src,img);resolve(img);};
      img.onerror=()=>{state.imageCache.delete(src);reject(new Error('Image decode failed'));};
      img.src=src;
    });
    state.imageCache.set(src,promise); return promise;
  }
  async function importImage(file,{asLayer=false}={}){
    if(!file || !file.type.startsWith('image/')){notify('Pilih gambar PNG, JPG, atau WebP');return;}
    if(file.size>50*1024*1024){notify('File terlalu besar. Maksimum 50 MB.');return;}
    try{
      const src=await fileToDataUrl(file); const img=await loadImage(src);
      let w=img.naturalWidth,h=img.naturalHeight;
      let data=src;
      if(w>MAX_IMAGE_EDGE||h>MAX_IMAGE_EDGE){
        const s=MAX_IMAGE_EDGE/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);
        const normalized=document.createElement('canvas');normalized.width=w;normalized.height=h;normalized.getContext('2d').drawImage(img,0,0,w,h);
        const mime=file.type==='image/png'?'image/png':(file.type==='image/webp'&&supportsWebp?'image/webp':'image/jpeg');
        data=normalized.toDataURL(mime,.98);
      }
      const assetId=uid('asset');state.assets.set(assetId,data);state.imageCache.set(data,img);
      if(data!==src){loadImage(data).catch(()=>{});}
      if(!asLayer && !getImageLayer()){
        state.project.width=w;state.project.height=h;
        state.project.layers=[{id:uid('layer'),type:'image',name:file.name||'Screenshot',assetId,x:0,y:0,w,h,scale:1,rotation:0,opacity:1,visible:true,locked:true,flipX:false,flipY:false}];
      }else if(!asLayer){
        const base=getImageLayer(); base.assetId=assetId;base.w=state.project.width;base.h=state.project.height;base.x=0;base.y=0;base.scale=1;base.rotation=0;base.locked=true;
      }else{
        const maxW=state.project.width*.62;const sc=Math.min(1,maxW/w);const lw=w*sc,lh=h*sc;
        state.project.layers.push({id:uid('layer'),type:'image',name:file.name||'Image',assetId,x:(state.project.width-lw)/2,y:(state.project.height-lh)/2,w:lw,h:lh,scale:1,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false});
      }
      state.project.name=state.project.name==='Untitled Project' ? (file.name||'SSRP Project').replace(/\.[^.]+$/,'') : state.project.name;
      state.selectedLayerId=state.project.layers[state.project.layers.length-1]?.id || state.project.layers[0]?.id;
      commit('Import screenshot'); els.welcomeModal.setAttribute('aria-hidden','true');fitCamera();queueRender();updateUI();notify(`Imported ${w}×${h}`);
    }catch(error){console.error(error);notify('Gagal membaca gambar');}
  }
  function getImageLayer(){return state.project.layers.find(l=>l.type==='image' && l.visible!==false) || null;}
  function getSelectedLayer(){return state.project.layers.find(l=>l.id===state.selectedLayerId)||null;}
  function assetSrc(layer){return layer?.assetId?state.assets.get(layer.assetId):layer?.src||null;}

  function adjustmentKey(){
    const a=state.project.adjustments||{};
    return [a.brightness||0,a.contrast||0,a.saturation||0,a.warmth||0].join(',');
  }
  function hasImageAdjustments(){
    const a=state.project.adjustments||{};
    return !!((a.brightness||0)||(a.contrast||0)||(a.saturation||0)||(a.warmth||0));
  }
  function adjustedDrawable(src,img){
    if(!hasImageAdjustments()) return img;
    const key=`${src}|${adjustmentKey()}`;
    const cached=state.adjustedImageCache.get(key);
    if(cached) return cached;
    if(state.adjustedImagePending.has(key)) return img;
    state.adjustedImagePending.set(key,true);
    try{
      const c=document.createElement('canvas');
      c.width=img.naturalWidth||img.width||1; c.height=img.naturalHeight||img.height||1;
      const x=c.getContext('2d',{willReadFrequently:true});
      x.drawImage(img,0,0,c.width,c.height);
      const id=x.getImageData(0,0,c.width,c.height);
      const d=id.data,a=state.project.adjustments||{};
      const b=(Number(a.brightness||0))*2.55;
      const ct=Number(a.contrast||0);
      const factor=(259*(ct+255))/(255*(259-ct));
      const sat=1+Number(a.saturation||0)/100;
      const warm=Number(a.warmth||0)/100;
      const wr=1+Math.max(0,warm)*0.16, wg=1+warm*0.035, wb=1+Math.min(0,warm)*0.16;
      for(let i=0;i<d.length;i+=4){
        let r=d[i]+b,g=d[i+1]+b,bl=d[i+2]+b;
        r=factor*(r-128)+128;g=factor*(g-128)+128;bl=factor*(bl-128)+128;
        const lum=.2126*r+.7152*g+.0722*bl;
        r=lum+(r-lum)*sat;g=lum+(g-lum)*sat;bl=lum+(bl-lum)*sat;
        r*=wr;g*=wg;bl*=wb;
        d[i]=clamp(Math.round(r),0,255);d[i+1]=clamp(Math.round(g),0,255);d[i+2]=clamp(Math.round(bl),0,255);
      }
      x.putImageData(id,0,0);
      state.adjustedImageCache.set(key,c);
      return c;
    }catch(error){
      console.warn('Image adjustment fallback',error);
      return img;
    }finally{
      state.adjustedImagePending.delete(key);
    }
  }

  function stageMetrics(){
    const r=els.frame.getBoundingClientRect();
    const padding=26; const sx=(r.width-padding*2)/state.project.width;const sy=(r.height-padding*2)/state.project.height;
    const fit=Math.max(.08,Math.min(sx,sy));
    const scale=fit*state.camera.zoom;
    return {r,fit,scale,cx:r.width/2+state.camera.panX,cy:r.height/2+state.camera.panY};
  }
  function fitCamera(){state.camera={zoom:1,panX:0,panY:0};state.project.camera=clone(state.camera);queueRender();setStatus('Fit to screen');}
  function zoomCamera(factor, anchorX, anchorY){
    const m=stageMetrics();const rect=m.r;const ax=anchorX-rect.left,ay=anchorY-rect.top;const oldScale=m.scale;const worldX=(ax-m.cx)/oldScale,worldY=(ay-m.cy)/oldScale;
    state.camera.zoom=clamp(state.camera.zoom*factor,.35,5);
    const n=stageMetrics(),newScale=n.scale;state.camera.panX=ax-(n.r.width/2)-worldX*newScale;state.camera.panY=ay-(n.r.height/2)-worldY*newScale;
    queueRender();
  }
  function screenToWorld(clientX,clientY){const m=stageMetrics();return {x:(clientX-m.r.left-m.cx)/m.scale,y:(clientY-m.r.top-m.cy)/m.scale};}
  function worldToScreen(x,y){const m=stageMetrics();return {x:m.r.left+m.cx+x*m.scale,y:m.r.top+m.cy+y*m.scale};}

  function setCanvasResolution(){
    const r=els.frame.getBoundingClientRect();
    const area=Math.max(1,r.width*r.height);
    const device=Math.min(window.devicePixelRatio||1,2);
    const memorySafe=Math.sqrt(6500000/area);
    const dpr=clamp(Math.min(device,memorySafe),1,2);
    const w=Math.max(1,Math.floor(r.width*dpr));const h=Math.max(1,Math.floor(r.height*dpr));
    if(els.canvas.width!==w||els.canvas.height!==h||els.canvas.style.width!==`${r.width}px`||els.canvas.style.height!==`${r.height}px`){
      els.canvas.width=w;els.canvas.height=h;els.canvas.style.width=`${r.width}px`;els.canvas.style.height=`${r.height}px`;
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    return {w:r.width,h:r.height,dpr};
  }
  function clearCanvas(c,w,h){c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle='#05070a';c.fillRect(0,0,w,h);c.restore();}

  function fontString(layer){return `${layer.italic?'italic ':''}${layer.weight||600} ${Math.max(6,layer.size||24)}px ${layer.font||'Arial'}`;}
  function roundedRect(c,x,y,w,h,r){r=Math.max(0,Math.min(r,Math.min(w,h)/2));c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function wrapLines(c,text,maxWidth){
    const words=String(text||'').split(/\s+/);const lines=[];let line='';for(const word of words){const test=line?`${line} ${word}`:word;if(c.measureText(test).width>maxWidth && line){lines.push(line);line=word;}else{line=test;}}if(line)lines.push(line);return lines.length?lines:[''];
  }
  function hexToRgb(hex){const m=String(hex).replace('#','').match(/^([a-f\d]{6})$/i);if(!m)return {r:255,g:255,b:255};const n=parseInt(m[1],16);return {r:n>>16&255,g:n>>8&255,b:n&255};}

  function drawImageLayer(c,l){
    const src=assetSrc(l);if(!src)return;
    const current=state.imageCache.get(src);
    // IMPORTANT: never schedule a render from an already-decoded image.
    // The previous code called Promise.resolve(img).then(queueRender) on every
    // frame, creating an endless RAF loop and the visible Android blinking.
    if(!current){
      loadImage(src).then(()=>queueRender()).catch(()=>{});
      return;
    }
    if(current instanceof Promise)return;
    const drawable=adjustedDrawable(src,current);
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);
    c.translate(l.x+l.w/2,l.y+l.h/2);
    c.rotate((l.rotation||0)*Math.PI/180);
    c.scale((l.scale||1)*(l.flipX?-1:1),(l.scale||1)*(l.flipY?-1:1));
    c.filter='none';
    c.drawImage(drawable,-l.w/2,-l.h/2,l.w,l.h);
    c.restore();
  }
  function drawTextLayer(c,l){
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);c.translate(l.x,l.y);c.rotate((l.rotation||0)*Math.PI/180);c.scale(l.scale||1,l.scale||1);c.font=fontString(l);c.textAlign=l.align||'left';c.textBaseline='top';c.fillStyle=l.color||'#fff';
    if(l.shadow){c.shadowColor='rgba(0,0,0,.9)';c.shadowBlur=6;c.shadowOffsetX=2;c.shadowOffsetY=2;}
    const lh=Math.max(8,(l.size||24)*(l.lineHeight||1.25));wrapLines(c,l.text||'',l.width||500).forEach((line,i)=>c.fillText(line,0,i*lh));c.restore();
  }
  function drawShapeLayer(c,l){
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);c.translate(l.x+l.w/2,l.y+l.h/2);c.rotate((l.rotation||0)*Math.PI/180);c.scale(l.scale||1,l.scale||1);c.translate(-l.w/2,-l.h/2);c.lineWidth=Math.max(1,l.strokeWidth||3);c.strokeStyle=l.stroke||l.fill||'#d7ff64';c.fillStyle=l.fill||'transparent';
    const x=0,y=0,w=l.w,h=l.h,r=l.radius||10;
    if(l.shape==='ellipse'){c.beginPath();c.ellipse(w/2,h/2,Math.abs(w/2),Math.abs(h/2),0,0,Math.PI*2);l.fillMode!=='stroke'&&c.fill();l.fillMode!=='fill'&&c.stroke();}
    else if(l.shape==='line'||l.shape==='arrow'){c.beginPath();c.moveTo(x,y+h);c.lineTo(w,h?y:0);c.stroke();if(l.shape==='arrow'){const a=Math.atan2(0-h,w-0);const s=12;c.beginPath();c.moveTo(w,h);c.lineTo(w-s*Math.cos(a-.55),h-s*Math.sin(a-.55));c.moveTo(w,h);c.lineTo(w-s*Math.cos(a+.55),h-s*Math.sin(a+.55));c.stroke();}}
    else{roundedRect(c,x,y,w,h,r);if(l.fillMode!=='stroke')c.fill();if(l.fillMode!=='fill')c.stroke();}
    c.restore();
  }
  function drawBrushLayer(c,l){
    if(!l.points?.length)return;c.save();c.globalAlpha=clamp(l.opacity??1,0,1);c.strokeStyle=l.color||'#d7ff64';c.lineWidth=Math.max(1,l.size||12);c.lineCap='round';c.lineJoin='round';c.beginPath();l.points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();c.restore();
  }
  function drawMaskLayer(c,l){
    const key=l.id;let off=state.maskCache.get(key);if(!off || off.width!==state.project.width || off.height!==state.project.height){off=document.createElement('canvas');off.width=state.project.width;off.height=state.project.height;state.maskCache.set(key,off);}const oc=off.getContext('2d');oc.clearRect(0,0,off.width,off.height);
    for(const stroke of l.strokes||[]){oc.save();oc.globalCompositeOperation=stroke.erase?'destination-out':'source-over';oc.fillStyle=stroke.color||l.color||'#000';oc.strokeStyle=stroke.color||l.color||'#000';oc.globalAlpha=clamp(stroke.opacity??(l.opacity??.8),0,1);
      if(stroke.shape==='rect'){oc.fillRect(stroke.x,stroke.y,stroke.w,stroke.h);}else{oc.lineCap='round';oc.lineJoin='round';oc.lineWidth=Math.max(2,stroke.size||l.size||42);oc.beginPath();stroke.points.forEach((p,i)=>i?oc.lineTo(p.x,p.y):oc.moveTo(p.x,p.y));oc.stroke();}
      oc.restore();}
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);c.drawImage(off,0,0);c.restore();
  }
  function drawSelectiveEffect(c,l,kind){
    const base=getImageLayer();const src=base?assetSrc(base):null;if(!src)return;const img=state.imageCache.get(src);if(!img || img instanceof Promise)return;
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);
    const drawClipped=path=>{c.save();path();c.clip();if(kind==='blur'){c.filter=`blur(${clamp(l.intensity||14,2,50)}px)`;c.drawImage(img,0,0,base.w,base.h);}else{
      const small=Math.max(4,Math.round(100/(clamp(l.block||12,4,35))));const tmp=document.createElement('canvas');tmp.width=Math.max(1,Math.round(base.w/small));tmp.height=Math.max(1,Math.round(base.h/small));tmp.getContext('2d').drawImage(img,0,0,tmp.width,tmp.height);c.imageSmoothingEnabled=false;c.drawImage(tmp,0,0,tmp.width,tmp.height,0,0,base.w,base.h);c.imageSmoothingEnabled=true;
    }c.restore();};
    if(l.shape==='rect') drawClipped(()=>c.rect(l.x,l.y,l.w,l.h));
    else {for(const p of l.points||[]) drawClipped(()=>c.arc(p.x,p.y,l.size||70,0,Math.PI*2));}
    c.restore();
  }
  function messageColor(msg){const s=state.project.server;return msg.color||(msg.mode==='me'?s.meColor:msg.mode==='do'?s.doColor:msg.mode==='whisper'?s.whisperColor:msg.mode==='shout'?s.shoutColor:msg.mode==='system'?s.systemColor:s.icColor);}
  function formatClock(timestamp){const d=new Date(timestamp||Date.now());const p=n=>String(n).padStart(2,'0');return state.project.server.timestampFormat==='HH:MM'?`${p(d.getHours())}:${p(d.getMinutes())}`:`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
  function resolveText(msg){const vars=msg.vars||{};return String(msg.text||'').replaceAll('{name}',msg.name||'').replaceAll('{time}',msg.time||formatClock(msg.timestamp)).replaceAll('{location}',vars.location||'').replaceAll('{action}',vars.action||'');}
  function chatDisplay(msg){
    const text=resolveText(msg);const s=state.project.server;const name=s.nameEnabled&&msg.name?msg.name:'';
    const label=s.nameFormat==='bracket'&&name?`[${name}]`:name;
    let content=text;
    if(msg.mode==='me') content=`* ${label?label+' ':''}${text}`;
    if(msg.mode==='do') content=`* ${text}`;
    if(msg.mode==='whisper') content=`[Whisper] ${label?label+': ':''}${text}`;
    if(msg.mode==='shout') content=`${label?label+': ':''}${text.toUpperCase()}`;
    if(msg.mode==='system') content=`[SYSTEM] ${text}`;
    if(msg.mode==='ic') content=s.nameFormat==='name_only'?(label||text):(label?`${label}: ${text}`:text);
    return content;
  }
  function drawChatLayer(c,l){
    const msg=l.message||{};const s=state.project.server;const size=l.size||s.fontSize;const maxW=Math.max(120,l.width||560);const pad=s.padding||9;
    c.save();c.globalAlpha=clamp(l.opacity??1,0,1);c.font=`600 ${size}px ${s.font||'Arial'}`;c.textAlign='left';c.textBaseline='top';
    const prefix=(msg.showTimestamp??s.timestamp)?`[${msg.time||formatClock(msg.timestamp)}] `:'';const text=prefix+chatDisplay(msg);const lines=wrapLines(c,text,maxW-pad*2);const lh=size*1.22;const h=lines.length*lh+pad*2;const w=Math.min(maxW,Math.max(...lines.map(line=>c.measureText(line).width),140)+pad*2);
    if(s.panel!=='none'){c.fillStyle=s.panel==='dark'?'rgba(0,0,0,.9)':s.panel==='box'?'rgba(16,20,25,.96)':'rgba(7,10,13,.72)';if(s.shadow){c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=9;c.shadowOffsetY=3;}roundedRect(c,l.x,l.y,w,h,s.radius);c.fill();c.shadowColor='transparent';}
    c.fillStyle=messageColor(msg);const before=state.project.server.nameEnabled&&msg.name?msg.name:'';if(msg.mode==='me'||msg.mode==='do')c.fillStyle=messageColor(msg);lines.forEach((line,i)=>c.fillText(line,l.x+pad,l.y+pad+i*lh));
    c.restore();l._renderWidth=w;l._renderHeight=h;
  }
  function applyFinish(c){
    const a=state.project.adjustments||{};c.save();
    if(a.warmth){const alpha=Math.abs(a.warmth)/100*.22;c.fillStyle=a.warmth>0?`rgba(255,180,70,${alpha})`:`rgba(80,150,255,${alpha})`;c.fillRect(0,0,state.project.width,state.project.height);}
    if(a.fade){c.fillStyle=`rgba(255,255,255,${clamp(a.fade/100*.16,0,.16)})`;c.fillRect(0,0,state.project.width,state.project.height);}
    if(a.vignette){const g=c.createRadialGradient(state.project.width/2,state.project.height/2,Math.min(state.project.width,state.project.height)*.2,state.project.width/2,state.project.height/2,Math.max(state.project.width,state.project.height)*.72);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,`rgba(0,0,0,${clamp(a.vignette/100*.72,0,.72)})`);c.fillStyle=g;c.fillRect(0,0,state.project.width,state.project.height);}
    if(a.grain){const key=Math.round(a.grain);let tile=state.grainCache.get(key);if(!tile){tile=document.createElement('canvas');tile.width=96;tile.height=96;const tc=tile.getContext('2d');const id=tc.createImageData(tile.width,tile.height);for(let i=0;i<id.data.length;i+=4){const v=Math.random()*255;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=clamp(Math.round(key*2.2),0,42);}tc.putImageData(id,0,0);state.grainCache.set(key,tile);}c.globalAlpha=.8;c.fillStyle=c.createPattern(tile,'repeat');c.fillRect(0,0,state.project.width,state.project.height);}
    c.restore();
  }

  async function drawLayer(c,l,exportMode){
    if(l.visible===false)return;
    if(l.type==='image')drawImageLayer(c,l);
    else if(l.type==='text')drawTextLayer(c,l);
    else if(l.type==='shape')drawShapeLayer(c,l);
    else if(l.type==='brush')drawBrushLayer(c,l);
    else if(l.type==='mask')drawMaskLayer(c,l);
    else if(l.type==='blur')drawSelectiveEffect(c,l,'blur');
    else if(l.type==='pixelate')drawSelectiveEffect(c,l,'pixelate');
    else if(l.type==='chat')drawChatLayer(c,l);
    else if(l.type==='watermark')drawTextLayer(c,l);
  }
  async function renderTo(outCanvas,{exportMode=false,forceSize=null,showSelection=false,includeAdjustments=true}={}){
    const [ow,oh]=forceSize||[state.project.width,state.project.height];
    outCanvas.width=ow;outCanvas.height=oh;
    const c=outCanvas.getContext('2d',{alpha:false});
    c.fillStyle='#06080b';c.fillRect(0,0,ow,oh);
    const imageLayers=state.project.layers.filter(l=>l.type==='image'&&assetSrc(l));
    await Promise.all(imageLayers.map(l=>loadImage(assetSrc(l)).catch(()=>null)));
    const sx=ow/state.project.width,sy=oh/state.project.height;c.save();c.scale(sx,sy);
    for(const layer of state.project.layers) await drawLayer(c,layer,exportMode);
    if(includeAdjustments) applyFinish(c);c.restore();
    return outCanvas;
  }
  function render(){
    setCanvasResolution();const rect=els.frame.getBoundingClientRect();clearCanvas(ctx,rect.width,rect.height);
    const m=stageMetrics(); state.stageScale=m.scale;
    ctx.save();ctx.translate(m.cx,m.cy);ctx.scale(m.scale,m.scale);ctx.translate(-state.project.width/2,-state.project.height/2);
    for(const layer of state.project.layers) drawLayer(ctx,layer,false);
    if(state.tool==='shape' && state.gesture?.draw){
      const d=state.gesture.draw,s=d.start,e=d.current||d.start;
      const x=Math.min(s.x,e.x),y=Math.min(s.y,e.y),w=Math.abs(e.x-s.x),h=Math.abs(e.y-s.y);
      if(w>0||h>0) drawShapeLayer(ctx,{x,y,w,h,shape:state._shape||'rect',fill:getBindValue('shapeFill','#d7ff64'),stroke:getBindValue('shapeStroke','#d7ff64'),strokeWidth:Number(getBindValue('shapeWidth',3)),fillMode:getBindValue('shapeMode','fill'),radius:12,opacity:.55,scale:1,rotation:0});
    }
    applyFinish(ctx);drawSelection();ctx.restore();
    els.zoomLabel.textContent=`${Math.round(state.camera.zoom*100)}%`;els.canvasMeta.textContent=`${state.project.width} × ${state.project.height}`;
    els.empty.style.display=getImageLayer()?'none':'flex'; updateGuides(); updateCropOverlay();
  }
  function queueRender(){if(state.renderQueued)return;state.renderQueued=true;requestAnimationFrame(()=>{state.renderQueued=false;render();});}

  function getLayerBounds(l){
    if(['image','shape','blur','pixelate'].includes(l.type))return {x:l.x,y:l.y,w:(l.w||100)*(l.scale||1),h:(l.h||100)*(l.scale||1)};
    if(['text','chat','watermark'].includes(l.type))return {x:l.x,y:l.y,w:(l._renderWidth||l.width||500)*(l.scale||1),h:(l._renderHeight||l.height||80)*(l.scale||1)};
    if(l.points?.length){const xs=l.points.map(p=>p.x),ys=l.points.map(p=>p.y);return {x:Math.min(...xs)-20,y:Math.min(...ys)-20,w:Math.max(...xs)-Math.min(...xs)+40,h:Math.max(...ys)-Math.min(...ys)+40};}
    return null;
  }
  function pointInBounds(p,b){return b&&p.x>=b.x-14&&p.x<=b.x+b.w+14&&p.y>=b.y-14&&p.y<=b.y+b.h+14;}
  function hitLayer(world){
    for(let i=state.project.layers.length-1;i>=0;i--){const l=state.project.layers[i];if(l.visible===false)continue;const b=getLayerBounds(l);if(pointInBounds(world,b))return l;}
    return null;
  }
  function drawSelection(){
    const l=getSelectedLayer();if(!l||l.locked)return;const b=getLayerBounds(l);if(!b)return;
    ctx.save();ctx.strokeStyle='#d7ff64';ctx.lineWidth=2/state.stageScale;ctx.setLineDash([8/state.stageScale,5/state.stageScale]);ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.setLineDash([]);ctx.fillStyle='#d7ff64';const r=7/state.stageScale;[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();});ctx.restore();
  }

  /* Touch / Pointer: pointer map is authoritative; two-finger gesture never mutates layers. */
  function pointerDown(e){
    if(e.pointerType==='mouse' && e.button!==0)return;
    // Canvas gestures must never steal a tap from overlay controls.
    if(e.target!==els.canvas)return;
    els.canvas.setPointerCapture?.(e.pointerId);state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
    if(state.pointers.size===2){
      if(state.gesture?.type==='single'&&state.gesture.draw?.layer){
        const ephemeral=state.gesture.draw.layer;
        state.project.layers=state.project.layers.filter(l=>l.id!==ephemeral.id);
        state.selectedLayerId=null;
      }
      const [a,b]=[...state.pointers.values()];state.gesture={type:'camera',distance:Math.hypot(a.x-b.x,a.y-b.y),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},zoom:state.camera.zoom,panX:state.camera.panX,panY:state.camera.panY};queueRender();return;
    }
    const w=screenToWorld(e.clientX,e.clientY);state.gesture={type:'single',startWorld:w,lastWorld:w,moved:false,layerId:null,draw:null};
    if(state.sampleMode){state.sampleMode=false;const color=sampleBaseColor(w);if(color){const input=$('[data-bind="maskColor"]');if(input)input.value=color;state._sampleColor=color;openTool('mask');queueRender();notify(`Warna ${color} dipilih`);}return;}
    if(state.tool==='move'){
      const hit=hitLayer(w);
      if(hit && !hit.locked){state.selectedLayerId=hit.id;state.gesture.layerId=hit.id;}
      else if(hit){state.selectedLayerId=hit.id;state.gesture.layerId='__locked__';}
      queueRender();
    } else if(['brush','shape','mask','blur'].includes(state.tool)) startDrawing(w);
    else if(state.tool==='crop') startCrop(w);
  }
  function pointerMove(e){
    const p=state.pointers.get(e.pointerId);if(!p)return;p.x=e.clientX;p.y=e.clientY;
    if(state.pointers.size===2 && state.gesture?.type==='camera'){
      const [a,b]=[...state.pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const factor=distance/Math.max(1,state.gesture.distance);state.camera.zoom=clamp(state.gesture.zoom*factor,.35,5);
      state.camera.panX=state.gesture.panX+(mid.x-state.gesture.mid.x);state.camera.panY=state.gesture.panY+(mid.y-state.gesture.mid.y);queueRender();return;
    }
    if(state.pointers.size!==1)return;
    const g=state.gesture;if(!g||g.type!=='single')return;const w=screenToWorld(e.clientX,e.clientY);g.lastWorld=w;g.moved=(Math.abs(e.clientX-p.startX)+Math.abs(e.clientY-p.startY))>5;
    if(state.tool==='move'){
      const l=g.layerId && g.layerId!=='__locked__'?state.project.layers.find(x=>x.id===g.layerId):null;
      if(l&&!l.locked){const dx=w.x-g.startWorld.x,dy=w.y-g.startWorld.y;l.x+=(g.lastX===undefined?0:dx-(g.prevDx||0));l.y+=(g.lastY===undefined?0:dy-(g.prevDy||0));g.prevDx=(dx||0);g.prevDy=(dy||0);}else if(g.moved){state.camera.panX+=(e.clientX-(g.lastScreenX||e.clientX));state.camera.panY+=(e.clientY-(g.lastScreenY||e.clientY));}
      g.lastScreenX=e.clientX;g.lastScreenY=e.clientY;queueRender();
    }else if(g.draw)continueDrawing(w);
    else if(state.tool==='crop')updateCrop(w);
  }
  function pointerUp(e){
    state.pointers.delete(e.pointerId);els.canvas.releasePointerCapture?.(e.pointerId);
    if(state.pointers.size===0){
      const g=state.gesture;
      if(g?.type==='single' && g.moved){
        if(state.tool==='shape' && g.draw){
          const s=g.draw.start,e=g.draw.current;
          const x=Math.min(s.x,e.x),y=Math.min(s.y,e.y),w=Math.max(2,Math.abs(e.x-s.x)),h=Math.max(2,Math.abs(e.y-s.y));
          const l={id:uid('layer'),type:'shape',name:(state._shape||'rect').toUpperCase(),shape:state._shape||'rect',x,y,w,h,fill:getBindValue('shapeFill','#d7ff64'),stroke:getBindValue('shapeStroke','#d7ff64'),strokeWidth:Number(getBindValue('shapeWidth',3)),fillMode:getBindValue('shapeMode','fill'),radius:12,scale:1,rotation:0,opacity:.55,visible:true,locked:false};
          state.project.layers.push(l);state.selectedLayerId=l.id;
          commit('Draw shape');
        } else if(state.tool==='move')commit('Move / Pan');
        else if(g.draw)commit(g.draw.label);
        else if(state.tool==='crop')markDirty();
      }
      state.gesture=null; state.project.camera=clone(state.camera);queueRender();
    } else if(state.pointers.size===1 && state.gesture?.type==='camera'){const p=[...state.pointers.values()][0];state.gesture={type:'single',startWorld:screenToWorld(p.x,p.y),lastWorld:screenToWorld(p.x,p.y),moved:false,layerId:null};}
  }
  function startDrawing(w){
    const g=state.gesture;
    if(state.tool==='shape'){g.draw={label:'Draw shape',start:{...w},current:{...w}};queueRender();return;}
    if(state.tool==='brush'){
      const l={id:uid('layer'),type:'brush',name:'Brush',points:[{...w}],color:getBindValue('brushColor','#d7ff64'),size:Number(getBindValue('brushSize',18)),opacity:Number(getBindValue('brushOpacity',1)),visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;g.draw={label:'Brush stroke',layer:l};queueRender();return;
    }
    if(state.tool==='mask'){
      const mode=state._maskMode||'brush';const erase=(state._maskAction||'add')==='erase';const color=getBindValue('maskColor','#050608');
      const l={id:uid('layer'),type:'mask',name:erase?'HUD Erase':'HUD Cover',strokes:[],color,opacity:Number(getBindValue('maskOpacity',.82)),size:Number(getBindValue('maskSize',55)),visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;
      const stroke={erase,shape:mode==='rect'?'rect':'brush',color,size:l.size,opacity:1,points:[{...w}]};l.strokes.push(stroke);if(mode==='rect')stroke.x=w.x,stroke.y=w.y,stroke.w=1,stroke.h=1;g.draw={label:'HUD mask',layer:l,stroke};queueRender();return;
    }
    if(state.tool==='blur'){
      const mode=state._blurMode||'brush';const l={id:uid('layer'),type:mode==='pixelate'?'pixelate':'blur',name:mode==='pixelate'?'Pixelate':'Blur',shape:mode==='rect'?'rect':'brush',points:[],x:w.x,y:w.y,w:1,h:1,size:Number(getBindValue('blurSize',75)),intensity:Number(getBindValue('blurIntensity',15)),block:Number(getBindValue('pixelBlock',12)),opacity:1,visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;
      if(mode==='rect'){l.shape='rect';l.x=w.x;l.y=w.y;}else l.points=[{...w}];g.draw={label:mode==='pixelate'?'Pixelate area':'Blur area',layer:l};queueRender();
    }
  }
  function continueDrawing(w){
    const d=state.gesture?.draw;if(!d)return;
    if(state.tool==='shape'){d.current={...w};queueRender();return;}
    if(state.tool==='brush'){d.layer.points.push({...w});queueRender();return;}
    if(state.tool==='mask'){if(d.stroke.shape==='rect'){d.stroke.w=w.x-d.stroke.x;d.stroke.h=w.y-d.stroke.y;}else d.stroke.points.push({...w});queueRender();return;}
    if(state.tool==='blur'){const l=d.layer;if(l.shape==='rect'){l.w=w.x-l.x;l.h=w.y-l.y;}else l.points.push({...w});queueRender();}
  }
  function startCrop(w){
    const x=clamp(w.x,0,state.project.width),y=clamp(w.y,0,state.project.height);state.cropRect={x,y,w:1,h:1};state.gesture.draw={label:'Crop',start:{x,y}};queueRender();
  }
  function updateCrop(w){
    if(!state.cropRect)return;const s=state.gesture.draw.start;const x=clamp(Math.min(s.x,w.x),0,state.project.width),y=clamp(Math.min(s.y,w.y),0,state.project.height);const x2=clamp(Math.max(s.x,w.x),0,state.project.width),y2=clamp(Math.max(s.y,w.y),0,state.project.height);state.cropRect={x,y,w:Math.max(1,x2-x),h:Math.max(1,y2-y)};queueRender();}

  async function applyCrop(){
    const r=state.cropRect;if(!r||r.w<16||r.h<16){notify('Area crop terlalu kecil');return;}
    const full=document.createElement('canvas');await renderTo(full,{exportMode:true,forceSize:[state.project.width,state.project.height],showSelection:false,includeAdjustments:false});
    const crop=document.createElement('canvas');crop.width=Math.round(r.w);crop.height=Math.round(r.h);crop.getContext('2d').drawImage(full,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
    const src=crop.toDataURL('image/png');const aid=uid('asset');state.assets.set(aid,src);
    state.project.width=Math.round(r.w);state.project.height=Math.round(r.h);state.project.layers=[{id:uid('layer'),type:'image',name:'Cropped Screenshot',assetId:aid,x:0,y:0,w:r.w,h:r.h,scale:1,rotation:0,opacity:1,visible:true,locked:true}];
    state.selectedLayerId=null;state.cropRect=null;commit('Apply crop');fitCamera();queueRender();openTool('crop');notify('Crop diterapkan');
  }
  function sampleBaseColor(w){
    const base=getImageLayer();const src=base&&assetSrc(base);const img=src&&state.imageCache.get(src);if(!img || img instanceof Promise)return null;
    const c=document.createElement('canvas');c.width=1;c.height=1;c.getContext('2d').drawImage(img,w.x,w.y,1,1,0,0,1,1);const d=c.getContext('2d').getImageData(0,0,1,1).data;return `#${[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
  }

  function valueFromInput(el){return el.type==='checkbox'?el.checked:(el.type==='number'||el.type==='range'?el.value:el.value);}
  function getBindValue(name,fallback){const el=$(`[data-bind="${name}"]`);return el?valueFromInput(el):fallback;}
  function setFromBind(target,name,value){const el=$(`[data-bind="${name}"]`);if(!el)return;if(el.type==='checkbox')el.checked=!!value;else el.value=value;}

  function invalidateRenderCaches(){
    state.adjustedImageCache.clear();state.adjustedImagePending.clear();
    state.maskCache.clear();state.drawCache.clear();
  }
  function openTool(tool){
    const wasOpen=els.bottomSheet.classList.contains('open');
    const sameTool=state.tool===tool && wasOpen;
    state.tool=tool;
    $$('.dock-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
    $$('.side-quick').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
    const [k,t]=TOOL_META[tool]||['TOOL',tool];
    els.sheetKicker.textContent=k;
    els.sheetTitle.textContent=t;
    // Keep the existing sheet DOM when the same tool is already open.
    // Rebuilding innerHTML here was another source of visible flashing on Android.
    if(!sameTool || !els.sheetContent.childElementCount){
      els.sheetContent.innerHTML=toolMarkup(tool);
    }
    if(!wasOpen){
      els.bottomSheet.classList.add('open');
      els.bottomSheet.setAttribute('aria-hidden','false');
      els.sheetBackdrop.classList.add('show');
    }
    updateCropOverlay();
    queueRender();
  }
  function openSheet(kicker,title,html){els.sheetKicker.textContent=kicker;els.sheetTitle.textContent=title;els.sheetContent.innerHTML=html;els.bottomSheet.classList.add('open');els.bottomSheet.setAttribute('aria-hidden','false');els.sheetBackdrop.classList.add('show');}
  function closeSheet(){els.bottomSheet.classList.remove('open');els.bottomSheet.setAttribute('aria-hidden','true');els.sheetBackdrop.classList.remove('show');state.sampleMode=false;}
  function closeModals(){els.menuModal.setAttribute('aria-hidden','true');els.exportModal.setAttribute('aria-hidden','true');closeSheet();}

  function selectedTransformFields(l){
    if(!l)return `<div class="helper">Pilih layer untuk mengatur posisi, ukuran, rotasi, dan opacity.</div>`;
    const b=getLayerBounds(l)||{x:l.x||0,y:l.y||0,w:l.w||100,h:l.h||50};
    return `<div class="section"><div class="section-title">SELECTED LAYER</div><div class="form-grid two">
      <label>X<input data-bind="tx" type="number" value="${Math.round(l.x||0)}"></label><label>Y<input data-bind="ty" type="number" value="${Math.round(l.y||0)}"></label>
      <label>Scale<input data-bind="ts" type="range" min="0.2" max="4" step="0.01" value="${l.scale||1}"></label><label>Rotation<input data-bind="tr" type="range" min="-180" max="180" step="1" value="${l.rotation||0}"></label>
      <label>Opacity<input data-bind="to" type="range" min="0" max="1" step="0.01" value="${l.opacity??1}"></label>
      ${l.type==='image'||l.type==='shape'?`<label>Width<input data-bind="tw" type="number" min="1" value="${Math.round(b.w/(l.scale||1))}"></label><label>Height<input data-bind="th" type="number" min="1" value="${Math.round(b.h/(l.scale||1))}"></label>`:''}
    </div><div class="button-row" style="margin-top:9px"><button class="secondary" data-action="rotateSelected">+90°</button><button class="ghost" data-action="centerSelected">Center</button><button class="ghost" data-action="duplicateSelected">Duplicate</button></div></div>`;
  }

  function toolMarkup(tool){
    const selected=getSelectedLayer();
    if(tool==='move') return selectedTransformFields(selected)+`<div class="section"><div class="section-title">CANVAS NAVIGATION</div><div class="button-grid"><button class="secondary" data-action="fit">Fit to screen</button><button class="secondary" data-action="resetView">Reset view</button><button class="ghost" data-action="zoomOut">Zoom −</button><button class="ghost" data-action="zoomIn">Zoom +</button></div><div class="helper" style="margin-top:10px">1 jari: pilih + drag layer. Di area kosong: pan. 2 jari: pinch zoom + pan.</div></div>`;
    if(tool==='crop') return `<div class="section"><div class="section-title">CROP PRESETS</div><div class="chip-grid">
      ${['Free','16:9','4:3','1:1','3:4','9:16','Original'].map(v=>`<button class="chip" data-ratio="${v}">${v}</button>`).join('')}
    </div><div class="helper" style="margin-top:9px">Tarik di canvas untuk membuat area crop. Crop akan meratakan komposisi ke screenshot baru agar hasil stabil.</div></div>
    <div class="section"><div class="form-grid two"><label>X<input data-bind="cropX" type="number" value="${Math.round(state.cropRect?.x||0)}"></label><label>Y<input data-bind="cropY" type="number" value="${Math.round(state.cropRect?.y||0)}"></label><label>Width<input data-bind="cropW" type="number" value="${Math.round(state.cropRect?.w||state.project.width)}"></label><label>Height<input data-bind="cropH" type="number" value="${Math.round(state.cropRect?.h||state.project.height)}"></label></div><div class="button-row" style="margin-top:9px"><button class="primary" data-action="applyCrop">Apply Crop</button><button class="ghost" data-action="cancelCrop">Cancel</button></div></div>`;
    if(tool==='brush') return `<div class="section"><div class="section-title">FREEHAND</div><div class="form-grid two"><label>Color<input data-bind="brushColor" type="color" value="#d7ff64"></label><label>Size<input data-bind="brushSize" type="range" min="2" max="120" value="18"></label><label>Opacity<input data-bind="brushOpacity" type="range" min="0.05" max="1" step="0.05" value="1"></label></div><div class="button-row" style="margin-top:9px"><button class="secondary" data-action="addBrushLayer">New Brush Layer</button><button class="ghost" data-action="clearLastLayer">Delete Selected</button></div><div class="helper" style="margin-top:9px">Cocok untuk highlight, outline, coretan, tanda arah, atau sensor manual.</div></div>`;
    if(tool==='shape') return `<div class="section"><div class="section-title">SHAPE TYPE</div><div class="chip-grid">${['rect','ellipse','line','arrow'].map(v=>`<button class="chip ${(state._shape||'rect')===v?'active':''}" data-shape="${v}">${v==='rect'?'Rectangle':v==='ellipse'?'Circle':v==='line'?'Line':'Arrow'}</button>`).join('')}</div><div class="form-grid two" style="margin-top:10px"><label>Fill<input data-bind="shapeFill" type="color" value="#d7ff64"></label><label>Stroke<input data-bind="shapeStroke" type="color" value="#d7ff64"></label><label>Width<input data-bind="shapeWidth" type="range" min="1" max="24" value="3"></label><label>Fill mode<select data-bind="shapeMode"><option value="fill">Fill</option><option value="stroke">Stroke only</option><option value="both">Fill + stroke</option></select></label></div><div class="helper" style="margin-top:9px">Tarik di canvas setelah memilih bentuk. Bentuk dibuat sebagai layer editable.</div></div>`;
    if(tool==='text') return `<div class="section"><div class="section-title">NEW CAPTION</div><label class="control-label">Text</label><textarea data-bind="textValue" placeholder="Contoh: Police Line — Scene 01">${esc(selected?.type==='text'?selected.text:'')}</textarea><div class="form-grid two" style="margin-top:9px"><label>Color<input data-bind="textColor" type="color" value="${selected?.color||'#ffffff'}"></label><label>Size<input data-bind="textSize" type="number" min="8" max="120" value="${selected?.size||26}"></label><label>Font<select data-bind="textFont"><option>Arial</option><option>Helvetica</option><option>system-ui</option><option>monospace</option></select></label><label>Weight<select data-bind="textWeight"><option value="400">Regular</option><option value="600" selected>Semibold</option><option value="800">Bold</option></select></label></div><div class="button-row" style="margin-top:9px"><button class="primary" data-action="addText">+ Add Text</button><button class="secondary" data-action="updateText">Update Selected</button></div></div>`;
    if(tool==='act') return actMarkup();
    if(tool==='chat') return chatMarkup();
    if(tool==='mask') return `<div class="section"><div class="section-title">HUD CLEANER</div><div class="chip-grid"><button class="chip ${(state._maskMode||'brush')==='brush'?'active':''}" data-mask-mode="brush">Brush</button><button class="chip ${(state._maskMode||'brush')==='rect'?'active':''}" data-mask-mode="rect">Rectangle</button></div><div class="chip-grid" style="margin-top:8px"><button class="chip ${(state._maskAction||'add')==='add'?'active':''}" data-mask-action="add">Cover</button><button class="chip ${(state._maskAction||'add')==='erase'?'active':''}" data-mask-action="erase">Erase</button></div><div class="form-grid two" style="margin-top:10px"><label>Cover color<input data-bind="maskColor" type="color" value="#050608"></label><label>Size<input data-bind="maskSize" type="range" min="8" max="220" value="55"></label><label>Opacity<input data-bind="maskOpacity" type="range" min="0.1" max="1" step="0.05" value=".82"></label></div><div class="button-row" style="margin-top:9px"><button class="secondary" data-action="sampleMaskColor">Sample screenshot color</button><button class="ghost" data-action="deleteSelected">Delete selected</button></div><div class="helper" style="margin-top:9px">Cover/erase adalah manual mask. Tidak memakai AI dan tetap aman untuk edit offline.</div></div>`;
    if(tool==='blur') return `<div class="section"><div class="section-title">SELECTIVE EFFECT</div><div class="chip-grid"><button class="chip ${(state._blurMode||'brush')==='brush'?'active':''}" data-blur-mode="brush">Brush Blur</button><button class="chip ${(state._blurMode||'brush')==='rect'?'active':''}" data-blur-mode="rect">Rectangle</button><button class="chip ${(state._blurMode||'brush')==='pixelate'?'active':''}" data-blur-mode="pixelate">Pixelate</button></div><div class="form-grid two" style="margin-top:10px"><label>Size<input data-bind="blurSize" type="range" min="20" max="250" value="75"></label><label>Intensity<input data-bind="blurIntensity" type="range" min="2" max="50" value="15"></label><label>Pixel block<input data-bind="pixelBlock" type="range" min="4" max="35" value="12"></label></div><div class="helper" style="margin-top:9px">Tarik pada HUD, wajah, nomor plat, atau bagian screenshot yang ingin disamarkan.</div></div>`;
    if(tool==='effects') return effectsMarkup();
    if(tool==='layer') return layersMarkup();
    return canvasMarkup();
  }

  function actMarkup(){
    let edit=null;if(state.editingLayerId){const l=state.project.layers.find(x=>x.id===state.editingLayerId);if(l?.type==='chat')edit=l.message;}
    const m=edit||{mode:'me',name:'Ryaz',text:'mengangkat tangannya perlahan',vars:{location:'depan toko',action:'mengangguk'},timestamp:Date.now()};
    const currentMessages=state.project.layers.filter(l=>l.type==='chat');
    return `<div class="section"><div class="section-title">COMMAND</div><div class="chip-grid">${['me','do','ic','whisper','shout','system'].map(v=>`<button class="chip ${m.mode===v?'active':''}" data-act-mode="${v}">${v==='me'?'/me':v==='do'?'/do':v==='ic'?'IC':v==='whisper'?'Whisper':v==='shout'?'Shout':'System'}</button>`).join('')}</div></div>
      <div class="section"><div class="form-grid two"><label>Character name<input data-bind="actName" value="${esc(m.name||'')}"></label><label>Location<input data-bind="actLocation" value="${esc(m.vars?.location||'')}"></label></div><div class="field" style="margin-top:10px"><label>Message</label><textarea data-bind="actText" placeholder="Tulis dialog / action...">${esc(m.text||'')}</textarea></div><div class="form-grid two" style="margin-top:9px"><label>Action <select data-bind="actAction"><option value="">—</option>${Object.entries(ACTIONS).map(([cat,list])=>`<optgroup label="${cat}">${list.map(x=>`<option value="${esc(x)}" ${m.vars?.action===x?'selected':''}>${esc(x)}</option>`).join('')}</optgroup>`).join('')}</select></label><label>Font size<input data-bind="actSize" type="number" min="10" max="52" value="${m.size||state.project.server.fontSize}"></label></div><label class="check" style="margin-top:9px"><input type="checkbox" data-bind="actTimestamp" ${(m.showTimestamp??state.project.server.timestamp)?'checked':''}> Timestamp</label></div>
      <div class="section"><div class="section-title">VARIABLES</div><div class="chip-grid"><button class="chip" data-insert-var="{name}">{name}</button><button class="chip" data-insert-var="{time}">{time}</button><button class="chip" data-insert-var="{location}">{location}</button><button class="chip" data-insert-var="{action}">{action}</button></div><div class="helper" style="margin-top:9px">Variabel otomatis diganti saat render/export.</div></div>
      <div class="section"><div class="section-title">PREVIEW</div><div class="act-preview">${renderChatPreview(m)}</div><div class="button-row" style="margin-top:9px"><button class="primary" data-action="addAct">${edit?'Update ACT':'Add ACT to canvas'}</button><button class="secondary" data-action="copyRaw">Copy raw command</button></div></div>
      <div class="section"><div class="section-title">ACTIVE MESSAGES (${currentMessages.length})</div>${currentMessages.length?currentMessages.map((l,i)=>`<div class="message-row" data-layer-id="${l.id}"><div class="layer-thumb">${i+1}</div><div class="row-main"><strong>${esc(l.message?.name||l.message?.mode||'Message')}</strong><span>${esc((l.message?.text||'').slice(0,70))}</span></div><div class="row-actions"><button class="small-icon" data-action="editMessage">✎</button><button class="small-icon" data-action="duplicateLayer">⧉</button></div></div>`).join(''):'<div class="helper">Belum ada message.</div>'}</div>`;
  }
  function renderChatPreview(m){const temp={...m,time:m.time||formatClock(m.timestamp||Date.now())};const stamp=(temp.showTimestamp??state.project.server.timestamp)?`[${temp.time}] `:'';return `<div style="font-size:${Math.min(22,temp.size||state.project.server.fontSize)}px;color:${messageColor(temp)}">${esc(stamp+chatDisplay(temp))}</div>`;}
  function rawCommand(m){if(m.mode==='me')return `/me ${m.text||''}`;if(m.mode==='do')return `/do ${m.text||''}`;return m.text||'';}

  function chatMarkup(){
    const layers=state.project.layers.filter(l=>l.type==='chat');return `<div class="section"><div class="section-title">MESSAGE STACK</div>${layers.length?layers.map(l=>`<div class="message-row" data-layer-id="${l.id}"><div class="layer-thumb">${l.message?.mode?.toUpperCase().slice(0,3)||'MSG'}</div><div class="row-main"><strong>${esc(l.message?.name||l.message?.mode||'Message')}</strong><span>${esc((l.message?.text||'').slice(0,80))}</span></div><div class="row-actions"><button class="small-icon" data-action="editMessage">✎</button><button class="small-icon" data-action="duplicateLayer">⧉</button><button class="small-icon" data-action="deleteLayer">×</button></div></div>`).join(''):'<div class="helper">ACT Builder bisa menambah message di sini.</div>'}</div>
      <div class="section"><div class="button-grid"><button class="primary" data-action="addAct">+ New ACT</button><button class="secondary" data-action="alignChats">Align chats</button><button class="ghost" data-action="stackChats">Stack 8px</button><button class="ghost" data-action="deleteChats">Delete all chat</button></div></div>`;
  }

  function effectsMarkup(){
    const a=state.project.adjustments||LOOKS['Natural RP'];return `<div class="section"><div class="section-title">STYLE PRESETS</div><div class="chip-grid">${Object.keys(LOOKS).map(k=>`<button class="chip" data-look="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
      <div class="section"><div class="section-title">ADJUSTMENTS</div><div class="form-grid two">${[['brightness','Brightness',-40,40,a.brightness],['contrast','Contrast',-40,40,a.contrast],['saturation','Saturation',-60,60,a.saturation],['warmth','Warmth',-40,40,a.warmth],['vignette','Vignette',0,100,a.vignette],['grain','Grain',0,25,a.grain],['fade','Fade',0,100,a.fade],['blur','Soft blur',0,8,a.blur]].map(([key,label,min,max,val])=>`<label class="control-label">${label}<input data-effect="${key}" type="range" min="${min}" max="${max}" step="1" value="${val}"><span class="helper" id="fxv-${key}">${val}</span></label>`).join('')}</div></div>
      <div class="section"><div class="button-row"><button class="secondary" data-action="resetEffects">Reset Effects</button><button class="primary" data-action="applyLook">Apply Current</button></div></div>`;
  }
  function layersMarkup(){
    const rows=state.project.layers.slice().reverse().map((l)=>`<div class="layer-row ${l.id===state.selectedLayerId?'selected':''}" data-layer-id="${l.id}"><div class="layer-thumb">${l.type==='image'?'IMG':l.type==='chat'?'ACT':l.type==='text'?'T':l.type==='shape'?'◇':l.type==='mask'?'HUD':l.type==='blur'?'BLR':l.type==='pixelate'?'PX':'✦'}</div><div class="row-main"><strong>${esc(l.name||l.type)}</strong><span>${l.type} · ${Math.round((l.opacity??1)*100)}%</span></div><div class="row-actions"><button class="small-icon" data-action="toggleLayer">${l.visible===false?'○':'◉'}</button><button class="small-icon" data-action="toggleLock">${l.locked?'🔒':'🔓'}</button><button class="small-icon" data-action="duplicateLayer">⧉</button><button class="small-icon" data-action="deleteLayer">×</button></div></div>`).join('');
    return `<div class="section"><div class="section-title">LAYER STACK · ${state.project.layers.length}</div>${rows||'<div class="helper">Belum ada layer. Import screenshot atau tambah ACT/Text/Shape.</div>'}</div><div class="section"><div class="button-grid"><button class="primary" data-action="addAct">+ ACT</button><button class="secondary" data-action="addText">+ Text</button><button class="secondary" data-action="addShape">+ Shape</button><button class="ghost" data-action="addImageLayer">+ Image</button><button class="ghost" data-action="layerUp">Move up</button><button class="ghost" data-action="layerDown">Move down</button><button class="secondary" data-action="addWatermark">Watermark</button></div></div>${selectedTransformFields(getSelectedLayer())}`;
  }
  function canvasMarkup(){return `<div class="section"><div class="section-title">CANVAS</div><div class="form-grid two"><label>Width<input data-bind="canvasW" type="number" min="320" max="8192" value="${state.project.width}"></label><label>Height<input data-bind="canvasH" type="number" min="240" max="8192" value="${state.project.height}"></label></div><div class="button-row" style="margin-top:9px"><button class="primary" data-action="resizeCanvas">Resize</button><button class="secondary" data-action="rotateCanvas">Rotate 90°</button></div></div><div class="section"><div class="section-title">GUIDES</div><label class="check"><input type="checkbox" data-guide="center" ${state.project.guides.center?'checked':''}> Center guides</label><label class="check" style="margin-top:7px"><input type="checkbox" data-guide="safe" ${state.project.guides.safe?'checked':''}> Safe area</label><label class="check" style="margin-top:7px"><input type="checkbox" data-guide="grid" ${state.project.guides.grid?'checked':''}> Grid</label></div><div class="section"><div class="button-row"><button class="secondary" data-action="importImage">Import Screenshot</button><button class="secondary" data-action="addImageLayer">Add Image Layer</button></div></div>`;}

  function addAct(){
    const mode=state._draftAct?.mode||'me';const name=getBindValue('actName','Character');const text=getBindValue('actText','');
    const msg={id:uid('msg'),mode,name,text,vars:{location:getBindValue('actLocation',''),action:getBindValue('actAction','')},timestamp:Date.now(),time:formatClock(Date.now()),size:Number(getBindValue('actSize',state.project.server.fontSize)),color:null,showTimestamp:getBindValue('actTimestamp',state.project.server.timestamp)};
    const x=Number.isFinite(state._nextChatY)?state._nextChatY:Math.max(24,state.project.height-90);
    const layer={id:uid('layer'),type:'chat',name:`${mode.toUpperCase()} · ${name||'Message'}`,message:msg,x:32,y:Math.max(20,x),width:Math.min(650,state.project.width-64),height:72,size:msg.size,scale:1,rotation:0,opacity:1,visible:true,locked:false};
    state.project.layers.push(layer);state.selectedLayerId=layer.id;state.editingLayerId=null;state._nextChatY=Math.max(20,x-80);commit('Add ACT message');renderActOnly();queueRender();notify('ACT message ditambahkan');
  }
  function updateAct(){
    const l=state.editingLayerId?state.project.layers.find(x=>x.id===state.editingLayerId):getSelectedLayer();if(!l||l.type!=='chat'){addAct();return;}
    l.message={...(l.message||{}),mode:state._draftAct?.mode||l.message.mode,name:getBindValue('actName',l.message.name||''),text:getBindValue('actText',l.message.text||''),vars:{location:getBindValue('actLocation',l.message.vars?.location||''),action:getBindValue('actAction',l.message.vars?.action||'')},timestamp:l.message.timestamp||Date.now(),time:l.message.time||formatClock(l.message.timestamp),size:Number(getBindValue('actSize',l.message.size||state.project.server.fontSize))};l.size=l.message.size;l.name=`${l.message.mode.toUpperCase()} · ${l.message.name||'Message'}`;state.editingLayerId=null;commit('Update ACT');renderActOnly();queueRender();notify('ACT message diperbarui');
  }

  function addText(){
    const text=getBindValue('textValue','Text Layer');const l={id:uid('layer'),type:'text',name:'Caption',text:text||'Text Layer',x:state.project.width*.1,y:state.project.height*.12,width:state.project.width*.7,height:100,size:Number(getBindValue('textSize',26)),font:getBindValue('textFont','Arial'),weight:Number(getBindValue('textWeight',600)),color:getBindValue('textColor','#ffffff'),lineHeight:1.2,align:'left',shadow:true,scale:1,rotation:0,opacity:1,visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;commit('Add text');queueRender();notify('Text layer ditambahkan');
  }
  function updateText(){const l=getSelectedLayer();if(!l||l.type!=='text'){notify('Pilih text layer dulu');return;}l.text=getBindValue('textValue',l.text);l.size=Number(getBindValue('textSize',l.size));l.font=getBindValue('textFont',l.font);l.weight=Number(getBindValue('textWeight',l.weight));l.color=getBindValue('textColor',l.color);commit('Update text');notify('Text diperbarui');}
  function addShape(){const l={id:uid('layer'),type:'shape',name:'Rectangle',shape:'rect',x:state.project.width*.12,y:state.project.height*.2,w:260,h:110,fill:getBindValue('shapeFill','#d7ff64'),stroke:getBindValue('shapeStroke','#d7ff64'),strokeWidth:Number(getBindValue('shapeWidth',3)),fillMode:getBindValue('shapeMode','fill'),radius:12,scale:1,rotation:0,opacity:.55,visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;commit('Add shape');queueRender();notify('Shape layer ditambahkan');}
  function addBrushLayer(){const l={id:uid('layer'),type:'brush',name:'Brush',points:[],color:getBindValue('brushColor','#d7ff64'),size:Number(getBindValue('brushSize',18)),opacity:Number(getBindValue('brushOpacity',1)),visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;commit('New brush layer');notify('Brush layer siap');}

  function duplicateLayer(l){if(!l)return;const d=clone(l);d.id=uid('layer');d.name=`${l.name||l.type} copy`;d.x=(l.x||0)+18;d.y=(l.y||0)+18;if(d.type==='chat')d.message.id=uid('msg');state.project.layers.push(d);state.selectedLayerId=d.id;commit('Duplicate layer');openTool('layer');}
  function deleteLayer(l){if(!l)return;const idx=state.project.layers.findIndex(x=>x.id===l.id);if(idx<0)return;state.project.layers.splice(idx,1);state.selectedLayerId=state.project.layers[Math.max(0,idx-1)]?.id||null;commit('Delete layer');openTool('layer');notify('Layer dihapus');}
  function toggleLayer(l){if(!l)return;l.visible=l.visible===false;commit('Toggle visibility');openTool('layer');}
  function toggleLock(l){if(!l)return;l.locked=!l.locked;commit(l.locked?'Lock layer':'Unlock layer');openTool('layer');}
  function moveLayer(dir){const l=getSelectedLayer();if(!l)return;const i=state.project.layers.indexOf(l);const j=dir<0?i-1:i+1;if(j<0||j>=state.project.layers.length)return;[state.project.layers[i],state.project.layers[j]]=[state.project.layers[j],state.project.layers[i]];commit(dir<0?'Layer down':'Layer up');openTool('layer');}
  function updateTransformFromSheet(){const l=getSelectedLayer();if(!l)return;const x=Number(getBindValue('tx',l.x||0));const y=Number(getBindValue('ty',l.y||0));l.x=x;l.y=y;l.scale=clamp(Number(getBindValue('ts',l.scale||1)),.2,4);l.rotation=Number(getBindValue('tr',l.rotation||0));l.opacity=clamp(Number(getBindValue('to',l.opacity??1)),0,1);if(l.w!=null)l.w=Math.max(1,Number(getBindValue('tw',l.w)));if(l.h!=null)l.h=Math.max(1,Number(getBindValue('th',l.h)));queueRender();}

  function updateGuides(){const g=state.project.guides;els.canvas.parentElement.querySelector('.guides-layer').style.display=(g.center||g.safe||g.grid)?'block':'none';$('.center-v').style.display=g.center?'block':'none';$('.center-h').style.display=g.center?'block':'none';$('.safe-box').style.display=g.safe?'block':'none';$('.grid').style.display=g.grid?'block':'none';}
  function updateCropOverlay(){const overlay=$('#cropOverlay');if(state.tool!=='crop'||!state.cropRect){overlay.style.display='none';return;}overlay.style.display='block';const a=worldToScreen(state.cropRect.x,state.cropRect.y);const b=worldToScreen(state.cropRect.x+state.cropRect.w,state.cropRect.y+state.cropRect.h);const fr=els.frame.getBoundingClientRect();const box=$('#cropBox');box.style.left=`${a.x-fr.left}px`;box.style.top=`${a.y-fr.top}px`;box.style.width=`${Math.max(4,b.x-a.x)}px`;box.style.height=`${Math.max(4,b.y-a.y)}px`;}

  function adjustRatio(ratio){
    if(ratio==='Free'){state.cropRect=null;return queueRender();}
    if(ratio==='Original'){state.cropRect={x:0,y:0,w:state.project.width,h:state.project.height};queueRender();return;}
    const [rw,rh]=ratio.split(':').map(Number);const target=rw/rh;let w=state.project.width,h=w/target;if(h>state.project.height){h=state.project.height;w=h*target;}state.cropRect={x:(state.project.width-w)/2,y:(state.project.height-h)/2,w,h};queueRender();
  }
  function centerSelected(){const l=getSelectedLayer();if(!l)return;const b=getLayerBounds(l);if(!b)return;l.x=(state.project.width-(b.w/(l.scale||1)))/2;l.y=(state.project.height-(b.h/(l.scale||1)))/2;commit('Center layer');openTool('move');}
  function resizeCanvas(){const w=Math.round(clamp(Number(getBindValue('canvasW',state.project.width)),320,8192)),h=Math.round(clamp(Number(getBindValue('canvasH',state.project.height)),240,8192));if(w===state.project.width&&h===state.project.height){notify('Ukuran sama');return;}const sx=w/state.project.width,sy=h/state.project.height;for(const l of state.project.layers){l.x=(l.x||0)*sx;l.y=(l.y||0)*sy;if(l.w!=null)l.w*=sx;if(l.h!=null)l.h*=sy;if(l.points)l.points=l.points.map(p=>({x:p.x*sx,y:p.y*sy}));if(l.strokes)l.strokes.forEach(s=>{if(s.x!=null)s.x*=sx;if(s.y!=null)s.y*=sy;if(s.w!=null)s.w*=sx;if(s.h!=null)s.h*=sy;if(s.points)s.points=s.points.map(p=>({x:p.x*sx,y:p.y*sy}));});}state.project.width=w;state.project.height=h;commit('Resize canvas');fitCamera();openTool('canvas');notify(`Canvas ${w}×${h}`);}
  function rotateCanvas(){
    const oldW=state.project.width;state.project.width=state.project.height;state.project.height=oldW;for(const l of state.project.layers){const oldX=l.x||0,oldY=l.y||0;l.x=state.project.width-(oldY+(l.h||0));l.y=oldX;const oldW2=l.w;l.w=l.h;l.h=oldW2;if(l.rotation!=null)l.rotation=(l.rotation||0)+90;if(l.points)l.points=l.points.map(p=>({x:state.project.width-p.y,y:p.x}));}commit('Rotate canvas');fitCamera();openTool('canvas');}
  function addWatermark(){const l={id:uid('layer'),type:'watermark',name:'SSRP Forge Watermark',text:'SSRP FORGE',x:state.project.width-250,y:state.project.height-55,width:210,height:35,size:15,font:'Arial',weight:800,color:'#ffffff',opacity:.35,shadow:true,scale:1,rotation:0,visible:true,locked:false};state.project.layers.push(l);state.selectedLayerId=l.id;commit('Add watermark');notify('Watermark ditambahkan');}

  function setProjectName(){const n=els.projectName.value.trim()||'Untitled Project';if(n!==state.project.name){state.project.name=n;commit('Rename project');}}
  function applyLook(name){state.project.adjustments=clone(LOOKS[name]||LOOKS['Natural RP']);commit(`Apply ${name}`);openTool('effects');notify(`${name} diterapkan`);}
  function resetEffects(){state.project.adjustments=clone(LOOKS['Natural RP']);commit('Reset effects');openTool('effects');}
  function applyCurrentEffects(){commit('Update effects');notify('Effects diterapkan');}
  async function deleteProject(id){const ok=window.confirm('Hapus project tersimpan ini?');if(!ok)return;await idbDelete(id);openProjects();notify('Project dihapus');}
  function openShortcuts(){openSheet('HELP','Shortcuts & Gesture',`<div class="section"><div class="section-title">TOUCH</div><div class="helper">1 jari drag = move layer. Tarik pada Brush/Shape/HUD Cleaner/Blur/Crop = menggambar tool. 2 jari = pinch zoom + pan canvas. Double tap text/chat = buka editor.</div></div><div class="section"><div class="section-title">KEYBOARD</div><div class="helper">Ctrl/Cmd + Z = Undo · Ctrl/Cmd + Y atau Shift + Cmd/Ctrl + Z = Redo · Delete/Backspace = hapus layer terpilih · Space + drag = pan.</div></div><div class="section"><div class="button-row"><button class="primary" data-action="closeSheet">Got it</button></div></div>`);}
  function openPresets(){
    const key='ssrp-forge-presets';let presets=[];try{presets=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
    openSheet('SERVER PRESETS','Chat Style',`<div class="section"><div class="section-title">CURRENT SERVER STYLE</div><div class="form-grid two"><label>Name<input data-bind="srvName" value="${esc(state.project.server.name)}"></label><label>Font<select data-bind="srvFont"><option>Arial</option><option>Helvetica</option><option>system-ui</option><option>monospace</option></select></label><label>/me<input data-bind="srvMe" type="color" value="${state.project.server.meColor}"></label><label>/do<input data-bind="srvDo" type="color" value="${state.project.server.doColor}"></label><label>IC<input data-bind="srvIc" type="color" value="${state.project.server.icColor}"></label><label>Whisper<input data-bind="srvWhisper" type="color" value="${state.project.server.whisperColor}"></label></div><div class="form-grid two" style="margin-top:9px"><label>Font size<input data-bind="srvSize" type="number" min="10" max="48" value="${state.project.server.fontSize}"></label><label>Panel<select data-bind="srvPanel"><option value="semi" ${state.project.server.panel==='semi'?'selected':''}>Semi</option><option value="dark" ${state.project.server.panel==='dark'?'selected':''}>Dark</option><option value="box" ${state.project.server.panel==='box'?'selected':''}>Box</option><option value="none" ${state.project.server.panel==='none'?'selected':''}>None</option></select></label><label>Panel opacity<input data-bind="srvOpacity" type="range" min="0" max="1" step=".05" value="${state.project.server.panelOpacity}"></label><label>Radius<input data-bind="srvRadius" type="number" min="0" max="28" value="${state.project.server.radius}"></label><label>Timestamp<select data-bind="srvTimeFormat"><option value="HH:MM:SS" ${state.project.server.timestampFormat==='HH:MM:SS'?'selected':''}>HH:MM:SS</option><option value="HH:MM" ${state.project.server.timestampFormat==='HH:MM'?'selected':''}>HH:MM</option></select></label><label>Name format<select data-bind="srvNameFormat"><option value="name_message" ${state.project.server.nameFormat==='name_message'?'selected':''}>Name: Message</option><option value="bracket" ${state.project.server.nameFormat==='bracket'?'selected':''}>[Name]</option><option value="name_only" ${state.project.server.nameFormat==='name_only'?'selected':''}>Name only</option></select></label></div><div class="button-row" style="margin-top:9px"><button class="primary" data-action="saveServerStyle">Save style</button><button class="secondary" data-action="exportServerStyle">Export JSON</button></div></div><div class="section"><div class="section-title">LOCAL PRESETS</div>${presets.length?presets.map((p,i)=>`<div class="project-row" data-preset-index="${i}"><div class="row-main"><strong>${esc(p.name)}</strong><span>${esc(p.font)} · ${p.fontSize}px · ${p.meColor}</span></div><div class="row-actions"><button class="small-icon" data-action="usePreset">Use</button><button class="small-icon" data-action="duplicatePreset">⧉</button><button class="small-icon" data-action="deletePreset">×</button></div></div>`).join(''):'<div class="helper">Belum ada preset tersimpan.</div>'}<button class="secondary" style="margin-top:9px;width:100%" data-action="saveCurrentPreset">+ Save current as preset</button></div>`);
  }

  async function exportBlob(){
    const max=els.exportResolution.value==='original'?Infinity:Number(els.exportResolution.value);const scale=Math.min(1,max/Math.max(state.project.width,state.project.height));const w=Math.max(1,Math.round(state.project.width*scale)),h=Math.max(1,Math.round(state.project.height*scale));
    const c=document.createElement('canvas');await renderTo(c,{exportMode:true,forceSize:[w,h],showSelection:false});let type=els.exportFormat.value==='jpeg'?'image/jpeg':els.exportFormat.value==='webp'&&supportsWebp?'image/webp':'image/png';const quality=Number(els.exportQuality.value);const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('toBlob failed')),type,quality));return {blob,w,h,type};
  }
  function openExport(){els.exportMeta.textContent=`${state.project.width}×${state.project.height} · ${state.project.layers.length} layers · ${state.project.layers.filter(l=>l.type==='chat').length} ACT`;if(!supportsWebp)els.exportFormat.querySelector('option[value="webp"]').disabled=true;els.exportModal.setAttribute('aria-hidden','false');}
  async function performExport(mode='download'){
    try{
      const r=await exportBlob();const ext=r.type==='image/jpeg'?'jpg':r.type==='image/webp'?'webp':'png';const name=(state.project.name||'ssrp-forge').replace(/[^\w-]+/g,'_')+'.'+ext;const file=new File([r.blob],name,{type:r.type});
      if(mode==='share'&&navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'SSRP Forge Export'});notify('Export dibagikan');}
      else if(mode==='open'){const url=URL.createObjectURL(r.blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),30000);notify('Preview dibuka');}
      else{const url=URL.createObjectURL(r.blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notify(`Export ${r.w}×${r.h} selesai`);}
      els.exportModal.setAttribute('aria-hidden','true');
    }catch(error){console.error(error);notify('Export gagal pada browser ini');}
  }
  function downloadText(filename,text,type='application/json'){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportProject(){downloadText(`${(state.project.name||'project').replace(/[^\w-]+/g,'_')}.ssrp`,serialize(true));notify('Backup .ssrp dibuat');}
  async function importProject(file){try{const text=await file.text();const data=JSON.parse(text);if(!data.layers||!data.width||!data.height)throw new Error('Invalid project');state.assets=new Map(Object.entries(data.assets||{}));delete data.assets;delete data.thumb;state.project=data;state.project.server={...DEFAULT_SERVER,...(data.server||{})};state.project.adjustments={...LOOKS['Natural RP'],...(data.adjustments||{})};state.camera={zoom:1,panX:0,panY:0,...(data.camera||{})};hydrateRuntimeLayers();state.selectedLayerId=null;initHistory();closeModals();fitCamera();queueRender();updateUI();notify('Project .ssrp berhasil diimport');}catch(error){console.error(error);notify('File .ssrp tidak valid');}}

  function addImageLayerFromInput(){els.imageInput.dataset.asLayer='true';els.imageInput.click();}
  function toggleFullscreen(){if(!document.fullscreenElement)els.app.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});}

  function handleAction(action,origin){
    const layer=origin?.closest?.('[data-layer-id]') ? state.project.layers.find(l=>l.id===origin.closest('[data-layer-id]').dataset.layerId):getSelectedLayer();
    switch(action){
      case'importImage':els.imageInput.dataset.asLayer='false';els.imageInput.click();break;
      case'addImageLayer':addImageLayerFromInput();break;
      case'newProject':newProject();break;
      case'openProjects':openProjects();break;
      case'saveProject':saveProject(false);break;
      case'exportProject':exportProject();break;
      case'importProject':els.projectInput.click();break;
      case'openPresets':openPresets();break;
      case'openShortcuts':openShortcuts();break;
      case'clearProject':state.project.layers=[];state.selectedLayerId=null;commit('Clear layers');queueRender();notify('Semua layer dihapus');break;
      case'addAct':if(state.editingLayerId)updateAct();else addAct();break;
      case'copyRaw':copyCurrentRaw();break;
      case'addText':addText();break;
      case'updateText':updateText();break;
      case'addShape':addShape();break;
      case'addBrushLayer':addBrushLayer();break;
      case'addWatermark':addWatermark();break;
      case'deleteSelected':deleteLayer(getSelectedLayer());break;
      case'clearLastLayer':deleteLayer(getSelectedLayer());break;
      case'duplicateSelected':duplicateLayer(getSelectedLayer());break;
      case'duplicateLayer':duplicateLayer(layer);break;
      case'deleteLayer':deleteLayer(layer);break;
      case'toggleLayer':toggleLayer(layer);break;
      case'toggleLock':toggleLock(layer);break;
      case'layerUp':moveLayer(1);break;
      case'layerDown':moveLayer(-1);break;
      case'fit':fitCamera();break;
      case'resetView':fitCamera();break;
      case'zoomIn':zoomCamera(1.18,els.frame.getBoundingClientRect().left+els.frame.clientWidth/2,els.frame.getBoundingClientRect().top+els.frame.clientHeight/2);break;
      case'zoomOut':zoomCamera(.85,els.frame.getBoundingClientRect().left+els.frame.clientWidth/2,els.frame.getBoundingClientRect().top+els.frame.clientHeight/2);break;
      case'rotateSelected':if(layer){layer.rotation=(layer.rotation||0)+90;commit('Rotate layer');openTool('move');}break;
      case'centerSelected':centerSelected();break;
      case'applyCrop':applyCrop();break;
      case'cancelCrop':state.cropRect=null;queueRender();break;
      case'sampleMaskColor':state.sampleMode=true;closeSheet();notify('Tap screenshot untuk mengambil warna');break;
      case'resetEffects':resetEffects();break;
      case'applyLook':applyCurrentEffects();break;
      case'resizeCanvas':resizeCanvas();break;
      case'rotateCanvas':rotateCanvas();break;
      case'fullscreen':toggleFullscreen();break;
      case'closeSheet':closeSheet();break;
      case'alignChats':alignChats();break;
      case'stackChats':stackChats();break;
      case'deleteChats':deleteChats();break;
      case'editMessage':editMessage(layer);break;
      case'saveServerStyle':saveServerStyle(false);break;
      case'saveCurrentPreset':saveServerStyle(true);break;
      case'exportServerStyle':downloadText('server-style.json',JSON.stringify(state.project.server,null,2));break;
      case'usePreset':usePreset(origin.closest('[data-preset-index]'));break;
      case'duplicatePreset':duplicatePreset(origin.closest('[data-preset-index]'));break;
      case'deletePreset':deletePreset(origin.closest('[data-preset-index]'));break;
      case'loadProject':loadProject(origin.closest('[data-project-id]').dataset.projectId);break;
      case'deleteProject':deleteProject(origin.closest('[data-project-id]').dataset.projectId);break;
    }
  }
  async function copyCurrentRaw(){
    let l=state.editingLayerId?state.project.layers.find(x=>x.id===state.editingLayerId):getSelectedLayer();if(!l||l.type!=='chat')l=state.project.layers.slice().reverse().find(x=>x.type==='chat');if(!l){notify('Belum ada ACT');return;}
    const raw=rawCommand(l.message);try{await navigator.clipboard.writeText(raw);notify('Raw command disalin');}catch{notify(raw);}
  }
  function editMessage(l){if(!l)return;state.selectedLayerId=l.id;state.editingLayerId=l.id;openTool('act');}
  function alignChats(){const chats=state.project.layers.filter(l=>l.type==='chat');if(!chats.length)return;chats.forEach((l,i)=>l.x=32);commit('Align chats');openTool('chat');}
  function stackChats(){const chats=state.project.layers.filter(l=>l.type==='chat');const start=Math.max(22,state.project.height-chats.length*76-22);chats.forEach((l,i)=>l.y=start+i*76);commit('Stack chats');openTool('chat');}
  function deleteChats(){state.project.layers=state.project.layers.filter(l=>l.type!=='chat');state.selectedLayerId=null;commit('Delete chat layers');openTool('chat');}

  function saveServerStyle(asPreset){
    state.project.server={...state.project.server,name:getBindValue('srvName',state.project.server.name),font:getBindValue('srvFont',state.project.server.font),meColor:getBindValue('srvMe',state.project.server.meColor),doColor:getBindValue('srvDo',state.project.server.doColor),icColor:getBindValue('srvIc',state.project.server.icColor),whisperColor:getBindValue('srvWhisper',state.project.server.whisperColor),fontSize:Number(getBindValue('srvSize',state.project.server.fontSize)),panel:getBindValue('srvPanel',state.project.server.panel),panelOpacity:Number(getBindValue('srvOpacity',state.project.server.panelOpacity)),radius:Number(getBindValue('srvRadius',state.project.server.radius)),timestampFormat:getBindValue('srvTimeFormat',state.project.server.timestampFormat),nameFormat:getBindValue('srvNameFormat',state.project.server.nameFormat)};commit('Update server style');
    if(asPreset){let arr=[];try{arr=JSON.parse(localStorage.getItem('ssrp-forge-presets')||'[]')}catch{}const p=clone(state.project.server);p.name=p.name||'Custom';arr.push(p);localStorage.setItem('ssrp-forge-presets',JSON.stringify(arr));notify('Preset server disimpan');}else notify('Server style diperbarui');openPresets();
  }
  function presets(){try{return JSON.parse(localStorage.getItem('ssrp-forge-presets')||'[]')}catch{return[]}}
  function savePresetArray(arr){localStorage.setItem('ssrp-forge-presets',JSON.stringify(arr));}
  function usePreset(row){const arr=presets();const p=arr[Number(row?.dataset.presetIndex)];if(!p)return;state.project.server={...DEFAULT_SERVER,...clone(p)};commit('Use server preset');openPresets();notify('Server preset digunakan');}
  function duplicatePreset(row){const arr=presets();const p=arr[Number(row?.dataset.presetIndex)];if(!p)return;const d=clone(p);d.name=`${d.name||'Preset'} copy`;arr.push(d);savePresetArray(arr);openPresets();}
  function deletePreset(row){const arr=presets();arr.splice(Number(row?.dataset.presetIndex),1);savePresetArray(arr);openPresets();notify('Preset dihapus');}

  function updateGuideInputs(){
    $$('#sheetContent [data-guide]').forEach(el=>el.addEventListener('change',()=>{state.project.guides[el.dataset.guide]=el.checked;commit(`Guide ${el.dataset.guide}`);queueRender();}));
  }
  function bindSheetEvents(){
    // Delegation: one listener, no duplicate bindings after every sheet open.
    els.sheetContent.onclick=e=>{
      const ratio=e.target.closest('[data-ratio]');if(ratio){adjustRatio(ratio.dataset.ratio);return;}
      const shape=e.target.closest('[data-shape]');if(shape){$$('[data-shape]',els.sheetContent).forEach(x=>x.classList.remove('active'));shape.classList.add('active');state._shape=shape.dataset.shape;return;}
      const maskMode=e.target.closest('[data-mask-mode]');if(maskMode){$$('[data-mask-mode]',els.sheetContent).forEach(x=>x.classList.remove('active'));maskMode.classList.add('active');state._maskMode=maskMode.dataset.maskMode;return;}
      const maskAction=e.target.closest('[data-mask-action]');if(maskAction){$$('[data-mask-action]',els.sheetContent).forEach(x=>x.classList.remove('active'));maskAction.classList.add('active');state._maskAction=maskAction.dataset.maskAction;return;}
      const blurMode=e.target.closest('[data-blur-mode]');if(blurMode){$$('[data-blur-mode]',els.sheetContent).forEach(x=>x.classList.remove('active'));blurMode.classList.add('active');state._blurMode=blurMode.dataset.blurMode;return;}
      const actMode=e.target.closest('[data-act-mode]');if(actMode){state._draftAct={...(state._draftAct||{}),mode:actMode.dataset.actMode};$$('[data-act-mode]',els.sheetContent).forEach(x=>x.classList.remove('active'));actMode.classList.add('active');renderActOnly();return;}
      const variable=e.target.closest('[data-insert-var]');if(variable){const ta=$('[data-bind="actText"]',els.sheetContent);if(ta){const a=ta.selectionStart||ta.value.length;ta.value=ta.value.slice(0,a)+variable.dataset.insertVar+ta.value.slice(a);ta.dispatchEvent(new Event('input',{bubbles:true}));}return;}
      const look=e.target.closest('[data-look]');if(look){applyLook(look.dataset.look);return;}
      const act=e.target.closest('[data-action]');if(act){e.stopPropagation();handleAction(act.dataset.action,act);}
      const layerRow=e.target.closest('[data-layer-id]');if(layerRow&&!e.target.closest('button')){state.selectedLayerId=layerRow.dataset.layerId;queueRender();openTool(state.tool==='layer'?'layer':'move');}
    };
    els.sheetContent.addEventListener('input',onSheetInput);
    els.sheetContent.addEventListener('change',onSheetChange);
  }
  function onSheetInput(e){
    const el=e.target;
    if(el.matches('[data-effect]')){state.project.adjustments[el.dataset.effect]=Number(el.value);invalidateRenderCaches();const lab=$(`#fxv-${el.dataset.effect}`);if(lab)lab.textContent=el.value;queueRender();markDirty();return;}
    if(el.matches('[data-bind="actName"],[data-bind="actText"],[data-bind="actLocation"],[data-bind="actAction"],[data-bind="actSize"],[data-bind="actTimestamp"]')){renderActOnly();return;}
    if(el.matches('[data-bind="tx"],[data-bind="ty"],[data-bind="ts"],[data-bind="tr"],[data-bind="to"],[data-bind="tw"],[data-bind="th"]')){updateTransformFromSheet();return;}
    if(el.matches('[data-bind="cropX"],[data-bind="cropY"],[data-bind="cropW"],[data-bind="cropH"]')){state.cropRect={x:Number(getBindValue('cropX',0)),y:Number(getBindValue('cropY',0)),w:Number(getBindValue('cropW',state.project.width)),h:Number(getBindValue('cropH',state.project.height))};queueRender();return;}
  }
  function onSheetChange(e){
    const el=e.target;if(el.matches('[data-effect]')){invalidateRenderCaches();commit(`Effect ${el.dataset.effect}`);}else if(el.matches('[data-bind="tx"],[data-bind="ty"],[data-bind="ts"],[data-bind="tr"],[data-bind="to"],[data-bind="tw"],[data-bind="th"]'))commit('Transform');else if(el.matches('[data-bind]')){if(el.dataset.bind.startsWith('act')){state._draftAct={...(state._draftAct||{}),mode:state._draftAct?.mode||'me'};}markDirty();}
  }
  function renderActOnly(){
    const preview=$('.act-preview',els.sheetContent);if(!preview)return;const old=state._draftAct?.mode;const m={mode:old||$('.chip.active[data-act-mode]',els.sheetContent)?.dataset.actMode||'me',name:getBindValue('actName','Character'),text:getBindValue('actText',''),vars:{location:getBindValue('actLocation',''),action:getBindValue('actAction','')},timestamp:Date.now(),time:formatClock(Date.now()),size:Number(getBindValue('actSize',state.project.server.fontSize))};preview.innerHTML=renderChatPreview(m);}

  function bindGlobalEvents(){
    $$('.dock-btn').forEach(b=>b.addEventListener('click',()=>openTool(b.dataset.tool)));
    $$('.side-quick').forEach(b=>b.addEventListener('click',()=>openTool(b.dataset.tool)));
    $('#quickbar').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)handleAction(b.dataset.action,b);});
    // Empty-canvas import is intentionally delegated outside the canvas pointer handler.
    // The whole prompt (including the large + button) is tappable on Android.
    els.empty.addEventListener('click',e=>{const b=e.target.closest('[data-action]');handleAction(b?.dataset.action||'importImage',b||els.empty);});
    els.empty.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handleAction('importImage',els.empty);}});
    els.projectName.addEventListener('change',setProjectName);els.projectName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.currentTarget.blur();}});
    els.undo.addEventListener('click',undo);els.redo.addEventListener('click',redo);els.save.addEventListener('click',()=>saveProject(false));els.export.addEventListener('click',openExport);els.menu.addEventListener('click',()=>els.menuModal.setAttribute('aria-hidden','false'));els.menuClose.addEventListener('click',()=>els.menuModal.setAttribute('aria-hidden','true'));els.exportClose.addEventListener('click',()=>els.exportModal.setAttribute('aria-hidden','true'));els.sheetClose.addEventListener('click',closeSheet);els.sheetBackdrop.addEventListener('click',closeSheet);
    els.fit.addEventListener('click',fitCamera);els.zoomIn.addEventListener('click',()=>zoomCamera(1.18,els.frame.getBoundingClientRect().left+els.frame.clientWidth/2,els.frame.getBoundingClientRect().top+els.frame.clientHeight/2));els.zoomOut.addEventListener('click',()=>zoomCamera(.85,els.frame.getBoundingClientRect().left+els.frame.clientWidth/2,els.frame.getBoundingClientRect().top+els.frame.clientHeight/2));els.rotate.addEventListener('click',()=>{const l=getSelectedLayer();if(l&&!l.locked){l.rotation=(l.rotation||0)+90;commit('Rotate layer');queueRender();}else rotateCanvas();});els.fullscreen.addEventListener('click',toggleFullscreen);els.guides.addEventListener('click',()=>{state.project.guides.center=!state.project.guides.center;commit('Toggle guides');queueRender();});els.grid.addEventListener('click',()=>{state.project.guides.grid=!state.project.guides.grid;commit('Toggle grid');queueRender();});
    [els.canvas].forEach(c=>{c.addEventListener('pointerdown',pointerDown,{passive:false});c.addEventListener('pointermove',pointerMove,{passive:false});c.addEventListener('pointerup',pointerUp,{passive:false});c.addEventListener('pointercancel',pointerUp,{passive:false});});
    els.canvas.addEventListener('wheel',e=>{e.preventDefault();zoomCamera(e.deltaY<0?1.1:.91,e.clientX,e.clientY);},{passive:false});
    els.canvas.addEventListener('dblclick',e=>{const hit=hitLayer(screenToWorld(e.clientX,e.clientY));if(hit){state.selectedLayerId=hit.id;if(hit.type==='chat'){state.editingLayerId=hit.id;openTool('act');}else if(hit.type==='text')openTool('text');}});
    els.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    els.imageInput.addEventListener('change',async e=>{const f=e.target.files?.[0];const asLayer=e.target.dataset.asLayer==='true';e.target.value='';if(f)await importImage(f,{asLayer});});
    els.projectInput.addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await importProject(f);});
    $('#menuModal').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){els.menuModal.setAttribute('aria-hidden','true');handleAction(b.dataset.action,b);}});
    $('#welcomeModal').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)handleAction(b.dataset.action,b);});
    els.exportModal.addEventListener('click',e=>{if(e.target.id==='downloadBtn')performExport('download');if(e.target.id==='shareBtn')performExport('share');if(e.target.id==='openBtn')performExport('open');});
    bindSheetEvents();
    document.addEventListener('keydown',e=>{
      const cmd=e.ctrlKey||e.metaKey;if(cmd&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(cmd&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}else if(['Delete','Backspace'].includes(e.key)&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();deleteLayer(getSelectedLayer());}else if(e.code==='Space'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();}
    });
    window.addEventListener('resize',()=>{fitCamera();queueRender();});
    window.addEventListener('beforeunload',()=>{if(state.dirty)saveProject(true);});
    if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }

  function updateUI(){
    els.projectName.value=state.project.name||'Untitled Project';els.canvasMeta.textContent=`${state.project.width} × ${state.project.height}`;updateUndoRedo();
  }
  function startup(){
    bindGlobalEvents();initHistory();updateUI();fitCamera();queueRender();
    if(!getImageLayer())els.welcomeModal.setAttribute('aria-hidden','false');
  }

  startup();
})();
