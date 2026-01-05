const tabs = document.querySelectorAll('[role="tab"]');
const panels = document.querySelectorAll('[role="tabpanel"]');
const paletteList = document.getElementById('palette-list');
const patternCanvas = document.getElementById('pattern-canvas');
const patternCtx = patternCanvas ? patternCanvas.getContext('2d') : null;
const rowInput = document.getElementById('row-input');
const rowMinus = document.getElementById('row-minus');
const rowPlus = document.getElementById('row-plus');
const rowView = document.querySelector('.row-view');

let currentGrid = null;
let currentPalette = null;
let maxRow = 1;

const getInitials = (name) => {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase();
};

const createSwatch = (hex, name, options = {}) => {
  const {
    className = 'swatch',
    showInitials = false,
    size = null
  } = options;

  const swatch = document.createElement('div');
  swatch.className = className;
  swatch.style.backgroundColor = hex;
  swatch.title = name;
  swatch.setAttribute('aria-label', name);
  
  if (size) {
    swatch.style.width = `${size}px`;
    swatch.style.height = `${size}px`;
  }
  
  if (showInitials) {
    swatch.textContent = getInitials(name);
  }
  
  return swatch;
};

const setActiveTab = (targetId) => {
  tabs.forEach((tab) => {
    const isActive = tab.id === targetId;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  panels.forEach((panel) => {
    const isActive = panel.getAttribute('aria-labelledby') === targetId;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });
};

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.id));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const currentIndex = Array.from(tabs).indexOf(tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = tabs[(currentIndex + delta + tabs.length) % tabs.length];
    nextTab.focus();
    setActiveTab(nextTab.id);
  });
});

// Ensure initial tab state is synced after hydration or DOM updates.
setActiveTab('tab-row-by-row');

const loadPattern = async () => {
  const response = await fetch('pattern.json');
  if (!response.ok) {
    throw new Error(`Failed to load pattern: ${response.status}`);
  }
  return response.json();
};

const renderPalette = (colors) => {
  if (!paletteList) return;
  paletteList.innerHTML = '';

  const fragment = document.createDocumentFragment();
  Object.entries(colors || {}).forEach(([hex, name]) => {
    const item = document.createElement('div');
    item.className = 'palette-item';

    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.backgroundColor = hex;
    swatch.title = name;
    swatch.setAttribute('aria-label', name);

    const label = document.createElement('div');
    label.className = 'palette-label';
    label.textContent = name;

    item.append(swatch, label);
    fragment.append(item);
  });

  paletteList.append(fragment);
};

const renderRowColors = (rowIndex, grid, palette) => {
  if (!rowView || !grid || !palette) return;
  
  const row = grid[grid.length - rowIndex];
  if (!row) return;

  // Get unique colors in this row
  const uniqueHexes = [...new Set(row)];
  
  // Sort by palette order (order in which they appear in the palette object)
  const paletteOrder = Object.keys(palette);
  uniqueHexes.sort((a, b) => {
    return paletteOrder.indexOf(a) - paletteOrder.indexOf(b);
  });

  // Create title
  const title = document.createElement('h2');
  title.className = 'row-colors-title';
  title.textContent = 'Colours in this row';

  // Create unique colors section
  const uniqueContainer = document.createElement('div');
  uniqueContainer.className = 'row-colors';

  uniqueHexes.forEach(hex => {
    const name = palette[hex];
    const panel = document.createElement('div');
    panel.className = 'row-color-panel';

    const swatch = createSwatch(hex, name, { 
      className: 'row-color-swatch',
      showInitials: true 
    });

    const label = document.createElement('div');
    label.className = 'row-color-label';
    label.textContent = name;

    panel.append(swatch, label);
    uniqueContainer.append(panel);
  });

  // Create row sequence section
  const sequenceTitle = document.createElement('h2');
  sequenceTitle.className = 'row-colors-title';
  sequenceTitle.textContent = 'Row sequence';

  const sequenceContainer = document.createElement('div');
  sequenceContainer.className = 'row-sequence';

  // Group into sets of 10
  for (let i = 0; i < row.length; i += 10) {
    const chunk = row.slice(i, i + 10);
    const start = i + 1;
    const end = Math.min(i + 10, row.length);

    const groupHeader = document.createElement('h3');
    groupHeader.className = 'row-sequence-header';
    groupHeader.textContent = `${start}-${end}`;

    const groupSwatches = document.createElement('div');
    groupSwatches.className = 'row-sequence-swatches';

    chunk.forEach(hex => {
      const name = palette[hex];
      const swatch = createSwatch(hex, name, { 
        className: 'row-sequence-swatch',
        showInitials: true,
        size: 40
      });
      groupSwatches.append(swatch);
    });

    const group = document.createElement('div');
    group.className = 'row-sequence-group';
    group.append(groupHeader, groupSwatches);
    
    sequenceContainer.append(group);
  }

  rowView.innerHTML = '';
  rowView.append(title, uniqueContainer, sequenceTitle, sequenceContainer);
};

