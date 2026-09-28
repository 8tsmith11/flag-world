// Render and read pixels in the same task; keep preserveDrawingBuffer off so
// ordinary frames incur no capture overhead. The browser saves a local PNG.
export function captureView(renderer,scene,camera) {
  renderer.render(scene,camera);
  return new Promise((resolve,reject)=>renderer.domElement.toBlob(blob=>{
    if(blob)resolve(blob);else reject(new Error('Could not capture the view.'));
  },'image/png'));
}
export async function downloadLobbyView(renderer,scene,camera) {
  const blob=await captureView(renderer,scene,camera),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='lobby.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
