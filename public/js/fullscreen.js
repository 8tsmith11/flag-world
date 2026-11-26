// Fullscreen and keyboard lock require a user gesture. The match can keep
// rendering while inputs are suspended; the server remains authoritative.
export async function enterFullscreen() {
  try {
    if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
    // Feature detection also handles LAN HTTP, where this secure-context API
    // is absent. Browser/OS permission decides which shortcuts can be captured.
    navigator.keyboard?.lock?.().catch(()=>{});
    return !!document.fullscreenElement;
  }catch{return false;}
}
export class MatchFullscreen {
  constructor(input) {
    this.input=input;this.active=false;this.required=false;
    this.beforeUnload=event=>{event.preventDefault();event.returnValue='';};
    document.addEventListener('fullscreenchange',()=>this.changed());
    // Leaving fullscreen opens the ordinary pause menu (onExit), and resuming
    // re-enters fullscreen; there is no separate fullscreen screen.
    document.addEventListener('keydown',event=>{
      if(this.active&&(event.ctrlKey||event.metaKey)&&['KeyW','KeyN','KeyT','KeyR'].includes(event.code))event.preventDefault();
    });
  }
  get paused(){return false;}
  // Fullscreen was left during the match: the next resume should go back in.
  get wanted(){return this.active&&this.required&&!document.fullscreenElement;}
  start(){this.active=true;this.required=!!document.fullscreenElement;window.addEventListener('beforeunload',this.beforeUnload);this.changed();}
  stop(){this.active=false;window.removeEventListener('beforeunload',this.beforeUnload);navigator.keyboard?.unlock?.();this.changed();}
  changed(){if(this.active&&document.fullscreenElement)this.required=true;
    if(this.wanted){this.input.release();document.exitPointerLock();this.onExit?.();}}
}
