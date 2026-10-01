// Port ordering shared by simulation and input validation.
export const FLUID_FACES = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
export const fluidFace = (x,y,z) => FLUID_FACES.findIndex(([a,b,c]) => a===x&&b===y&&c===z);
export const oppositeFluidFace = face => face ^ 1;
export const configurableFluidFaces = kind => kind === 'pipe';
