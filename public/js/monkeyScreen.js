// Working monkey screen: taming games, and for a tamed monkey a compact
// configuration panel. Every explanation is a hover tip (data-tip).
//
// Block selections happen in the world: choosing a field closes the panel
// and enters selection mode (main.js drives input; outlines in
// render/selectionOutlines.js). Left click selects, right click on a
// selected block removes it, Esc goes back to the panel. After a pick the
// mode moves on by itself: a list stays on that list unless the next field
// is still empty, a single field moves to the next empty one or returns.
import { C2S, TEAMS } from '/shared/protocol.js';
import { MONKEY_WORK as C, INVENTORY_SIZE, HOTBAR_SIZE } from '/shared/config.js';
import { MONKEY_ROLES, ROLE_INFO, MONKEY_FIELDS, QUARRY_OPTIONS, CAST_DIRECTIONS, monkeyFields, fieldName, quarryCells,
  GATHERING_ROLES, SLOT_OPTIONS, SLOT_MODES } from '/shared/monkeys.js';
import { RECIPES } from '/shared/recipes.js';
import { getItemDef } from '/shared/items.js';
import { getBlockDef } from '/shared/blocks.js';
import { renderStack } from './itemIcon.js';

const clone=data=>JSON.parse(JSON.stringify(data));
const same=(a,b)=>a&&b&&a.x===b.x&&a.y===b.y&&a.z===b.z;
const cardFaces=['🍌','🥥','🍒','🍋','🍇','🥝'];
function element(tag,className,text=null) {
  const el=document.createElement(tag);if(className)el.className=className;if(text!==null)el.textContent=text;return el;
}
function button(text,action,tip=null) {
  const b=element('button','',text);b.type='button';b.addEventListener('click',action);if(tip)b.dataset.tip=tip;return b;
}

export class MonkeyScreen {
  constructor(conn) {
    this.conn=conn;this.open=false;this.picking=null;this.timers=[];this.played=null;this.worldGame=false;
    this.pendingSave=false;this.queuedSave=false;
    // A monkey whose screen this player closed: updates for it are ignored
    // until the player talks to it again, so a late update can't reopen it.
    this.ignored=null;
    this.inventory={slots:Array(INVENTORY_SIZE).fill(null),cursor:null};
    this.screen=element('div','screen hidden');this.screen.id='monkey';
    this.panel=element('div','panel card monkey-panel');this.screen.append(this.panel);document.body.append(this.screen);
    this.cursorEl=element('div','monkey-cursor slot');this.cursorEl.hidden=true;document.body.append(this.cursorEl);
    document.addEventListener('mousemove',e=>this.cursorEl.style.transform=`translate(${e.clientX}px, ${e.clientY}px)`);
    this.screen.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('keydown',e=>{
      if(!this.open||e.repeat)return;
      if(e.code==='Escape'){e.preventDefault();this.close(false);}
    });
  }
  // The player right-clicked this monkey: its updates count again.
  talking(id) {if(this.ignored===id)this.ignored=null;}
  action(action,value=null,extra={}) {
    this.conn.send({type:C2S.MONKEY_ACTION,id:this.data.id,session:this.data.session,action,value,...extra});
  }
  timer(fn,ms) {const id=setTimeout(fn,ms);this.timers.push(id);return id;}
  clearTimers() {for(const id of this.timers)clearTimeout(id);this.timers=[];}
  receive(data) {
    if(data.closed){if(this.data?.id===data.id&&(this.open||this.picking||this.worldGame))this.close(false,false);return;}
    if(this.ignored===data.id)return;
    if(this.picking){if(this.data?.id===data.id){this.data=data;if(!this.pendingSave&&data.revision!==this.draftRevision){this.draft=clone(data.config);this.draftRevision=data.revision;}}return;}
    const wasOpen=this.open,same=this.data?.id===data.id&&this.data?.mode===data.mode;
    const unchanged=same&&data.mode==='configure'&&(this.draftRevision===data.revision||this.pendingSave);
    this.data=data;
    if(data.mode==='tame'&&data.game==='simon') {
      const changed=!this.worldGame||this.played!==data.session;
      this.clearTimers();this.played=data.session;this.open=false;this.worldGame=true;
      this.cursorEl.hidden=true;
      if(changed)this.onWorldGame?.();
      this.onCue?.(data.waitMs>0?'Watch the monkey jump and crouch. Then repeat with Space and Shift.':
        `Your turn: jump with Space, crouch with Shift. ${data.progress}/${data.length} correct.`);
      return;
    }
    this.worldGame=false;this.open=true;
    if(!wasOpen)this.onOpen?.();
    if(unchanged) {
      if(this.pendingSave&&(data.revision>this.draftRevision||data.message)) {
        this.pendingSave=false;this.draftRevision=data.revision;
        if(this.queuedSave){this.queuedSave=false;this.saveDraft();}
      }
      this.refreshLive();return;
    }
    if(data.mode==='configure')this.renderConfig();
    else if(data.mode==='result')this.renderResult();
    else if(data.game==='memory')this.renderMemory();
    else if(!same||this.played!==data.session)this.renderSequence();
    this.updateInventory();
  }
  header(subtitle) {
    this.panel.replaceChildren();
    const row=element('div','monkey-heading');
    row.append(element('h1','',this.data.name),button('Close',()=>this.close(true)));
    this.panel.append(row);
    if(subtitle)this.panel.append(element('p','hint',subtitle));
    this.message=element('p','monkey-message',this.data.message??'');this.panel.append(this.message);
  }
  // Status, health and inventory: things that change while the panel is open.
  refreshLive() {
    if(this.statusEl)this.statusEl.textContent=this.data.status??'';
    if(this.hpEl)this.hpEl.textContent=this.data.hp!==null&&this.data.hp!==undefined?`${Math.ceil(this.data.hp)}/${this.data.maxHp} HP`:'';
    if(this.message)this.message.textContent=this.data.message??'';
    if(this.babyEl&&this.data.baby) {
      const left=this.data.baby.secondsLeft;
      this.babyEl.fill.style.width=`${Math.round(this.data.baby.progress*100)}%`;
      this.babyEl.text.textContent=`Grows up in ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} (${Math.round(this.data.baby.progress*100)}%)`;
    }
    this.updateInventory();
  }

