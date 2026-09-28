// Run against npm start: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// node scripts/capture-lobby.js [http://localhost:3000]
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LOBBY_CAPTURE as C } from '../shared/config.js';
const module=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(module?pathToFileURL(module).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:C.width,height:C.height}});
  page.on('pageerror',error=>console.error(error));
  await page.goto(`${process.argv[2]??'http://localhost:3000'}/capture.html`);
  await page.waitForFunction(()=>window.captureReady||window.captureError,{},{timeout:C.timeoutMs});
  const error=await page.evaluate(()=>window.captureError);if(error)throw new Error(error);
  mkdirSync('public/img',{recursive:true});await page.screenshot({path:'public/img/lobby.png'});
  console.log('Saved public/img/lobby.png',await page.evaluate(()=>window.captureInfo));
}finally{await browser.close();}
