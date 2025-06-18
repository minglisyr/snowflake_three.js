import * as THREE from 'three';
import { GUI } from 'lil-gui';

// ====== PARAMETERS ======
const params = {
  gridSize: 61, // (odd integer) Size of the hexagonal grid; controls the "radius" of the simulated snowflake.

  // --- Environment and Growth Parameters ---

  beta: 1.3,    // Threshold for boundary mass needed for a cell to attach (become ice). Higher = slower, denser growth.
  theta: 0.025, // Threshold for the sum of diffusive mass (cell + neighbors) below which attachment can occur with less boundary mass.
  alpha: 0.08,  // Lower threshold for boundary mass required for attachment in certain neighbor configurations.

  kappa: 0.003,     // Fraction of diffusive mass that freezes directly to crystal at each step (freezing rate).
  mu: 0.07,         // Fraction of boundary mass that melts back into diffusive mass at each step (melting rate).
  upsilon: 0.00005, // Fraction of crystal mass that melts back into diffusive mass at each step (very small, keeps edges dynamic).
  sigma: 0.00001,   // Amplitude of random noise added to diffusive mass (controls irregularity and asymmetry).
  gamma: 0.5,       // Initial diffusive mass for each cell (analogous to ambient humidity or vapor supply).

  // --- Simulation Controls ---
  step: () => stepLattice(),    // Function to advance the simulation by one step.
  reset: () => resetLattice(),  // Function to reset the simulation to the initial state.
  autoGrow: false,              // If true, simulation steps automatically (animation).
  stepsPerFrame: 5,             // Number of simulation steps to perform per animation frame (for speed).
  canvasScale: 0.3,             // Scale factor for the hexagonal grid in the visualization (affects size of cells).
};

// ====== HEXAGONAL GRID HELPERS ======
const HEX_DX = [1, 0, -1, -1, 0, 1];
const HEX_DY = [0, 1, 1, 0, -1, -1];

// Converts axial (q, r) to pixel (x, y)
function hexToPixel(q, r, size) {
  const x = size * 3/2 * q;
  const y = size* Math.sqrt(3) * (r + q/2);
  return [x, y];
}

// ====== SNOWFLAKE CELL CLASS ======
class SnowflakeCell {
  constructor(q, r, lattice) {
    this.q = q;
    this.r = r;
    this.lattice = lattice;
    this.diffusiveMass = params.gamma;
    this.boundaryMass = 0;
    this.crystalMass = 0;
    this.attached = false;
    this.boundary = false;
    this.age = 0;
    this._neighbors = null;
    this.attachmentFlag = false;
  }
  get neighbors() {
    if (!this._neighbors) {
      this._neighbors = [];
      for (let d = 0; d < 6; d++) {
        const nq = this.q + HEX_DX[d];
        const nr = this.r + HEX_DY[d];
        const n = this.lattice.get(nq, nr);
        if (n) this._neighbors.push(n);
      }
    }
    return this._neighbors;
  }
  updateBoundary() {
    this.boundary = !this.attached && this.neighbors.some(n => n.attached);
  }
  stepOne() {
    this.updateBoundary();
    if (this.boundary) {
      this.attachedNeighbors = this.neighbors.filter(n => n.attached);
    }
    this._next_dm = this.diffusionCalc();
  }
  stepTwo() {
    this.diffusiveMass = this._next_dm;
    this.attachmentFlag = this.attached;
    this.freezingStep();
    this.attachmentFlag = this.attachmentStep();
    this.meltingStep();
  }
  stepThree() {
    if (this.boundary && this.attachmentFlag) {
      this.attach();
    }
    this.noiseStep();
  }
  diffusionCalc() {
    if (this.attached) return this.diffusiveMass;
    this.age += 1;
    let next_dm = this.diffusiveMass;
    for (const n of this.neighbors) {
      next_dm += n.attached ? this.diffusiveMass : n.diffusiveMass;
    }
    return next_dm / (this.neighbors.length + 1);
  }
  freezingStep() {
    if (!this.boundary) return;
    this.boundaryMass += (1 - params.kappa) * this.diffusiveMass;
    this.crystalMass += params.kappa * this.diffusiveMass;
    this.diffusiveMass = 0;
  }
  meltingStep() {
    if (!this.boundary) return;
    this.diffusiveMass += params.mu * this.boundaryMass + params.upsilon * this.crystalMass;
    this.boundaryMass *= (1 - params.mu);
    this.crystalMass *= (1 - params.upsilon);
  }
  noiseStep() {
    if (this.attached) return;
    this.diffusiveMass += (Math.random() - 0.5) * params.sigma * 2;
    this.diffusiveMass = Math.max(0, this.diffusiveMass);
  }
  attachmentStep() {
    if (!this.boundary) return false;
    const attachedCount = this.attachedNeighbors.length;
    if (attachedCount <= 2) {
      if (this.boundaryMass > params.beta) return true;
    } else if (attachedCount === 3) {
      if (this.boundaryMass >= 1) return true;
      let summedDiff = this.diffusiveMass;
      for (const n of this.neighbors) summedDiff += n.diffusiveMass;
      if (summedDiff < params.theta && this.boundaryMass >= params.alpha) return true;
    }
    return false;
  }
  attach() {
    this.crystalMass += this.boundaryMass;
    this.boundaryMass = 0;
    this.attached = true;
  }
}