  // ---- Configuration ----

  renderConfig() {
    this.clearTimers();this.draft=clone(this.data.config);this.draftRevision=this.data.revision;
    this.pendingSave=false;this.queuedSave=false;
    this.header(this.data.editable?null:`Belongs to the ${TEAMS[this.data.team]?.name??'other'} team.`);
    const live=element('div','monkey-live');
    this.statusEl=element('span','monkey-status');this.hpEl=element('span','monkey-hp');
    live.append(this.statusEl,this.hpEl);this.panel.append(live);
    // A baby: how long until it grows up, instead of roles.
    this.babyEl=null;
    if(this.data.baby) {
      const box=element('div','monkey-baby');
      box.append(element('strong','','Baby monkey'),element('p','hint','Too young to work or fight. When it grows up you can give it any role here.'));
      const bar=element('div','monkey-baby-bar'),fill=element('div','fill');bar.append(fill);
      this.babyEl={fill,text:element('span','monkey-baby-time')};box.append(bar,this.babyEl.text);
      this.panel.append(box);
    }
    // Roles: one button each, the description on hover.
    const roles=element('div','monkey-roles');
    for(const role of MONKEY_ROLES) {
      const b=button(ROLE_INFO[role].name,()=>{this.draft.role=role;this.renderDraft();this.saveDraft();},ROLE_INFO[role].tip);
      b.dataset.role=role;roles.append(b);
    }
    this.roles=roles;this.details=element('div','monkey-details');
    if(!this.data.baby)this.panel.append(roles,this.details);
    // Gear and the two inventories.
    const gear=element('div','monkey-gear');
    this.gearSlots=[];
    for(const [i,name,tip]of [[0,'Tool','A hammer to break blocks with (its strength and speed are the monkey\'s), a weapon or bow for a guard, or a spyglass for a lookout.'],
      [1,'Armor','Armor it wears: reduces damage like yours.']]) {
      const wrap=element('label','monkey-gear-slot');wrap.dataset.tip=tip;
      const cell=this.slotButton('gear',i);wrap.append(element('span','',name),cell);gear.append(wrap);this.gearSlots[i]=cell;
    }
    const pack=element('div','monkey-pack');pack.dataset.tip='What it carries. Click to move items like a chest; shift-click to send them across.';
    this.monkeySlots=Array.from({length:C.inventorySize},(_,i)=>{const c=this.slotButton('monkey',i);pack.append(c);return c;});
    gear.append(pack);this.panel.append(gear);
    const mine=element('div','monkey-inventory inv');
    this.playerSlots=[];
    for(const slot of [...Array.from({length:INVENTORY_SIZE-HOTBAR_SIZE},(_,i)=>i+HOTBAR_SIZE),...Array.from({length:HOTBAR_SIZE},(_,i)=>i)]) {
      const c=this.slotButton('player',slot);this.playerSlots[slot]=c;mine.append(c);
    }
    this.panel.append(mine);
    const actions=element('div','row monkey-actions');
    actions.append(button('Teleport to keep',()=>this.action('teleportHome'),'Move it next to your team\'s keep.'));
    this.panel.append(actions);
    this.renderDraft();this.refreshLive();this.disableForeign();
  }
  slotButton(grid,slot) {
    const cell=button('',()=>{});cell.className='slot';cell.setAttribute('aria-label',`${grid} slot ${slot+1}`);
    cell.addEventListener('mousedown',e=>{
      if((e.button!==0&&e.button!==2)||!this.data.editable)return;
      e.preventDefault();this.action('inventory',null,{grid,slot,button:e.button===2?'right':'left',shift:e.shiftKey});
    });
    return cell;
  }
  setInventory(inventory) {this.inventory=inventory;this.updateInventory();}
  updateInventory() {
    this.cursorEl.hidden=!this.open||this.data?.mode!=='configure';
    renderStack(this.cursorEl,this.cursorEl.hidden?null:this.inventory.cursor);
    if(this.data?.mode!=='configure'||!this.open)return;
    this.playerSlots?.forEach((el,i)=>el&&renderStack(el,this.inventory.slots[i]));
    this.monkeySlots?.forEach((el,i)=>renderStack(el,this.data.slots?.[i]??null));
    this.gearSlots?.forEach((el,i)=>renderStack(el,this.data.gear?.[i]??null));
  }
  // The role's selections and options.
  renderDraft() {
    for(const b of this.roles.children)b.classList.toggle('selected',b.dataset.role===this.draft.role);
    this.details.replaceChildren();
    const d=this.draft;
    if(d.role==='quarry')this.details.append(this.quarryOptions());
    if(d.role==='collector')this.details.append(this.numberOption('Range','Picks up items within this many blocks of the first destination.',d.radius,1,C.maxRadius,v=>d.radius=v));
    if(d.role==='craftsman')this.details.append(this.recipeRow());
    if(d.role==='fisherman')this.details.append(this.castRow());
    if(GATHERING_ROLES.includes(d.role))this.details.append(this.collectRow());
    for(const field of [...monkeyFields(d),'home']) {
      this.details.append(this.fieldRow(field));
      if(field==='dests')for(const row of this.slotRows())this.details.append(row);
    }
    if(d.role!=='idle'&&d.role!=='guard'&&d.role!=='lookout'&&d.role!=='craftsman')this.details.append(this.filterRow());
    this.disableForeign();
  }
  fieldRow(field) {
    const info=MONKEY_FIELDS[field],d=this.draft;
    const value=d[field],count=info.list?value.length:value?1:0;
    const row=element('div','monkey-field');row.dataset.tip=info.tip;
    const swatch=element('span','monkey-swatch');swatch.style.background=`#${info.color.toString(16).padStart(6,'0')}`;
    const label=element('span','monkey-field-name',fieldName(d,field));
    const summary=element('span','monkey-field-value',info.list?`${count} selected`:value?`${value.x}, ${value.y}, ${value.z}`:'Not set');
    if(!count&&field!=='home')summary.classList.add('missing');
    row.append(swatch,label,summary,button(count?'Edit':'Select',()=>this.pick(field)));
    if(count)row.append(button('Clear',()=>{d[field]=info.list?[]:null;this.renderDraft();this.saveDraft();}));
    return row;
  }
  // Craftsman: which recipe it makes (any non-creative recipe; workbench
  // recipes need its workbench, which it always uses).
  recipeRow() {
    const d=this.draft,label=element('label','monkey-recipe','Recipe');
    label.dataset.tip='What it crafts. It fetches exactly the ingredients for as many of these as it can finish and carry.';
    const select=element('select','');
    const none=element('option','','Choose a recipe…');none.value='';select.append(none);
    const sorted=[...RECIPES].sort((a,b)=>getItemDef(a.output).name.localeCompare(getItemDef(b.output).name));
    for(const r of sorted) {
      const o=element('option','',`${getItemDef(r.output).name}${r.count>1?` ×${r.count}`:''} ← ${r.inputs.map(i=>`${i.count} ${getItemDef(i.item).name}`).join(' + ')}`);
      o.value=r.id;select.append(o);
    }
    select.value=d.recipe??'';
    select.onchange=()=>{d.recipe=select.value||null;this.saveDraft();};
    label.append(select);return label;
  }
  // Fisherman: which way it casts from its fishing spot (drawn as a line on
  // the spot while selecting).
  castRow() {
    const d=this.draft,label=element('label','monkey-cast','Casting direction');
    label.dataset.tip='It casts about one block out from its fishing spot this way, and the bobber drops into whatever is below: water, lava or the void.';
    const select=element('select','');
    CAST_DIRECTIONS.forEach((name,i)=>{const o=element('option','',name);o.value=String(i);select.append(o);});
    select.value=String(d.castDir??0);
    select.onchange=()=>{d.castDir=Number(select.value);this.saveDraft();};
    label.append(select);return label;
  }
  // Gatherers: keep what they gather, or leave it on the ground.
  collectRow() {
    const d=this.draft,label=element('label','monkey-collect');
    label.dataset.tip='On: it carries what it gathers to its destinations. Off: it leaves everything on the ground and keeps gathering (it still keeps saplings or seeds to replant). A Collector monkey or you can pick the drops up.';
    const box=element('input','');box.type='checkbox';box.checked=d.collect!==false;
    box.onchange=()=>{d.collect=box.checked;if(!d.collect)d.dests=d.dests;this.renderDraft();this.saveDraft();};
    label.append(box,document.createTextNode(' Collect drops'));return label;
  }
  // A slot choice for each destination machine that has more than one kind
  // of input slot (furnace, alloy furnace).
  slotRows() {
    const d=this.draft,rows=[];
    d.destSlots??={};
    for(const p of d.dests) {
      const kind=getBlockDef(this.blockAt?.(p)??0).tileEntity,options=SLOT_OPTIONS[kind];
      if(!options)continue;
      const key=`${p.x},${p.y},${p.z}`,row=element('label','monkey-slot-row');
      row.dataset.tip='Which slots it fills in this machine: Automatic puts fuel in the fuel slot and the rest in the input; or choose one.';
      row.append(element('span','',`↳ ${getBlockDef(this.blockAt(p)).name} at ${p.x}, ${p.y}, ${p.z}`));
      const select=element('select','');
      for(const mode of options){const o=element('option','',SLOT_MODES[mode]);o.value=mode;select.append(o);}
      select.value=d.destSlots[key]??'auto';
      select.onchange=()=>{if(select.value==='auto')delete d.destSlots[key];else d.destSlots[key]=select.value;this.saveDraft();};
      row.append(select);rows.push(row);
    }
    return rows;
  }
  quarryOptions() {
    const q=this.draft.quarry,box=element('div','monkey-options');
    for(const name of ['shape','axis']) {
      const opt=QUARRY_OPTIONS[name];
      if(name==='axis'&&q.shape==='blocks')continue;
      const label=element('label','',opt.name);label.dataset.tip=opt.tip;
      const select=element('select','');
      for(const [value,text]of Object.entries(opt.values)){const o=element('option','',text);o.value=value;select.append(o);}
      select.value=q[name];select.onchange=()=>{q[name]=select.value;this.renderDraft();this.saveDraft();};
      label.append(select);box.append(label);
    }
    if(q.shape!=='blocks')box.append(this.numberOption('Depth',QUARRY_OPTIONS.depth.tip,q.depth,1,QUARRY_OPTIONS.depth.max,v=>q.depth=v));
    if(q.shape==='circle')box.append(this.numberOption('Radius',QUARRY_OPTIONS.radius.tip,q.radius,1,QUARRY_OPTIONS.radius.max,v=>q.radius=v));
    box.append(this.numberOption('Return after',QUARRY_OPTIONS.returnAt.tip,q.returnAt,1,QUARRY_OPTIONS.returnAt.max,v=>q.returnAt=v));
    return box;
  }
  numberOption(name,tip,value,min,max,set) {
    const label=element('label','monkey-number',name);label.dataset.tip=tip;
    const input=element('input','');input.type='number';input.min=min;input.max=max;input.value=value;
    input.onchange=()=>{const v=Math.round(Number(input.value));if(v>=min&&v<=max){set(v);this.saveDraft();}else input.value=value;};
    label.append(input);return label;
  }
  // Compact filter: a mode toggle and the item slots (copy the cursor's type).
  filterRow() {
    const f=this.draft.filter,wrap=element('div','monkey-filter-row');
    wrap.dataset.tip='Which items it moves. Hold an item on your cursor and click a slot to add its type; click a slot with an empty cursor to remove it.';
    const mode=button(f.mode==='whitelist'?'Only these':'All except',()=>{f.mode=f.mode==='whitelist'?'blacklist':'whitelist';this.renderDraft();this.saveDraft();});
    mode.className='monkey-filter-mode';
    const grid=element('div','monkey-filter');
    const count=Math.min(C.maxFilter,Math.max(9,f.items.length+1));
    for(let i=0;i<count;i++) {
      const cell=button('',()=>{
        if(!this.data.editable)return;
        const item=this.inventory.cursor?.item;
        if(item){if(f.items.includes(item))return;if(i<f.items.length)f.items[i]=item;else f.items.push(item);}
        else if(i<f.items.length)f.items.splice(i,1);
        this.renderDraft();this.saveDraft();
      });
      cell.className='slot';renderStack(cell,f.items[i]?{item:f.items[i],count:1}:null);grid.append(cell);
    }
    wrap.append(element('span','monkey-field-name','Items'),mode,grid);return wrap;
  }
  saveDraft() {
    if(!this.data?.editable)return;
    if(this.pendingSave){this.queuedSave=true;return;}
    this.pendingSave=true;
    this.action('configure',null,{config:clone(this.draft),revision:this.draftRevision});
  }
  disableForeign() {
    if(this.data.editable)return;
    for(const control of this.panel.querySelectorAll('input,select,button'))if(control.textContent!=='Close')control.disabled=true;
  }

