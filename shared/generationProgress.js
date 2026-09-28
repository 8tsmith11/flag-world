import { GENERATION_PROGRESS as C } from './config.js';
// Algorithms may retry a site. Public progress always moves forwards and
// exposes only one percentage, never construction stages or attempt details.
export function generationProgress(report) {
  let previous=0;
  return (stage,detail={})=>{
    const [start,end]=C[stage]??[previous,previous];
    const fraction=detail.total?Math.max(0,Math.min(1,detail.completed/detail.total)):0;
    previous=Math.max(previous,start+(end-start)*fraction);
    report(Math.min(100,previous));
  };
}
