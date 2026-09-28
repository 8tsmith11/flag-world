import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LOOK_CAPTURE as C } from '../shared/config.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const label=process.argv[2]??'after', seeds=process.argv.slice(3).filter(value=>/^\d+$/.test(value)).map(Number);
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true,args:['--enable-unsafe-swiftshader']});
const results=[];mkdirSync(`/tmp/look-${label}`,{recursive:true});
try{for(const seed of seeds.length?seeds:[1]){
 let renderError;const page=await browser.newPage({viewport:{width:C.width,height:C.height}});page.on('pageerror',e=>{renderError=e.message;console.error(e);});page.on('response',r=>{if(r.status()>=400)console.error(`${r.status()} ${r.url()}`);});page.on('console',msg=>{if(msg.type()==='error'){renderError=msg.text();console.error(renderError);}});
 await page.goto(`http://localhost:3000/look.html?seed=${seed}&size=${process.argv.find(value=>value.startsWith('--size='))?.split('=')[1]??C.worldSize}`);await page.waitForFunction(()=>window.lookReady,{},{timeout:C.timeoutMs});
 for(const view of process.argv.includes('--overview-only')?['above']:(process.argv.includes('--forests-only')?['forest','ancient']:['above','side','below','forest','ancient'])){
 await page.evaluate(view=>window.look.setView(view),view);await page.screenshot({path:`/tmp/look-${label}/${seed}-${view}.png`});
 if(seed===1&&['side','forest','ancient'].includes(view)){
 const timing=await page.evaluate(async C=>{const {renderer,scene,camera,chunks}=window.look;let last=performance.now(),interval=0,cpu=0;const builds=chunks.buildCount;
 for(let i=0;i<C.warmFrames+C.sampleFrames;i++){await new Promise(requestAnimationFrame);const now=performance.now();const started=performance.now();chunks.update(camera.position.x,camera.position.z);renderer.render(scene,camera);if(i>=C.warmFrames){interval+=now-last;cpu+=performance.now()-started;}last=now;}
 const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
 return {gpu:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown',frameMs:interval/C.sampleFrames,submitMs:cpu/C.sampleFrames,remeshes:chunks.buildCount-builds,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,forestScore:window.look.forestScore,ancientScore:window.look.ancientScore};},C);if(timing.remeshes!==0)throw Error('Animation remeshed terrain');results.push({seed,view,...timing});console.log(label,view,timing);
 }
 }
 if(process.argv.includes('--overview-only')){await page.close();if(renderError)throw Error(renderError);continue;}
 const timeCheck=await page.evaluate(async C=>{await window.look.setView('forest',C.dayTime);const b=window.look.chunks.buildCount;await window.look.setView('forest',C.nightTime);return window.look.chunks.buildCount-b;},C);console.log('day/night remeshes',timeCheck);if(timeCheck!==0)throw Error('Time-only change remeshed terrain');
 await page.screenshot({path:`/tmp/look-${label}/${seed}-forest-night.png`});await page.evaluate(C=>window.look.setView('below',C.nightTime),C);await page.screenshot({path:`/tmp/look-${label}/${seed}-below-night.png`});if(seed===1)await page.evaluate(async()=>{
  const THREE=await import('three'),models=await import('/js/render/models.js');
  const {lightModel,lightUniform}=await import('/js/render/entityLighting.js');
  const scene=new THREE.Scene(),uniform=lightUniform();
  const objects=[models.createPlayerModel({color:0x999999}),models.createCowModel(),models.createDragonModel(),
    models.createCrawlerModel(),models.createEelModel(),models.createArrowModel(),models.createItemModel(90),
    new THREE.Sprite(new THREE.SpriteMaterial()),new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial(),2)];
  for(const object of objects){lightModel(object,uniform);scene.add(object);}
  await window.look.renderer.compileAsync(scene,window.look.camera);
 });
 await page.close();if(renderError)throw Error(renderError);
}}finally{await browser.close();if(results.length)writeFileSync(`/tmp/look-${label}/timing.json`,JSON.stringify(results,null,2));}
