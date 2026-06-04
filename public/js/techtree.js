// ==========================================================================
// Pronet — Professional Tech Tree (visual, gamified resume)
// Pure front-end: mock node data, absolutely-positioned squircle nodes, SVG
// connectors drawn between them, and a Bento-Box modal of projects per node.
// ==========================================================================
(function () {
  const container = document.getElementById('tech-tree-container');
  if (!container) return;

  // ---- Mock data (id, title, type, unlocked, projects + layout coords) ----
  const techTreeData = [
    {
      id: 'node-1', title: 'Software Engineer', type: 'base', unlocked: true,
      x: 40, y: 200, parents: [],
      projects: [
        { name: 'App V1', desc: 'Shipped the first production release end-to-end.' },
        { name: 'Realtime SSE Bus', desc: 'Built the live presence + messaging backbone.' },
      ],
    },
    {
      id: 'node-2', title: 'Full-Stack Dev', type: 'specialized', unlocked: true,
      x: 240, y: 60, parents: ['node-1'],
      projects: [
        { name: 'Pronet', desc: 'Vanilla JS + Express + Postgres networking app.' },
      ],
    },
    {
      id: 'node-3', title: 'WebRTC Engineer', type: 'specialized', unlocked: true,
      x: 240, y: 340, parents: ['node-1'],
      projects: [
        { name: '1:1 Calls', desc: 'Peer-to-peer audio/video with camera flip.' },
      ],
    },
    {
      id: 'node-4', title: 'LLM Researcher', type: 'specialized', unlocked: false,
      x: 460, y: 60, parents: ['node-2'],
      projects: [],
    },
    {
      id: 'node-5', title: 'Platform Architect', type: 'mastery', unlocked: false,
      x: 460, y: 340, parents: ['node-3'],
      projects: [],
    },
  ];

  const NODE = 128; // 8rem
  const byId = Object.fromEntries(techTreeData.map(n => [n.id, n]));

  // Size the canvas to fit the furthest node.
  const maxX = Math.max(...techTreeData.map(n => n.x)) + NODE + 40;
  const maxY = Math.max(...techTreeData.map(n => n.y)) + NODE + 40;
  container.style.minWidth = maxX + 'px';
  container.style.minHeight = Math.max(500, maxY) + 'px';

  // ---- SVG connectors (drawn first, behind nodes) ----
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'tt-svg');
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', Math.max(500, maxY));
  techTreeData.forEach(n => {
    n.parents.forEach(pid => {
      const p = byId[pid];
      if (!p) return;
      const x1 = p.x + NODE / 2, y1 = p.y + NODE / 2;
      const x2 = n.x + NODE / 2, y2 = n.y + NODE / 2;
      const path = document.createElementNS(svgNS, 'path');
      const midX = (x1 + x2) / 2;
      path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', 'tt-link' + (n.unlocked ? ' active' : ''));
      svg.appendChild(path);
    });
  });
  container.appendChild(svg);

  // ---- Nodes ----
  techTreeData.forEach(n => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'tt-node ' + (n.unlocked ? 'unlocked' : 'locked');
    node.style.left = n.x + 'px';
    node.style.top = n.y + 'px';
    node.innerHTML = `
      <span class="tt-icon">${n.unlocked ? (n.type === 'mastery' ? '★' : '◆') : '🔒'}</span>
      <span class="tt-title">${escapeHTML(n.title)}</span>`;
    node.addEventListener('click', () => openNode(n));
    container.appendChild(node);
  });

  // ---- Modal ----
  let modal = null;
  function openNode(n) {
    closeModal();
    modal = document.createElement('div');
    modal.className = 'tt-modal';
    const locked = !n.unlocked;
    const projHTML = locked
      ? `<p class="tt-locked-msg">🔒 This skill isn't unlocked yet. Keep building to reveal it.</p>`
      : (n.projects.length
          ? n.projects.map(p => `
              <div class="tt-proj">
                <div class="tt-proj-name">${escapeHTML(p.name)}</div>
                <div class="tt-proj-desc">${escapeHTML(p.desc)}</div>
              </div>`).join('')
          : `<p class="tt-locked-msg">No projects logged here yet.</p>`);
    modal.innerHTML = `
      <div class="tt-modal-card card" role="dialog" aria-modal="true">
        <button type="button" class="tt-modal-close" aria-label="Close">✕</button>
        <div class="tt-modal-head">
          <span class="tt-badge ${locked ? 'locked' : 'unlocked'}">${locked ? 'Locked' : n.type}</span>
          <h3>${escapeHTML(n.title)}</h3>
        </div>
        <div class="tt-modal-body">${projHTML}</div>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    modal.querySelector('.tt-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', onEsc);
  }
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    if (!modal) return;
    document.removeEventListener('keydown', onEsc);
    modal.remove();
    modal = null;
  }
})();
