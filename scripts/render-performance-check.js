// Uses externally installed Playwright, like look-capture.js. Checks the actual
// mesh worker and renderer across edits, camera moves and entity visibility.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { LOOK_CAPTURE as C } from '../shared/config.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:C.width,height:C.height}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${process.env.BASE_URL??'http://localhost:3000'}/look.html?seed=1&size=${process.argv.includes('--large')?'large':'small'}`);
  await page.waitForFunction(()=>window.lookReady,{},{timeout:C.timeoutMs});
  const result=await page.evaluate(async()=>{
    const THREE=await import('three');
    const {meshChunk}=await import('/js/render/mesher.js');
    const {EntityRenderer}=await import('/js/render/entityRenderer.js');
    const {chunkKey}=await import('/shared/world.js');
    const {BLOCK}=await import('/shared/blocks.js');
    const {LIGHTING}=await import('/shared/config.js');
    const {chunks,world,camera}=window.look;
    const check=(test,message)=>{if(!test)throw Error(message);};
    const updateTimes=[];
    async function settle() {
      const start=performance.now();
      while(true) {
        const t=performance.now();chunks.update(camera.position.x,camera.position.z,camera);updateTimes.push(performance.now()-t);
        if(chunks.error)throw chunks.error;
        check(chunks.meshing.pending.size<=LIGHTING.meshWorkerBatch,'Unbounded worker queue');
        if(chunks.buildCursor>=chunks.queue.length&&!chunks.meshing.pending.size&&!chunks.dirty.size&&!chunks.lighting.edits)return;
        check(performance.now()-start<60000,'Mesh queue did not settle');
        await new Promise(requestAnimationFrame);
      }
    }
    let compared=0;
    function compare(key) {
      const entry=chunks.meshes.get(key);check(entry,`Missing mesh ${key}`);
      const expected=meshChunk(world,entry.chunk);
      for(const [name,geometry]of Object.entries(expected)) {
        const actual=entry[name]?.geometry;
        check(!!actual===!!geometry,`${name} presence differs`);
        if(!geometry)continue;
        for(const [attribute,buffer]of Object.entries(geometry.attributes)) {
          const array=actual.getAttribute(attribute)?.array;
          check(array?.length===buffer.array.length&&array.every((n,i)=>n===buffer.array[i]),`${name}/${attribute} differs`);
        }
        check(actual.index.array.length===geometry.index.array.length&&actual.index.array.every((n,i)=>n===geometry.index.array[i]),`${name} indices differ`);
        check(actual.boundingSphere.equals(geometry.boundingSphere),`${name} bounds differ`);
        geometry.dispose();
      }
      compared++;
    }
    await window.look.setView('ancient');
    await settle();
    const mostDetailed=[...chunks.meshes].sort((a,b)=>b[1].draws.reduce((n,m)=>n+m.geometry.index.count,0)-a[1].draws.reduce((n,m)=>n+m.geometry.index.count,0));
    for(const [key]of mostDetailed.slice(0,8))compare(key);

    // A boundary edit changes faces and Branch arms in both chunks. Edit it
    // again while a request is in flight to exercise stale-result rejection.
    const chunk=mostDetailed[0][1].chunk;
    const x=chunk.cx*16+15,y=chunk.cy*16+8,z=chunk.cz*16+8;
    const edits=[[x,y,z],[x+1,y,z],[x+2,y,z]],old=edits.map(p=>world.getBlock(...p));
    world.setBlock(x,y,z,BLOCK.WOOD);world.setBlock(x+1,y,z,BLOCK.BRANCH);
    await settle();
    const key=chunkKey(chunk.cx,chunk.cy,chunk.cz);
    check(chunks.meshing.request(key,chunk),'Could not request race fixture');
    const previous=chunks.meshes.get(key);
    world.setBlock(x,y,z,BLOCK.AIR);world.setBlock(x+2,y,z,BLOCK.TORCH);
    check(chunks.meshes.get(key)===previous,'Old mesh vanished before its replacement was ready');
    await settle();
    compare(key);compare(chunkKey(chunk.cx+1,chunk.cy,chunk.cz));
    for(let i=0;i<edits.length;i++)world.setBlock(...edits[i],old[i]);
    await settle();compare(key);

    // Teleport across chunk queues while requests are pending, then come back.
    const position=camera.position.clone();
    camera.position.x+=96;chunks.update(camera.position.x,camera.position.z,camera);
    camera.position.copy(position);await settle();compare(key);

    // Only in-view goblin rigs enter the instance batches. Rotate to bring a
    // hidden goblin back, remove the original template and exercise slot reuse.
    const scene=new THREE.Scene(),entities=new EntityRenderer(scene);
    const eye=new THREE.PerspectiveCamera(75,1,0.05,64);eye.position.set(0,1,0);
    for(let i=1;i<=64;i++)entities.add(i,{id:i,type:'goblinWorker',x:0,y:0,z:i===1?-12:12,yaw:0});
    entities.update(1/60,null,null,eye);
    const batch=entities.goblinInstances.batches.get('goblinWorker');
    check(batch.meshes.every(m=>m.count===1),'Hidden goblins occupy GPU instances');
    check([...entities.entities.values()].every(e=>e.object.parent===null),'Animation rigs remain in scene traversal');
    const part=entities.entities.get(1).instanceParts[0],matrix=new THREE.Matrix4();
    batch.meshes[0].getMatrixAt(0,matrix);
    check(matrix.elements.every((n,i)=>Math.abs(n-part.matrixWorld.elements[i])<1e-5),'Visible instance transform differs');
    eye.rotation.y=Math.PI;entities.update(1/60,null,null,eye);
    check(batch.meshes.every(m=>m.count===63),'Camera turn did not restore hidden goblins');
    entities.remove(1);entities.remove(2);entities.update(1/60,null,null,eye);
    check(batch.meshes.every(m=>m.count===62),'Removed slots still draw');
    entities.add(65,{id:65,type:'goblinWorker',x:0,y:0,z:12,yaw:0});entities.update(1/60,null,null,eye);
    check(batch.meshes.every(m=>m.count===63),'Reused slot did not draw');
    for(const id of [...entities.entities.keys()])entities.remove(id);
    entities.update(1/60,null,null,eye);
    check(batch.meshes.every(m=>m.count===0&&!m.visible),'Empty batches still draw');
    chunks.dispose();chunks.update(camera.position.x,camera.position.z,camera);
    check(chunks.meshing.pending.size===0,'Disposed renderer queued worker jobs');
    updateTimes.sort((a,b)=>a-b);
    return {compared,updates:updateTimes.length,updateP95Ms:updateTimes[Math.floor(updateTimes.length*.95)],maxUpdateMs:updateTimes.at(-1)};
  });
  assert.deepEqual(errors,[],'Browser errors');
  console.log('OK: worker geometry parity, boundary edits, stale results, camera moves and goblin visibility',result);
} finally {await browser.close();}
