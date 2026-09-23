// Inventory screen, in three modes. All show the 27-slot main grid and the
// hotbar row. Clicks go to the server, which moves the stacks and answers with
// the new inventory; nothing changes locally until then.
//   inventory (E):  a slowly turning preview of your player model, and the
//                   recipes you can afford right now that need no station
//   workbench:      the same, plus workbench recipes
//   furnace:        the furnace's input, fuel and output slots, a fuel flame
//                   and a smelting arrow, updated live by the server

import * as THREE from 'three';
import { HOTBAR_SIZE, INVENTORY_SIZE } from '/shared/config.js';
import { C2S } from '/shared/protocol.js';
import { getItemDef } from '/shared/items.js';
import { recipesAt, canAfford } from '/shared/recipes.js';
import { renderStack } from './itemIcon.js';
import { createPlayerModel, animatePlayer } from './render/models.js';

const PREVIEW_TURN_SPEED = 0.6;

export class InventoryScreen {
  constructor(conn) {
    this.conn = conn;
    this.cursorEl = document.getElementById('inv-cursor');
    this.recipeList = document.getElementById('inv-recipes');
    this.open = false;
    this.mode = 'inventory';
    // Block position of the workbench or furnace in use, or null.
    this.at = null;
    this.inventory = { slots: new Array(INVENTORY_SIZE).fill(null), cursor: null };

    // Slot elements by inventory index: hotbar row is 0-8, main grid 9-35.
    this.slotEls = [];
    const main = document.getElementById('inv-main');
    const hotbar = document.getElementById('inv-hotbar');
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.addEventListener('mousedown', (e) => {
        if (e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        this.conn.send({ type: C2S.INVENTORY_CLICK, slot: i, button: e.button === 2 ? 'right' : 'left' });
      });
      this.slotEls.push(slot);
    }
    main.append(...this.slotEls.slice(HOTBAR_SIZE));
    hotbar.append(...this.slotEls.slice(0, HOTBAR_SIZE));

    this.furnaceSlots = [...document.querySelectorAll('[data-furnace]')];
    this.furnaceSlots.forEach((slot, i) => slot.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this.conn.send({ type: C2S.INVENTORY_CLICK, container: 'furnace', slot: i, button: e.button === 2 ? 'right' : 'left' });
    }));
    this.flame = document.querySelector('.furnace .flame .fill');
    this.arrow = document.querySelector('.furnace-arrow .fill');

    document.getElementById('inventory').addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      this.cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });

    this.preview = null;
  }

  // Built on first open, once we know the player's color.
  createPreview(color) {
    const canvas = document.getElementById('inv-preview');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(0.5, 1, 0.8);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
    camera.position.set(0, 1.1, -4);
    camera.lookAt(0, 0.9, 0);
    const model = createPlayerModel({ color });
    scene.add(model);
    this.preview = { renderer, scene, camera, model };
  }

  // The caller shows and hides the #inventory screen element; these track state.
  // mode: 'inventory', 'workbench' or 'furnace'; at: the block for the last two.
  show(color, mode = 'inventory', at = null) {
    this.open = true;
    this.mode = mode;
    this.at = at;
    const furnace = mode === 'furnace';
    document.getElementById('inv-preview').hidden = furnace;
    document.querySelector('.inv-crafting').hidden = furnace;
    document.getElementById('inv-furnace').hidden = !furnace;
    document.getElementById('inv-crafting-title').textContent = mode === 'workbench' ? 'Workbench' : 'Crafting';
    if (furnace) this.setFurnace({ slots: [null, null, null], burn: 0, progress: 0 });
    if (!furnace && !this.preview) this.createPreview(color);
    this.update(this.inventory);
  }

  // view: { slots, burn, progress } from the server's FURNACE message.
  setFurnace(view) {
    this.furnaceSlots.forEach((el, i) => renderStack(el, view.slots[i]));
    this.flame.style.height = `${view.burn * 100}%`;
    this.arrow.style.width = `${view.progress * 100}%`;
  }

  // sendClose: tell the server (it puts the cursor stack back). Not needed when
  // the screen closes because we died; the server already emptied everything.
  hide(sendClose = true) {
    if (!this.open) return;
    this.open = false;
    if (sendClose) this.conn.send({ type: C2S.INVENTORY_CLOSE });
  }

  // inventory: { slots, cursor } from the server.
  update(inventory) {
    this.inventory = inventory;
    this.slotEls.forEach((el, i) => renderStack(el, inventory.slots[i]));
    renderStack(this.cursorEl, inventory.cursor);

    // Only what you can make right now here; rebuilt on every inventory change.
    const station = this.mode === 'workbench' ? 'workbench' : null;
    this.recipeList.replaceChildren(...recipesAt(station).filter((r) => canAfford(r, inventory.slots)).map((recipe) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const out = document.createElement('div');
      out.className = 'slot';
      renderStack(out, { item: recipe.output, count: recipe.count });
      const text = document.createElement('div');
      text.className = 'recipe-text';
      const name = document.createElement('strong');
      name.textContent = getItemDef(recipe.output).name;
      const cost = document.createElement('span');
      cost.textContent = recipe.inputs.map(({ item, count }) => `${count} ${getItemDef(item).name}`).join(' + ');
      text.append(name, cost);
      button.append(out, text);
      // Workbench recipes are checked against the workbench's position.
      button.addEventListener('click', () => this.conn.send({ type: C2S.CRAFT, recipe: recipe.id, at: this.at }));
      li.append(button);
      return li;
    }));
    if (!this.recipeList.children.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'Nothing you can craft yet.';
      this.recipeList.append(li);
    }
  }

  // Per frame while open: turn the preview and show what's in hand.
  render(dt, held) {
    if (!this.open || !this.preview || this.mode === 'furnace') return;
    const { renderer, scene, camera, model } = this.preview;
    // The canvas scales with the window; keep the drawing buffer matching it.
    const canvas = renderer.domElement;
    if (canvas.width !== Math.floor(canvas.clientWidth * renderer.getPixelRatio())) {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }
    model.rotation.y += dt * PREVIEW_TURN_SPEED;
    animatePlayer(model, { dt, speed: 0, pitch: 0, held });
    renderer.render(scene, camera);
  }
}
