import { MONKEY_WORK as C, TICK_RATE } from '../shared/config.js';
import { MONKEY_GAMES } from '../shared/monkeys.js';

export class MonkeyTaming {
  constructor(id,monkey,player,tick,random=Math.random,kind=null) {
    this.id=id;this.monkey=monkey;this.player=player;this.start=tick;this.expires=tick+C.sessionTicks;
    this.kind=kind??MONKEY_GAMES[Math.floor(random()*MONKEY_GAMES.length)];
    this.progress=0;this.matched=new Set();this.open=[];this.hideAt=0;
    if(this.kind==='simon') {
      this.sequence=Array.from({length:C.simonLength},()=>random()<0.5?'jump':'crouch');
      this.ready=tick+(this.sequence.length+1)*C.simonStepTicks;
    } else if(this.kind==='memory') {
      this.cards=Array.from({length:C.cardPairs*2},(_,i)=>i%C.cardPairs);
      for(let i=this.cards.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[this.cards[i],this.cards[j]]=[this.cards[j],this.cards[i]];}
      this.ready=tick;
    } else {
      this.ball=Math.floor(random()*3);this.swaps=[];
      for(let i=0;i<C.cupSwaps;i++) {
        const a=Math.floor(random()*3),b=(a+1+Math.floor(random()*2))%3;
        this.swaps.push([a,b]);
      }
      this.finalBall=this.ball;
      for(const [a,b]of this.swaps)this.finalBall=this.finalBall===a?b:this.finalBall===b?a:this.finalBall;
      this.ready=tick+(C.cupSwaps+2)*C.cupSwapTicks;
    }
  }
  view(tick) {
    if(this.kind==='memory'&&this.hideAt&&tick>=this.hideAt){this.open=[];this.hideAt=0;}
    return {session:this.id,game:this.kind,waitMs:Math.max(0,this.ready-tick)*1000/TICK_RATE,
      progress:this.progress,stepMs:(this.kind==='simon'?C.simonStepTicks:C.cupSwapTicks)*1000/TICK_RATE,
      ...(this.kind==='simon'?{length:this.sequence.length}:this.kind==='cups'?{ball:this.ball,swaps:this.swaps}:
        {cards:this.cards.map((v,i)=>this.matched.has(i)||this.open.includes(i)?v:null),matched:[...this.matched],
          hideMs:this.hideAt?Math.max(0,this.hideAt-tick)*1000/TICK_RATE:0})};
  }
  action(action,value,tick) {
    if(tick>=this.expires)return 'expired';
    if(tick<this.ready)return 'waiting';
    if(this.kind==='simon') {
      if(action!=='simon'||!['jump','crouch'].includes(value))return 'invalid';
      if(value!==this.sequence[this.progress])return 'lost';
      return ++this.progress===this.sequence.length?'won':'playing';
    }
    if(this.kind==='cups') {
      if(action!=='cup'||!Number.isInteger(value)||value<0||value>2)return 'invalid';
      return value===this.finalBall?'won':'lost';
    }
    this.view(tick);
    if(action!=='card'||!Number.isInteger(value)||value<0||value>=this.cards.length
      ||this.matched.has(value)||this.open.includes(value)||this.hideAt)return 'invalid';
    this.open.push(value);
    if(this.open.length===2) {
      if(this.cards[this.open[0]]===this.cards[this.open[1]]) {
        for(const i of this.open)this.matched.add(i);this.open=[];this.progress++;
        if(this.matched.size===this.cards.length)return 'won';
      } else this.hideAt=tick+C.cardRevealTicks;
    }
    return 'playing';
  }
}
