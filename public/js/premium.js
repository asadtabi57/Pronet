(async function () {
  if (!requireAuth()) return;
  await renderNav('premium');

  async function refresh() {
    const [{ plans }, { subscription }, { payments }] = await Promise.all([
      api('/api/payments/plans'),
      api('/api/subscriptions/me'),
      api('/api/payments/history'),
    ]);

    const status = document.getElementById('sub-status');
    if (subscription && !subscription.cancelled_at) {
      const end = new Date(subscription.current_period_end).toLocaleDateString();
      status.innerHTML = `
        <div class="sub-banner">
          <div>
            <h3>You're on ${escapeHTML(subscription.plan_name)} <span class="premium-badge">PREMIUM</span></h3>
            <p>Next billing date: ${end} · $${subscription.price}/mo</p>
          </div>
          <button class="btn-tiny ghost" id="cancel-sub">Cancel subscription</button>
        </div>`;
      document.getElementById('cancel-sub').onclick = async () => {
        if (!(await confirmDialog({ title: 'Cancel subscription?', message: 'Your premium benefits will end at the next billing date.', confirmText: 'Cancel subscription', cancelText: 'Keep' }))) return;
        await api('/api/subscriptions/cancel', { method: 'POST' });
        toast('Subscription cancelled'); refresh();
      };
    } else if (subscription && subscription.cancelled_at) {
      status.innerHTML = `<div class="sub-banner"><div><h3>Subscription cancelled</h3><p>Pick a new plan below to reactivate.</p></div></div>`;
    } else {
      status.innerHTML = '';
    }

    loadLeadDashboard(!!(subscription && !subscription.cancelled_at));

    const plansEl = document.getElementById('plans');
    plansEl.innerHTML = plans.map((p, i) => `
      <div class="plan-card ${i === 1 ? 'featured' : ''}">
        <h3>${escapeHTML(p.name)}</h3>
        <div class="price">$${p.price}<small>/month</small></div>
        <ul>${p.features.map(f => `<li>${escapeHTML(f)}</li>`).join('')}</ul>
        <button class="btn-fill" data-plan="${p.id}">${subscription && subscription.plan_id === p.id ? 'Current plan' : 'Choose ' + p.name}</button>
      </div>`).join('');
    plansEl.querySelectorAll('button[data-plan]').forEach(b => {
      b.onclick = () => openCheckout(plans.find(p => p.id === b.dataset.plan));
    });

    const histEl = document.getElementById('history');
    if (!payments.length) { histEl.innerHTML = '<p class="empty">No transactions yet.</p>'; return; }
    histEl.innerHTML = payments.map(t => {
      const methodLabel = t.method === 'card'
        ? `${t.brand || 'Card'} •••• ${t.last4 || '----'}`
        : (t.wallet ? `${t.wallet.provider.toUpperCase()} (${t.wallet.phone})` : t.method);
      return `
        <div class="txn-row">
          <div>
            <div><b>${escapeHTML(t.plan_id || '')}</b> — $${t.amount} ${t.currency}</div>
            <div style="color:var(--muted);font-size:12px">${methodLabel} · ${new Date(t.created_at).toLocaleString()}${t.gateway_id ? ' · ref ' + t.gateway_id : ''}</div>
          </div>
          <span class="status ${t.status}">${t.status}</span>
        </div>`;
    }).join('');
  }

  function openCheckout(plan) {
    let method = 'card';
    const body = `
      <div class="method-tabs" id="method-tabs">
        <div class="method-tab active" data-m="card">💳 Card</div>
        <div class="method-tab" data-m="easypaisa">📱 EasyPaisa</div>
        <div class="method-tab" data-m="sadapay">💚 SadaPay</div>
        <div class="method-tab" data-m="jazzcash">📲 JazzCash</div>
      </div>
      <div id="pay-card">
        <div class="brand-row"><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Discover</span></div>
        <div class="field"><label>Card number</label><input id="cc-num" placeholder="4242 4242 4242 4242" autocomplete="cc-number"/></div>
        <div class="card-input-row">
          <div class="field"><label>MM/YY</label><input id="cc-exp" placeholder="12/29" autocomplete="cc-exp"/></div>
          <div class="field"><label>CVC</label><input id="cc-cvc" placeholder="123" autocomplete="cc-csc"/></div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0">Sandbox mode: test with <code>4242 4242 4242 4242</code>. Use <code>4000 0000 0000 0002</code> to simulate a decline.</p>
      </div>
      <div id="pay-wallet" style="display:none">
        <div class="field"><label>Wallet phone number</label><input id="w-phone" placeholder="+92 300 1234567"/></div>
        <button class="btn-tiny" id="w-send-otp">Send OTP</button>
        <div class="field" style="margin-top:12px"><label>6-digit OTP</label><input id="w-otp" placeholder="123456" maxlength="6"/></div>
        <p style="font-size:12px;color:var(--muted);margin:0">Demo: OTP appears here when you click "Send OTP" (no SMS gateway configured).</p>
        <p id="w-otp-display" style="font-size:13px;margin:8px 0 0;color:var(--green)"></p>
      </div>
      <p id="pay-error" class="error"></p>
      <p style="margin:14px 0 0;font-size:14px"><b>Total: $${plan.price} ${plan.currency}</b> — billed monthly</p>`;
    const footer = `<button class="btn-fill" id="pay-confirm">Pay $${plan.price}</button>`;
    const m = openModal({ title: `Subscribe — ${plan.name}`, body, footer });

    const tabs = m.el.querySelector('#method-tabs');
    const cardBox = m.el.querySelector('#pay-card');
    const walletBox = m.el.querySelector('#pay-wallet');
    tabs.querySelectorAll('.method-tab').forEach(t => {
      t.onclick = () => {
        tabs.querySelectorAll('.method-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        method = t.dataset.m;
        cardBox.style.display = method === 'card' ? 'block' : 'none';
        walletBox.style.display = method === 'card' ? 'none' : 'block';
      };
    });

    m.el.querySelector('#w-send-otp').onclick = async () => {
      const phone = m.el.querySelector('#w-phone').value.trim();
      const err = m.el.querySelector('#pay-error'); err.textContent = '';
      try {
        const r = await api('/api/payments/wallet/initiate', { method: 'POST', body: { method, phone } });
        m.el.querySelector('#w-otp-display').textContent = `✓ ${r.message}  OTP: ${r.otp_demo}`;
      } catch (e) { err.textContent = e.message; }
    };

    m.el.querySelector('#pay-confirm').onclick = async () => {
      const err = m.el.querySelector('#pay-error'); err.textContent = '';
      const body = { plan_id: plan.id, method };
      if (method === 'card') {
        const num = m.el.querySelector('#cc-num').value.trim();
        const exp = m.el.querySelector('#cc-exp').value.trim();
        const cvc = m.el.querySelector('#cc-cvc').value.trim();
        const [mm, yy] = exp.split('/').map(s => s.trim());
        if (!num || !mm || !yy || !cvc) { err.textContent = 'Enter all card details'; return; }
        body.card = { number: num, exp_month: +mm, exp_year: +('20' + yy.slice(-2)), cvc };
      } else {
        const phone = m.el.querySelector('#w-phone').value.trim();
        const otp = m.el.querySelector('#w-otp').value.trim();
        if (!phone || !otp) { err.textContent = 'Enter phone and OTP'; return; }
        body.wallet = { phone, otp };
      }
      try {
        const r = await api('/api/payments/charge', { method: 'POST', body });
        m.close();
        toast(`✓ Payment ${r.transaction.status}. You're on ${r.subscription.plan_name}!`);
        refresh();
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ✨ AI Lead Signals — premium-only dashboard of high-intent prospects.
  async function loadLeadDashboard(isPremium) {
    const box = document.getElementById('lead-dashboard');
    if (!box) return;
    box.innerHTML = '';
    if (!isPremium) return; // gated for premium members
    if (window.AI && !(await AI.feature('lead_scorer'))) return; // AI off → nothing to show
    let leads = [];
    try { ({ leads } = await api('/api/ai/leads')); }
    catch (e) { return; }
    const labelMap = {
      job_search: '🔍 Job searching',
      tool_need: '🛠️ Evaluating tools',
      career_transition: '🚀 Career transition',
    };
    box.innerHTML = `
      <div class="card lead-dash">
        <div class="lead-dash-head">
          <h3>✨ AI Lead Signals <span class="premium-badge">PREMIUM</span></h3>
          <p>People whose recent posts suggest they're open to a move or a new tool.</p>
        </div>
        <div class="lead-list" id="lead-list">
          ${leads.length ? '' : '<p class="empty">No signals yet. As your network posts, high-intent prospects will appear here.</p>'}
        </div>
      </div>`;
    if (leads.length) {
      document.getElementById('lead-list').innerHTML = leads.map(l => {
        const a = l.author || { name: 'Someone', avatar_color: '#888' };
        const conf = (l.confidence || 'low');
        return `
          <div class="lead-row">
            ${avatar(a, 'md')}
            <div class="lead-info">
              <div class="lead-name"><a href="/profile.html?id=${a.id}">${escapeHTML(a.name)}</a>
                <span class="lead-tag ${l.signal_type}">${labelMap[l.signal_type] || l.signal_type}</span>
                <span class="lead-conf conf-${conf}">${conf}</span>
              </div>
              <div class="lead-snippet">${escapeHTML(l.snippet || '')}</div>
              <div class="lead-time">${timeAgo(l.created_at)}</div>
            </div>
            <a class="btn-tiny" href="/messages.html?user=${a.id}">💬 Reach out</a>
          </div>`;
      }).join('');
    }
  }

  refresh();
})();
