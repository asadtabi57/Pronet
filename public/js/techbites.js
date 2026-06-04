// ==========================================================================
// Pronet — Tech Bites (hyper-local Lahore meetup spots)
// Pure front-end: a fixed local dataset rendered into Bento-Box cards.
// ==========================================================================
(function () {
  const gridEl = document.getElementById('tech-bites-grid');
  if (!gridEl) return;

  const techBites = [
    { name: 'Spread', vibe: 'Quick Coffee / Collab', location: 'Lahore', proteinPick: 'Greek Yogurt Bowl (approx. 20g Protein)', imagePlaceholder: '/spread.jpg' },
    { name: 'The Last Tribe (TLT)', vibe: 'Evening Networking Rooftop', location: 'Lahore', proteinPick: 'Grilled Chicken Platter (approx. 50g Protein)', imagePlaceholder: '/tlt.jpg' },
    { name: 'Shafi Tikka Shop', vibe: 'High-Protein BBQ Meetup', location: 'Lahore', proteinPick: '250g Chicken Breast (approx. 75g Protein)', imagePlaceholder: '/shafi.jpg' },
  ];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  gridEl.innerHTML = techBites.map(b => `
    <article class="bite-card">
      <div class="bite-img" style="background-image:url('${esc(b.imagePlaceholder)}')">
        <span class="bite-loc">📍 ${esc(b.location)}</span>
      </div>
      <h3 class="bite-title">${esc(b.name)}</h3>
      <p class="bite-vibe">${esc(b.vibe)}</p>
      <span class="bite-pill">🥩 ${esc(b.proteinPick)}</span>
    </article>
  `).join('');
})();
