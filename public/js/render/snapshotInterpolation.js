// Delay matches server distance cadence. Flight is never a distance teleport.
export function resetSnapshots(previous,snapshot,type) {
  return !!previous && (previous.dead!==!!snapshot.dead || type==='player'
    && Math.hypot(previous.x-snapshot.x,previous.y-snapshot.y,previous.z-snapshot.z)>8);
}
export function sampleSnapshots(snapshots,now) {
  const delay=Math.max(100,(snapshots.at(-1).u ?? 1)*50+50),time=now-delay;
  let i=snapshots.length-1;while(i>0 && snapshots[i-1].time>time)i--;
  const b=snapshots[i],a=snapshots[Math.max(0,i-1)];
  const t=b.time===a.time?1:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  return {a,b,t};
}