  // ---- Selecting blocks in the world ----

  // Everything selected, for outlines: [{pos, color}] (plus the quarry/farm box).
  outlines() {
    if(!this.draft)return [];
    const d=this.draft,out=[];
    for(const field of [...monkeyFields(d),'home']) {
      const info=MONKEY_FIELDS[field],value=d[field];
      for(const pos of info.list?value:value?[value]:[])out.push({pos,color:info.color});
    }
    // A guard's patrol route: lines from point to point and back to the first.
    if(d.role==='guard'&&d.waypoints.length>1) {
      const top=p=>({x:p.x+0.5,y:p.y+1.05,z:p.z+0.5});
      d.waypoints.forEach((p,i)=>out.push({line:[top(p),top(d.waypoints[(i+1)%d.waypoints.length])],color:MONKEY_FIELDS.waypoints.color}));
    }
    // A fisherman's cast: an arrow from its spot out to where the line drops.
    if(d.role==='fisherman'&&d.fishSpot) {
      const [dx,dz]=[[0,-1],[1,0],[0,1],[-1,0]][d.castDir??0]??[0,-1],p=d.fishSpot,y=p.y+1.6;
      const from={x:p.x+0.5,y,z:p.z+0.5},to={x:p.x+0.5+dx*1.5,y,z:p.z+0.5+dz*1.5};
      out.push({line:[from,to],color:MONKEY_FIELDS.fishSpot.color});
      out.push({line:[to,{x:to.x,y:y-3,z:to.z}],color:MONKEY_FIELDS.fishSpot.color});
      out.push({line:[to,{x:to.x-dz*0.3-dx*0.3,y,z:to.z+dx*0.3-dz*0.3}],color:MONKEY_FIELDS.fishSpot.color});
      out.push({line:[to,{x:to.x+dz*0.3-dx*0.3,y,z:to.z-dx*0.3-dz*0.3}],color:MONKEY_FIELDS.fishSpot.color});
    }
    // The whole area it will dig or farm, as one faint box.
    const cells=d.role==='quarry'&&d.quarry.shape!=='blocks'?quarryCells(d):d.role==='farmer'&&d.cornerA&&d.cornerB?[d.cornerA,d.cornerB]:[];
    if(cells.length) {
      const box={x0:Infinity,y0:Infinity,z0:Infinity,x1:-Infinity,y1:-Infinity,z1:-Infinity};
      for(const c of cells){box.x0=Math.min(box.x0,c.x);box.y0=Math.min(box.y0,c.y);box.z0=Math.min(box.z0,c.z);
        box.x1=Math.max(box.x1,c.x);box.y1=Math.max(box.y1,c.y);box.z1=Math.max(box.z1,c.z);}
      out.push({box,color:0xffffff});
    }
    return out;
  }
  pick(field) {
    if(!this.data?.editable)return;
    this.picking=field;this.open=false;this.cursorEl.hidden=true;this.onPick?.(this.pickPrompt());
  }
  pickPrompt() {
    const info=MONKEY_FIELDS[this.picking],d=this.draft,name=fieldName(d,this.picking);
    const n=info.list?` (${d[this.picking].length}/${info.max})`:'';
    return `Selecting ${name}${n}: left click a block${info.list?' · right click a selected one to remove it':''} · Esc when done`;
  }
  // Left click on a block while selecting.
  choose(p) {
    const field=this.picking,info=MONKEY_FIELDS[field],d=this.draft,point={x:p.x,y:p.y,z:p.z};
    if(info.list) {
      if(d[field].some(s=>same(s,point))||d[field].length>=info.max)return;
      d[field].push(point);
    } else d[field]=point;
    this.saveDraft();
    // Next: the first empty field after this one; a list otherwise keeps going.
    const order=monkeyFields(d),next=order.slice(order.indexOf(field)+1).find(f=>MONKEY_FIELDS[f].list?!d[f].length:!d[f]);
    if(next)this.picking=next;
    else if(!info.list||d[field].length>=info.max){this.finishPick();return;}
    this.onPickChanged?.(this.pickPrompt());
  }
  // Right click on a block while selecting: removes it from the current list
  // (or any field it's selected in).
  unchoose(p) {
    const d=this.draft;let changed=false;
    for(const field of [this.picking,...monkeyFields(d),'home']) {
      const info=MONKEY_FIELDS[field];
      if(info.list){const i=d[field].findIndex(s=>same(s,p));if(i>=0){d[field].splice(i,1);changed=true;break;}}
      else if(same(d[field],p)){d[field]=null;changed=true;break;}
    }
    if(changed){this.saveDraft();this.onPickChanged?.(this.pickPrompt());}
  }
  finishPick() {
    if(!this.picking)return;
    this.picking=null;this.open=true;this.renderDraft();this.updateInventory();this.onOpen?.();
  }

