import { MONKEY_WORK as C } from './config.js';

export const MONKEY_ROLES=['idle','collector','courier','lumberjack'];
export const MONKEY_NAMES=['Mango','Pip','Coco','Bongo','Peanut','Nori','Mochi','Fig',
  'Tiki','Basil','Maple','Bean','Kiki','Otis','Ziggy','Juniper','Milo','Poppy','Rolo','Chai'];
export const MONKEY_GAMES=['simon','memory','cups'];
export const defaultMonkeyConfig=()=>({role:'idle',target:null,from:null,to:null,home:null,
  radius:C.defaultRadius,vertical:C.maxVertical,sites:[],filter:{mode:'blacklist',items:[]}});
export function monkeyFilter(config,item) {
  const included=config.filter.items.includes(item);
  return config.filter.mode==='whitelist'?included:!included;
}
export function monkeyRange(config,p) {
  const t=config.target;
  return !!t&&Math.hypot(p.x-t.x,p.z-t.z)<=config.radius&&Math.abs(p.y-t.y)<=config.vertical;
}
