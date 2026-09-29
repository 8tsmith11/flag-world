import { C2S, TEAMS } from '/shared/protocol.js';
import { MONKEY_WORK as C, INVENTORY_SIZE, HOTBAR_SIZE } from '/shared/config.js';
import { MONKEY_ROLES } from '/shared/monkeys.js';
import { getItemDef } from '/shared/items.js';
import { renderStack } from './itemIcon.js';

const clone=data=>JSON.parse(JSON.stringify(data));
const coordinate=p=>p?`${p.x}, ${p.y}, ${p.z}`:'Not selected';
const cardFaces=['🍌','🥥','🍒','🍋','🍇','🥝'];
function element(tag,className,text=null) {
  const el=document.createElement(tag);el.className=className;if(text!==null)el.textContent=text;return el;
}
function button(text,action) {const b=element('button','',text);b.type='button';b.addEventListener('click',action);return b;}

export class MonkeyScreen {
  constructor(conn) {
    this.conn=conn;this.open=false;this.picking=null;this.timers=[];this.played=null;this.worldGame=false;
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
  action(action,value=null,extra={}) {
    this.conn.send({type:C2S.MONKEY_ACTION,id:this.data.id,session:this.data.session,action,value,...extra});
  }
  timer(fn,ms) {const id=setTimeout(fn,ms);this.timers.push(id);return id;}
  clearTimers() {for(const id of this.timers)clearTimeout(id);this.timers=[];}
  receive(data) {
    if(data.closed){if(this.open||this.picking||this.worldGame)this.close(false,false);return;}
    if(this.picking&&this.data?.id===data.id){this.data=data;return;}
    const wasOpen=this.open,same=this.data?.id===data.id&&this.data?.mode===data.mode;
    const unchanged=same&&data.mode==='configure'&&this.draftRevision===data.revision;
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
      this.status.textContent=this.summary(data);this.message.textContent=data.message??'';
      this.updateInventory();return;
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
    this.panel.append(row,element('p','hint',subtitle));
    this.message=element('p','monkey-message',this.data.message??'');this.panel.append(this.message);
  }
  summary(data) {return `${data.status} · ${data.seeds} reserved sapling${data.seeds===1?'':'s'}${data.cargo?` · Carrying ${data.cargo.count} ${getItemDef(data.cargo.item).name}`:''}`;}
  renderConfig() {
    this.clearTimers();this.draft=clone(this.data.config);this.draftRevision=this.data.revision;
    this.header(`${TEAMS[this.data.team]?.name??'Another'} team · ${this.data.editable?'Your team can configure this monkey.':'Owned by another team.'}`);
    this.status=element('p','monkey-status',this.summary(this.data));this.panel.append(this.status);
    const form=element('div','monkey-settings');
    const role=element('select','');
    for(const name of MONKEY_ROLES){const o=element('option','',name[0].toUpperCase()+name.slice(1));o.value=name;role.append(o);}
    role.value=this.draft.role;role.addEventListener('change',()=>{this.readForm();this.draft.role=role.value;this.renderDraft();});
    const roleLabel=element('label','','Role');roleLabel.append(role);form.append(roleLabel);this.role=role;
    for(const [field,title,max]of [['radius','Horizontal range',C.maxRadius],['vertical','Vertical range (±)',C.maxVertical]]) {
      const label=element('label','',title),input=element('input','');input.type='number';input.min=field==='radius'?1:0;
      input.max=max;input.value=this.draft[field];this[field]=input;label.append(input);form.append(label);
    }
    this.panel.append(form);this.details=element('div','monkey-details');this.panel.append(this.details);
    this.renderDraft();
    const filterLabel=element('label','','Item filter'),mode=element('select','');
    for(const value of ['blacklist','whitelist']){const option=element('option','',value==='blacklist'?'Collect everything except':'Only collect these items');option.value=value;mode.append(option);}
    mode.value=this.draft.filter.mode;mode.onchange=()=>this.draft.filter.mode=mode.value;filterLabel.append(mode);this.panel.append(filterLabel);
    this.filterGrid=element('div','monkey-filter inv');this.panel.append(
      element('p','hint','Pick up an item from your inventory, then click a filter slot to copy its type. The item stays on your cursor. Click a filter with an empty cursor to remove it.'),this.filterGrid);
    this.renderFilters();
    this.panel.append(element('h2','','Monkey inventory'));
    this.monkeySlots=this.inventoryGrid('monkey',Array.from({length:C.inventorySize},(_,i)=>i));
    this.panel.append(this.monkeySlots.grid,element('p','hint','Store supplies here, including saplings for planting. Shift-click transfers stacks.'));
    this.panel.append(element('h3','','Carrying to delivery target'));
    this.cargoSlots=this.inventoryGrid('cargo',[0]);this.panel.append(this.cargoSlots.grid);
    this.panel.append(element('h2','','Your inventory'));
    this.playerSlots=this.inventoryGrid('player',[
      ...Array.from({length:INVENTORY_SIZE-HOTBAR_SIZE},(_,i)=>i+HOTBAR_SIZE),
      ...Array.from({length:HOTBAR_SIZE},(_,i)=>i)]);
    this.panel.append(this.playerSlots.grid);
    const actions=element('div','row');
    actions.append(button('Save settings',()=>{this.readForm();this.action('configure',null,{config:this.draft,revision:this.draftRevision});}));this.panel.append(actions);
    this.updateInventory();
    this.disableForeign();
  }
  inventoryGrid(grid,indices) {
    const el=element('div','monkey-inventory inv'),slots=[];
    for(const slot of indices) {
      const cell=button('',()=>{});cell.className='slot';cell.setAttribute('aria-label',`${grid} slot ${slot+1}`);
      cell.addEventListener('mousedown',e=>{
        if((e.button!==0&&e.button!==2)||!this.data.editable)return;
        e.preventDefault();this.action('inventory',null,{grid,slot,button:e.button===2?'right':'left',shift:e.shiftKey});
      });slots[slot]=cell;el.append(cell);
    }
    return {grid:el,slots};
  }
  setInventory(inventory) {this.inventory=inventory;this.updateInventory();}
  updateInventory() {
    this.cursorEl.hidden=!this.open||this.data?.mode!=='configure';
    renderStack(this.cursorEl,this.cursorEl.hidden?null:this.inventory.cursor);
    if(this.data?.mode!=='configure'||!this.open)return;
    for(const [els,stacks]of [[this.playerSlots,this.inventory.slots],[this.monkeySlots,this.data.slots??[]],[this.cargoSlots,[this.data.cargo]]]) {
      els?.slots.forEach((el,i)=>renderStack(el,stacks[i]));
    }
  }
  renderFilters() {
    this.filterGrid.replaceChildren();
    const list=this.draft.filter.items,count=Math.min(C.maxFilter,Math.max(18,list.length+1));
    for(let i=0;i<count;i++) {
      const cell=button('',()=>{
        if(!this.data.editable)return;
        const item=this.inventory.cursor?.item;
        if(item) {
          if(list.includes(item))return;
          if(i<list.length)list[i]=item;else list.push(item);
        } else if(i<list.length)list.splice(i,1);
        this.renderFilters();
      });
      cell.className='slot';cell.setAttribute('aria-label',`Filter slot ${i+1}`);
      renderStack(cell,list[i]?{item:list[i],count:1}:null);this.filterGrid.append(cell);
    }
    this.disableForeign();
  }
  readForm() {if(this.radius){this.draft.radius=Number(this.radius.value);this.draft.vertical=Number(this.vertical.value);}}
  disableForeign() {
    if(this.data.editable)return;
    for(const control of this.panel.querySelectorAll('input,select,button'))if(control.textContent!=='Close')control.disabled=true;
  }
  targetRow(field,title) {
    const row=element('div','monkey-target');row.append(element('span','',title),element('code','',coordinate(this.draft[field])),
      button('Pick block',()=>this.pick(field)));return row;
  }
  renderDraft() {
    this.details.replaceChildren();
    const courier=this.draft.role==='courier',lumberjack=this.draft.role==='lumberjack';
    if(courier) {
      this.details.append(this.targetRow('from','From inventory'),this.targetRow('to','To block'),
        element('p','hint','From must be within your range of To. Furnace sources use output only; delivery fills fuel first, then input.'));
    } else this.details.append(this.targetRow('target','Delivery target'));
    if(lumberjack) {
      this.details.append(element('p','hint','Mark tree bases or soil blocks. Each spot authorizes its whole column. Put saplings in the monkey inventory first; one is kept for replanting. Fallen saplings near marked spots go to the delivery target.'));
      const list=element('ul','monkey-sites');
      this.draft.sites.forEach((p,i)=>{const li=element('li','');li.append(element('code','',coordinate(p)),button('Remove',()=>{this.draft.sites.splice(i,1);this.renderDraft();}));list.append(li);});
      this.details.append(list,button(`Add tree / planting spot (${this.draft.sites.length}/${C.maxSites})`,()=>this.pick('sites')));
    }
    this.disableForeign();
  }
  pick(field) {
    this.readForm();if(field==='sites'&&this.draft.sites.length>=C.maxSites)return;
    this.picking=field;this.open=false;this.cursorEl.hidden=true;this.onPick?.();
  }
  choose(p) {
    const point={x:p.x,y:p.y,z:p.z};
    if(this.picking==='sites') {
      if(!this.draft.sites.some(s=>s.x===point.x&&s.y===point.y&&s.z===point.z))this.draft.sites.push(point);
    } else {this.draft[this.picking]=point;if(this.picking==='to')this.draft.target=point;}
    this.cancelPick();
  }
  cancelPick() {this.picking=null;this.open=true;this.renderDraft();this.updateInventory();this.onOpen?.();}
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
    if(send&&this.data)this.action('close');this.clearTimers();this.open=false;this.picking=null;this.worldGame=false;this.cursorEl.hidden=true;
    this.onClose?.(relock);
  }
}