  // ---- Taming games ----

  renderResult() {
    this.clearTimers();this.header('A new game is waiting.');
    this.panel.append(element('div','monkey-avatar','🐒'),button('Play again',()=>this.action('retry')));
  }
  renderMemory() {
    this.header('Card memory · Match all six pairs.');
    const grid=element('div','monkey-cards');
    this.data.cards.forEach((face,i)=>{
      const b=button(face===null?'?':cardFaces[face],()=>{b.disabled=true;this.action('card',i);});
      b.className='monkey-card';b.classList.toggle('matched',this.data.matched.includes(i));
      b.disabled=this.data.matched.includes(i)||face!==null||this.data.hideMs>0;
      b.setAttribute('aria-label',face===null?`Card ${i+1}`:`${cardFaces[face]} card ${i+1}`);grid.append(b);
    });
    this.panel.append(grid,element('p','hint',`${this.data.progress}/6 pairs matched`));
  }
  renderSequence() {
    this.clearTimers();this.played=this.data.session;this.ready=false;
    const data=this.data;
    this.header('Cup shuffle · Watch the ball, then choose its cup.');
    this.progress=element('p','monkey-status','Watch the ball…');this.panel.append(this.progress);
    const stage=element('div','monkey-cups'),ball=element('span','monkey-ball');
    const positions=[0,1,2],cups=[];
    ball.style.left=`${data.ball*96+38}px`;stage.append(ball);
    for(let i=0;i<3;i++) {
      const b=button('',()=>{if(this.ready)this.action('cup',positions[i]);});
      b.className='monkey-cup';b.setAttribute('aria-label','Choose cup');
      b.style.transform=`translateX(${i*96}px)`;b.disabled=true;stage.append(b);cups.push(b);
    }
    this.panel.append(stage);
    this.timer(()=>ball.hidden=true,data.stepMs*1.5);
    data.swaps.forEach(([a,b],i)=>this.timer(()=>{
      const ai=positions.indexOf(a),bi=positions.indexOf(b);[positions[ai],positions[bi]]=[b,a];
      cups[ai].style.transform=`translateX(${b*96}px)`;cups[bi].style.transform=`translateX(${a*96}px)`;
    },(i+2)*data.stepMs));
    this.timer(()=>{this.ready=true;for(const b of cups)b.disabled=false;
      this.progress.textContent='Which cup has the ball?';},data.waitMs+100);
  }
  close(relock=false,send=true) {
    if(send&&this.data){this.action('close');this.ignored=this.data.id;}
    this.clearTimers();this.open=false;this.picking=null;this.worldGame=false;this.cursorEl.hidden=true;
    this.onClose?.(relock);
  }
}
