// Actual DOM/WebGL checks; externally installed Playwright like look-capture.js.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:900,height:800}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  // Use the real page, styles and import map without joining a match.
  await page.route('**/js/main.js',route=>route.fulfill({contentType:'application/javascript',body:'window.checkReady=true;'}));
  // Fixed reference keeps the parity check valid after this change is committed.
  const old=execFileSync('git',['show','4dab143ecd2e2fa4c38558e7dd2712259245d3a0:public/js/render/models.js'],{encoding:'utf8'});
  const baseline=old.slice(old.indexOf('export function createDragonModel'),old.indexOf('// A Crawler, facing'));
  await page.route('**/js/render/dragonBaseline.js',route=>route.fulfill({contentType:'application/javascript',
    body:`import * as THREE from 'three';\nconst lambert=color=>new THREE.MeshLambertMaterial({color});\n${baseline}`}));
  await page.goto(`${process.env.BASE_URL??'http://localhost:3001'}/`);await page.waitForFunction(()=>window.checkReady);
  const result=await page.evaluate(async()=>{
    const check=(test,message)=>{if(!test)throw Error(message);};
    const {MonkeyScreen}=await import('/js/monkeyScreen.js');
    const {defaultMonkeyConfig}=await import('/shared/monkeys.js');
    const {MONKEY_WORK,GLASS_SETTINGS}=await import('/shared/config.js');
    const {BLOCK}=await import('/shared/blocks.js');
    const THREE=await import('three');
    const {EntityRenderer}=await import('/js/render/entityRenderer.js');
    const {createDragonModel,animateDragon,createItemModel}=await import('/js/render/models.js');
    const {animateMonkey}=await import('/js/render/monkeyModels.js');
    const {lightModel,lightUniform}=await import('/js/render/entityLighting.js');
    const before=await import('/js/render/dragonBaseline.js');
    const messages=[],screen=new MonkeyScreen({send:msg=>messages.push(structuredClone(msg))});
    screen.onOpen=()=>screen.screen.classList.remove('hidden');screen.onClose=()=>screen.screen.classList.add('hidden');
    screen.onWorldGame=()=>screen.screen.classList.add('hidden');
    const find=text=>[...screen.panel.querySelectorAll('button')].find(b=>b.textContent===text);
    const config={id:17,name:'Bongo',team:0,mode:'configure',editable:true,revision:0,seeds:1,slots:Array(9).fill(null),cargo:null,status:'Idle',config:defaultMonkeyConfig()};
    screen.receive(config);check(screen.panel.querySelector('h1').textContent==='Bongo','Stable name missing from GUI');
    screen.close();check(screen.screen.classList.contains('hidden'),'Closing left the screen visible');
    screen.receive(config);check(!screen.screen.classList.contains('hidden')&&screen.open,'Unchanged tamed monkey could not reopen');
    check(!find('Give 1 sapling')&&!screen.panel.querySelector('.monkey-search'),'Legacy supply button/catalogue remains');
    const inventory={slots:Array(36).fill(null),cursor:{item:BLOCK.WOOD,count:8}};
    screen.setInventory(inventory);const beforeFilter=messages.length;
    screen.filterGrid.firstElementChild.click();
    check(screen.draft.filter.items[0]===BLOCK.WOOD&&inventory.cursor.count===8&&messages.length===beforeFilter,'Filter did not copy without consuming');
    screen.setInventory({...inventory,cursor:null});screen.filterGrid.firstElementChild.click();
    check(screen.draft.filter.items.length===0,'Empty cursor did not clear the filter');
    screen.monkeySlots.slots[0].dispatchEvent(new MouseEvent('mousedown',{button:2}));
    check(messages.at(-1).action==='inventory'&&messages.at(-1).grid==='monkey'&&messages.at(-1).button==='right','Monkey inventory click missing');
    screen.playerSlots.slots[0].dispatchEvent(new MouseEvent('mousedown',{button:0,shiftKey:true}));
    check(messages.at(-1).grid==='player'&&messages.at(-1).shift,'Player shift transfer missing');
    screen.role.value='courier';screen.role.dispatchEvent(new Event('change'));
    screen.pick('from');screen.choose({x:10,y:5,z:10});screen.pick('to');screen.choose({x:15,y:5,z:10});
    find('Save settings').click();
    check(messages.at(-1).config.from.x===10&&messages.at(-1).config.to.x===15,'Crosshair target draft was lost');
    screen.receive({...config,team:1,editable:false,revision:1});
    check([...screen.panel.querySelectorAll('button,input,select')].filter(b=>b.textContent!=='Close').every(b=>b.disabled),'Enemy config editable');
    screen.receive({...config,revision:2});screen.role.value='lumberjack';screen.role.dispatchEvent(new Event('change'));
    screen.pick('sites');screen.choose({x:12,y:4,z:10});check(screen.draft.sites.length===1,'Tree list did not retain selected column');
    screen.pick('target');screen.receive({...config,revision:3});screen.choose({x:14,y:4,z:10});find('Save settings').click();
    check(messages.at(-1).revision===2,'Picking overwrote a concurrent teammate revision');
    screen.receive({...config,revision:3,message:'A teammate changed these settings.'});check(screen.draftRevision===3,'Stale form did not refresh');
    screen.receive({id:17,name:'Bongo',team:null,mode:'tame',session:1,game:'memory',cards:Array(12).fill(null),matched:[],progress:0,hideMs:0});
    check(screen.panel.querySelectorAll('.monkey-card').length===12,'Memory grid missing');screen.panel.querySelector('.monkey-card').click();
    check(messages.at(-1).action==='card'&&messages.at(-1).value===0,'Card click missing');
    screen.receive({id:17,name:'Bongo',team:null,mode:'tame',session:2,game:'simon',length:2,stepMs:2,waitMs:8,progress:0});
    check(!screen.open&&screen.worldGame&&screen.screen.classList.contains('hidden')&&!find('Jump (Space)'),'Simon still opens a GUI');
    screen.receive({id:17,name:'Bongo',team:null,mode:'tame',session:3,game:'cups',ball:0,swaps:[[0,1],[1,2]],stepMs:2,waitMs:10,progress:0});
    check([...screen.panel.querySelectorAll('.monkey-cup')].every(c=>c.textContent===''&&c.getAttribute('aria-label')==='Choose cup'),'Cup identities are labeled');
    await new Promise(r=>setTimeout(r,140));screen.panel.querySelector('.monkey-cup').click();check(messages.at(-1).value===2,'Cup position was lost during shuffle');
    screen.close();check(screen.timers.length===0,'Closed games retained timers');

    // Brown before taming; color changes from the authoritative snapshot.
    const scene=new THREE.Scene(),entities=new EntityRenderer(scene),camera=new THREE.PerspectiveCamera(75,1,.05,64);
    camera.position.set(0,2,0);
    entities.add(1,{id:1,type:'npc',npc:'workMonkey',team:null,name:'Bongo',x:0,y:0,z:-8,yaw:0});
    entities.update(1/60,null,null,camera);const monkey=entities.object(1),color=monkey.userData.monkey.fur.color.getHex();
    const brown=new THREE.Color(MONKEY_WORK.wildColor).lerp(new THREE.Color(0x3a2410),.2).getHex();check(color===brown,'Wild monkey is not brown');
    lightModel(monkey,lightUniform());
    entities.pushSnapshot(1,{id:1,team:1,name:'Bongo',x:0,y:0,z:-8,yaw:0});entities.update(1/60,null,null,camera);
    check(monkey.userData.monkey.fur.color.getHex()!==color&&entities.entities.get(1).info.team===1,'Taming did not update fur/team');
    check(monkey.userData.monkey.fur.color.b>monkey.userData.monkey.fur.color.r,'Blue team fur stayed red');
    animateMonkey(monkey,1,{pose:'ready'});const standing=monkey.userData.monkey.body.position.y;
    animateMonkey(monkey,1,{pose:'crouch'});check(monkey.userData.monkey.body.position.y<standing*.7,'World monkey crouch pose missing');
    const glass=createItemModel(BLOCK.GLASS);check(glass.children[0].material.opacity===GLASS_SETTINGS.opacity,'Held glass opacity differs');
    const oldDragon=before.createDragonModel(),dragon=createDragonModel();
    before.animateDragon(oldDragon,1/60,false,false);animateDragon(dragon,1/60,false,false);
    const vertices=model=>{
      model.updateMatrixWorld(true);const result=new Map(),v=new THREE.Vector3();
      model.traverse(m=>{
        if(!m.isMesh)return;for(let p=m;p;p=p.parent)if(!p.visible)return;
        const id=m.material.color.getHex();if(!result.has(id))result.set(id,[]);
        const pos=m.geometry.getAttribute('position'),idx=m.geometry.index;
        for(let i=0;i<(idx?.count??pos.count);i++) {
          v.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(m.matrixWorld);
          result.get(id).push([v.x,v.y,v.z]);
        }
      });
      for(const list of result.values())list.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);return result;
    };
    const oldVertices=vertices(oldDragon),newVertices=vertices(dragon);
    check(oldVertices.size===newVertices.size,'Dragon materials changed');
    // Compare quantized point multisets, allowing only float-buffer rounding.
    const quantized=list=>list.map(p=>p.map(n=>Math.round(n*10000)).join(',')).sort().join(';');
    for(const [id,list]of oldVertices)check(quantized(list)===quantized(newVertices.get(id)),`Dragon geometry changed: ${id}`);
    const renderer=new THREE.WebGLRenderer();renderer.setSize(320,240);
    const count=model=>{const s=new THREE.Scene();s.add(model);model.position.z=-8;renderer.render(s,camera);return renderer.info.render.calls;};
    const callsBefore=count(oldDragon),callsAfter=count(dragon);check(callsAfter<callsBefore,'Dragon draw calls did not improve');
    for(let i=2;i<=130;i++)entities.add(i,{id:i,type:'dragon',name:'Dragon',x:0,y:0,z:i===2?-12:12,yaw:0});
    entities.update(1/60,null,null,camera);
    check(entities.object(2).parent===scene,'Visible dragon missing');
    for(let i=3;i<=130;i++)check(entities.object(i).parent===null,'Hidden dragon rig remains in scene');
    camera.rotation.y=Math.PI;entities.update(1/60,null,null,camera);
    check(entities.object(2).parent===null&&entities.object(3).parent===scene,'Camera turn did not restore dragons');
    entities.pushSnapshot(3,{id:3,x:0,y:0,z:1000,yaw:0});entities.update(1/60,null,null,camera);check(entities.object(3).parent===null,'Far dragon retained scene traversal');
    for(const id of [...entities.entities.keys()])entities.remove(id);renderer.dispose();
    return {dragonCallsBefore:callsBefore,dragonCallsAfter:callsAfter,hiddenDragonsChecked:128};
  });
  assert.deepEqual(errors,[],'Browser errors');console.log('OK: monkey GUI games/targets/team revisions, brown wild monkeys, dragon geometry parity and hidden rig culling',result);
} finally {await browser.close();}