// --- Image -> grid helpers ---
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  return [
    (bigint >> 16) & 255,
    (bigint >> 8) & 255,
    bigint & 255,
  ];
};

const colorDistanceSq = (a, b) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

const buildGridFromImage = (img, paletteMap) => {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0);
  const { data } = octx.getImageData(0, 0, w, h);

  const grid = new Array(h);
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      const rgb = [r, g, b];

      // Map to nearest palette color by Euclidean distance in RGB.
      let bestKey = null;
      let bestDist = Infinity;
      for (const { hex, rgb: prgb } of paletteMap) {
        const d = colorDistanceSq(rgb, prgb);
        if (d < bestDist) {
          bestDist = d;
          bestKey = hex;
        }
      }
      row[x] = bestKey;
    }
    grid[y] = row;
  }
  return grid;
};

const renderGrid = (grid, palette) => {
  if (!patternCanvas || !patternCtx || !grid?.length) return;
  const cell = 16;
  const height = grid.length;
  const width = grid[0].length;
  patternCanvas.width = width * cell;
  patternCanvas.height = height * cell;
  patternCtx.imageSmoothingEnabled = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hexColor = grid[y][x];
      if (!hexColor) continue;
      patternCtx.fillStyle = hexColor;
      patternCtx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
};

const bootstrapPattern = async () => {
  try {
    // 1) Load palette
    const pattern = await loadPattern();
    const palette = pattern.colors || {};
    currentPalette = palette;
    renderPalette(palette);

    // 2) Prepare palette map for nearest-color search
    const paletteMap = Object.entries(palette).map(([hex, name]) => ({
      hex,
      rgb: hexToRgb(hex),
    }));

    // 3) Load image and build grid
    const img = await loadImage('pattern.png');
    const grid = buildGridFromImage(img, paletteMap);
    currentGrid = grid;

    // 4) Render grid as 16x16 colored tiles
    renderGrid(grid, palette);

    // 5) Setup row selector
    if (rowInput && grid?.length) {
      maxRow = grid.length;
      rowInput.value = 1;
      renderRowColors(1, grid, palette);
    }
  } catch (error) {
    console.error('Bootstrap pattern failed:', error);
  }
};

if (rowInput && rowMinus && rowPlus) {
  const updateRow = (newRow) => {
    const row = Math.max(1, Math.min(maxRow, newRow));
    rowInput.value = row;
    renderRowColors(row, currentGrid, currentPalette);
  };

  rowInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = parseInt(rowInput.value, 10);
      if (!isNaN(value) && value >= 1 && value <= maxRow) {
        updateRow(value);
      } else {
        // Reset to current valid value
        const current = parseInt(rowInput.value, 10);
        rowInput.value = isNaN(current) ? 1 : Math.max(1, Math.min(maxRow, current));
      }
      rowInput.blur();
    }
  });

  rowInput.addEventListener('blur', () => {
    const value = parseInt(rowInput.value, 10);
    if (!isNaN(value) && value >= 1 && value <= maxRow) {
      updateRow(value);
    } else {
      // Reset to last valid value
      updateRow(1);
    }
  });

  rowMinus.addEventListener('click', () => {
    const current = parseInt(rowInput.value, 10) || 1;
    updateRow(current - 1);
  });

  rowPlus.addEventListener('click', () => {
    const current = parseInt(rowInput.value, 10) || 1;
    updateRow(current + 1);
  });
}

window.addEventListener('DOMContentLoaded', bootstrapPattern);