let currentStep = 0;

const stepCounter = document.createElement('div');
stepCounter.style.position = 'absolute';
stepCounter.style.top = '0';
stepCounter.style.left = '0';
stepCounter.style.padding = '8px 16px';
stepCounter.style.background = 'rgba(0,0,0,0.5)';
stepCounter.style.color = '#fff';
stepCounter.style.font = 'bold 18px monospace';
stepCounter.style.zIndex = 100;
stepCounter.textContent = 'Step: 0';
document.body.appendChild(stepCounter);

// ====== CRYSTAL LATTICE CLASS ======
class CrystalLattice {
  constructor(size) {
    this.size = size;
    this.cells = new Map(); // key: `${q},${r}` => cell
    // Fill grid with cells
    for (let q = -size; q <= size; q++) {
      for (let r = -size; r <= size; r++) {
        if (Math.abs(q + r) > size) continue;
        this.cells.set(`${q},${r}`, new SnowflakeCell(q, r, this));
      }
    }
    // Attach center cell
    this.get(0, 0).attached = true;
  }
  get(q, r) {
    return this.cells.get(`${q},${r}`);
  }
  step() {
    for (const cell of this.cells.values()) cell.stepOne();
    for (const cell of this.cells.values()) cell.stepTwo();
    for (const cell of this.cells.values()) cell.stepThree();
  }
  attachedCells() {
    return Array.from(this.cells.values()).filter(c => c.attached);
  }
  boundaryCells() {
    return Array.from(this.cells.values()).filter(c => c.boundary && !c.attached);
  }
}

// ====== THREE.JS SETUP ======
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-40, 40, 40, -40, 1, 1000);
camera.position.set(0, 0, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x222233);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ====== LATTICE AND VISUALIZATION ======
let lattice, group;

function resetLattice() {

  // Reset the step counter
  currentStep = 0;
  stepCounter.textContent = 'Step: 0';

  if (group) scene.remove(group);
  lattice = new CrystalLattice(Math.floor(params.gridSize/2));
  group = new THREE.Group();
  scene.add(group);
  drawLattice(params.canvasScale);
}

function drawLattice(canvasScale = params.canvasScale) {
  group.clear();
  const cellSize = canvasScale;
  // Draw attached cells
  for (const cell of lattice.attachedCells()) {
    const [x, y] = hexToPixel(cell.q, cell.r, cellSize);
    const hex = new THREE.Mesh(
      new THREE.CircleGeometry(cellSize * 0.95, 6),
      new THREE.MeshBasicMaterial({ color: 0x99ccff })
    );
    hex.position.set(x, y, 0);
    group.add(hex);
  }
  // Draw boundary cells
  for (const cell of lattice.boundaryCells()) {
    const [x, y] = hexToPixel(cell.q, cell.r, cellSize);
    const hex = new THREE.Mesh(
      new THREE.CircleGeometry(cellSize * 0.95, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc99 })
    );
    hex.position.set(x, y, 0.1);
    group.add(hex);
  }
}

// ====== GUI ======
const gui = new GUI();
gui.add(params, 'gridSize', 21, 101, 2).name('Grid Size').onChange(resetLattice);
gui.add(params, 'beta', 1.0, 3.0, 0.01).onFinishChange(resetLattice);
gui.add(params, 'theta', 0.01, 0.1, 0.001).onFinishChange(resetLattice);
gui.add(params, 'alpha', 0.01, 0.2, 0.001).onFinishChange(resetLattice);
gui.add(params, 'kappa', 0.0005, 0.01, 0.0001).onFinishChange(resetLattice);
gui.add(params, 'mu', 0.01, 0.2, 0.001).onFinishChange(resetLattice);
gui.add(params, 'upsilon', 0.00001, 0.001, 0.00001).onFinishChange(resetLattice);
gui.add(params, 'sigma', 0.000001, 0.001, 0.000001).onFinishChange(resetLattice);
gui.add(params, 'gamma', 0.1, 1.0, 0.01).onFinishChange(resetLattice);
gui.add(params, 'stepsPerFrame', 5, 20, 1).name('Steps/Frame');
gui.add(params, 'canvasScale', 0.1, 1.0, 0.01).name('Canvas Scale').onChange(() => drawLattice(params.canvasScale));
gui.add(params, 'autoGrow').name('Auto Grow');
gui.add(params, 'step').name('Step Once');
gui.add(params, 'reset').name('Reset');

resetLattice();

// ====== MAIN LOOP ======
function stepLattice() {
  for (let i = 0; i < params.stepsPerFrame; i++) {
    lattice.step();
    currentStep++;
  }
  stepCounter.textContent = `Step: ${currentStep}`;
  drawLattice();
}

function animate() {
  requestAnimationFrame(animate);
  if (params.autoGrow) stepLattice();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});
