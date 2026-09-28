// Rebuilt once per authoritative tick. Callers reuse their result arrays.
export class SpatialHash {
  constructor(cell=8){this.cell=cell;this.cells=new Map();this.pool=[];}
  insert(e) {
    if(e.dead)return;const s=e.state ?? e,cx=Math.floor(s.x/this.cell),cz=Math.floor(s.z/this.cell),key=`${cx},${cz}`;
    let list=this.cells.get(key);if(!list){list=this.pool.pop() ?? [];list.cx=cx;list.cz=cz;this.cells.set(key,list);}list.push(e);
  }
  rebuild(entities) {
    for(const list of this.cells.values()){list.length=0;this.pool.push(list);}this.cells.clear();
    for(const e of entities) {
      this.insert(e);
    }
  }
  query(p,radius,result=[]) {
    result.length=0;const c=this.cell;
    const x0=Math.floor((p.x-radius)/c),x1=Math.floor((p.x+radius)/c),z0=Math.floor((p.z-radius)/c),z1=Math.floor((p.z+radius)/c);
    if((x1-x0+1)*(z1-z0+1)>this.cells.size*2) {
      for(const list of this.cells.values())if(list.cx>=x0 && list.cx<=x1 && list.cz>=z0 && list.cz<=z1)
        for(const e of list){const s=e.state ?? e;if(Math.hypot(s.x-p.x,s.z-p.z)<=radius)result.push(e);}
      return result;
    }
    for(let z=Math.floor((p.z-radius)/c);z<=Math.floor((p.z+radius)/c);z++)for(let x=Math.floor((p.x-radius)/c);x<=Math.floor((p.x+radius)/c);x++)
      for(const e of this.cells.get(`${x},${z}`) ?? []){const s=e.state ?? e;if(Math.hypot(s.x-p.x,s.z-p.z)<=radius)result.push(e);}
    return result;
  }
}
