import { LOBBY_MEDIA as C } from '/shared/config.js';
const KEY='flagWorld.musicVolume';
export class LobbyMusic {
  constructor(settings) {
    this.volume=C.musicVolume;this.active=true;this.unlocked=false;this.timer=null;
    try {const saved=localStorage.getItem(KEY);if(saved!==null&&Number.isFinite(Number(saved)))this.volume=Math.max(0,Math.min(1,Number(saved)));}catch{}
    this.audio=new Audio(C.music);this.audio.loop=true;this.audio.preload='none';this.audio.volume=this.volume;
    settings.subscribe(volumes => {
      this.volume = volumes.master * volumes.music;
      if (this.active) this.audio.volume = this.volume;
    });
    document.addEventListener('pointerdown',()=>{this.unlocked=true;if(this.active)this.play();});
  }
  play(){this.audio.volume=this.volume;this.audio.play().catch(()=>{});}
  start(){clearInterval(this.timer);this.timer=null;this.active=true;if(this.unlocked)this.play();}
  fadeOut() {
    this.active=false;clearInterval(this.timer);
    if(this.audio.paused)return;
    const started=performance.now(),from=this.audio.volume;
    this.timer=setInterval(()=>{const fraction=Math.min(1,(performance.now()-started)/(C.fadeSeconds*1000));
      this.audio.volume=from*(1-fraction);
      if(fraction===1){clearInterval(this.timer);this.timer=null;this.audio.pause();this.audio.currentTime=0;}
    },1000/C.fadeTickHz);
  }
}
