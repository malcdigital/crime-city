import { DISTRICTS } from './districts.js';
import { LINES } from './budget.js';

// Economy debug panel (press ` to show/hide): the money side of the city at a glance, for tuning.
const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export class EconDebug {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.id = 'econ-debug';
    el.className = 'hidden';
    document.body.appendChild(el);
    this.el = el;
    addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  toggle() {
    const show = this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !show);
    clearInterval(this.iv);
    if (show) {
      this.render();
      this.iv = setInterval(() => this.render(), 500);
    }
  }

  render() {
    const g = this.game;
    const P = g.property;
    const E = g.economy;
    const B = g.bank;
    const Bu = g.budget;
    const Pr = g.president;
    const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    const why = Pr.approvalWhy().map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(1)}`).join(', ') || '—';
    let html = `<b>ECONOMY</b> · day ${B.days} · ${g.clockText()} · <i>\` to close</i><table>`;
    html += row('President', `${Pr.leader.name} · ${Pr.p.title}${Pr.taxBoost > 1 ? ` · taxes +${Math.round((Pr.taxBoost - 1) * 100)}%` : ''}`);
    html += row('Approval', `${Math.round(Pr.approval)}% → ${Math.round(Pr.target())}% (${why}) · crime ${Math.round(Pr.crimeLevel)}`);
    html += row('Treasury', `${money(P.treasury)} · income ${money(Bu.lastIncome || 0)}/day · budget ${money(Bu.cost())}/day · paid ${Math.round(Bu.funded * 100)}%`);
    html += row('Budget', Object.entries(LINES).map(([k, L]) => `${L.name} ${L.levels[Bu.level[k]]}`).join(' · ') + ` · war ${g.market.war || 0}${Bu.auto ? '' : ' (you)'}`);
    html += row('Housing', `index ${P.housing.index.toFixed(3)} · trend ${(P.housing.trend * 100).toFixed(2)}%/day`);
    html += row('You', `cash ${money(g.cash)} · bank ${money(B.balance)} · stashes ${money(B.stashTotal())} · turf stash ${money(g.shops.stash)}`);
    html += '</table><table><tr><th>District</th><th>Wealth</th><th>Crime (usual)</th><th>Demand</th></tr>';
    for (const d of DISTRICTS) html += `<tr><td>${d}</td><td>${E.level(d).toFixed(2)} ${E.levelName(d)} ${E.trend[d] || ''}</td><td>${Math.round(P.crimeLevel[d] || 0)} (${Math.round(E.crimeNorm[d] || 0)})</td><td>${(P.demand[d] || 1).toFixed(2)}</td></tr>`;
    html += '</table><table><tr><th>Company</th><th>Owner</th><th>Profit/day</th><th>Price</th><th>Protection</th></tr>';
    for (const c of E.companies) html += `<tr><td>${c.name}</td><td>${c.owned ? 'you' : 'city'}</td><td>${money(E.dailyProfit(c))}</td><td>${money(E.price(c))}</td><td>${E.protector(c) || '—'}</td></tr>`;
    html += `</table><div>Gang protection income (total): ${Object.entries(E.gangIncome).map(([k, v]) => `${k} ${money(v)}`).join(' · ')}${E.profitTaxOn ? ' · <b>profit tax on private utilities</b>' : ''}</div>`;
    html += '<table><tr><th>Property</th><th>Price</th><th>Tax/wk</th><th>Upkeep/day</th></tr>';
    for (const h of P.all()) html += `<tr><td>${h.name}${h.owned ? ' (yours)' : ''}</td><td>${money(P.price(h))} ${P.trend(h)}</td><td>${money(P.weeklyTax(h))}</td><td>${money(P.dailyUpkeep(h))}</td></tr>`;
    this.el.innerHTML = html + '</table>';
  }
}
