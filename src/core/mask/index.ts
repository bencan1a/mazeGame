/** Public surface of the S1 mask stage. */

export type { Blob, BlobParams } from './blob.js';
export { generateBlob } from './blob.js';
export { largestComponent } from './components.js';
export { dilate, erode, morphologicalOpen } from './morphology.js';
export { fillHoles } from './holes.js';
export type { RepairOptions } from './repair.js';
export { MaskRepairError, repairMask } from './repair.js';
