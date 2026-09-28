// Reused box outlines and break overlays also fit neighbour-shaped branches.
import * as THREE from 'three';
const SIZE=1.004, MAX_BREAK_OPACITY=0.6;
const CUBE=[[0,0,0,1,1,1]];
export class BlockHighlight {
  constructor(scene) {
    this.mesh=new THREE.Group();this.overlay=new THREE.Group();
    const edges=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1));
    const lines=new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:0.6});
    const overlay=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,depthWrite:false});
    const cube=new THREE.BoxGeometry(1,1,1);
    // Core and six arms: all geometry/materials are shared and created once.
    for(let i=0;i<7;i++){this.mesh.add(new THREE.LineSegments(edges,lines));this.overlay.add(new THREE.Mesh(cube,overlay));}
    this.mesh.visible=this.overlay.visible=false;scene.add(this.mesh,this.overlay);
  }
  update(target,progress=0) {
    this.mesh.visible=!!target;this.overlay.visible=!!target&&progress>0;if(!target)return;
    const boxes=target.boxes??CUBE;
    this.mesh.position.set(target.x,target.y,target.z);this.overlay.position.copy(this.mesh.position);
    for(let i=0;i<7;i++) {
      const line=this.mesh.children[i],overlay=this.overlay.children[i],box=boxes[i];
      line.visible=overlay.visible=!!box;if(!box)continue;
      line.position.set((box[0]+box[3])/2,(box[1]+box[4])/2,(box[2]+box[5])/2);
      line.scale.set(box[3]-box[0]+SIZE-1,box[4]-box[1]+SIZE-1,box[5]-box[2]+SIZE-1);
      overlay.position.copy(line.position);overlay.scale.copy(line.scale);overlay.material.opacity=progress*MAX_BREAK_OPACITY;
    }
  }
}
