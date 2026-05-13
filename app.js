// ============================================================
// app.js — 발주 관리 대시보드 메인 로직
// ============================================================

// ── 날짜 헤더 ─────────────────────────────────────────────
const _d = new Date();
document.getElementById("date-lbl").textContent =
  `${_d.getFullYear()}년 ${_d.getMonth()+1}월 ${_d.getDate()}일 기준`;
document.getElementById("sheet-link").href =
  `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}`;

// ── 숫자 포맷 ─────────────────────────────────────────────
function f(v) {
  const n = Math.round(v);
  if (n >= 10000) return `${+(n / 10000).toFixed(1)}억`;
  if (n >= 1000) {
    const chun = Math.floor(n / 1000);
    const baek = Math.floor((n % 1000) / 100);
    if (baek === 0) return `${chun}천만`;
    return `${chun}천${baek}백만`;
  }
  return `${n.toLocaleString()}만`;
}
function fSign(v) {
  return (v >= 0 ? '+' : '') + f(v);
}

// ── 탭 전환 ───────────────────────────────────────────────
function tab(name, el) {
  document.querySelectorAll(".nav-item").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("on"));
  el.classList.add("active");
  document.getElementById(`p-${name}`).classList.add("on");
}

// ── CSV 유틸 ──────────────────────────────────────────────
function fetchCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${gid}&t=${Date.now()}`;
  return fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
}

function parseCSV(raw) {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  const s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i+1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field.trim()); field = ''; i++; continue; }
    if (c === '\n') {
      row.push(field.trim()); rows.push(row);
      row = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  row.push(field.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function n(s) { return parseFloat(String(s).replace(/[^0-9.-]/g, "")) || 0; }

function calcDday(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const today = new Date(); today.setHours(0,0,0,0); target.setHours(0,0,0,0);
  return Math.ceil((target - today) / (1000*60*60*24));
}

function fmtDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth()+1}월 ${d.getDate()}일`;
}

function ddayInfo(d) {
  if (d === null) return { cls: 'gray', label: '미입력', accent: '#2a2e38' };
  if (d < 0)      return { cls: 'gray', label: '품절',   accent: '#2a2e38' };
  if (d < 10)     return { cls: 'red',  label: '초임박', accent: '#ef4444' };
  if (d < 20)     return { cls: 'amber',label: '임박',   accent: '#f59e0b' };
  if (d < 30)     return { cls: 'blue', label: '주의',   accent: '#3b82f6' };
  if (d < 40)     return { cls: 'green',label: '관심',   accent: '#22c55e' };
  return                 { cls: 'muted',label: '안전',   accent: '#4b5563' };
}

function gradeInfo(pct) {
  if (pct >= 130) return { cls: 'pink',   label: '우수 성과', color: '#ec4899' };
  if (pct >= 110) return { cls: 'purple', label: '초과 성과', color: '#8b5cf6' };
  if (pct >= 100) return { cls: 'green',  label: '목표 달성', color: '#22c55e' };
  if (pct >= 90)  return { cls: 'blue',   label: '방어 성공', color: '#3b82f6' };
  if (pct >= 80)  return { cls: 'amber',  label: '경고',      color: '#f59e0b' };
  return                 { cls: 'red',    label: '위험',      color: '#ef4444' };
}

// ── 동기화 상태 ───────────────────────────────────────────
function setSyncStatus(type, text) {
  const dot  = document.getElementById('syncDot');
  const span = document.getElementById('syncText');
  dot.className  = 'sync-dot sync-' + type;
  span.textContent = text;
}

function nowTime() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ── 메인 로드 ─────────────────────────────────────────────
async function load() {
  document.getElementById("content").innerHTML =
    `<div class="loading"><div class="loading-spinner"></div><span>데이터를 불러오는 중...</span></div>`;
  document.getElementById("err").innerHTML = "";
  setSyncStatus('loading', '동기화 중...');

  try {
    const stockPromise = CONFIG.GID_STOCK
      ? fetchCSV(CONFIG.GID_STOCK).catch(() => "")
      : Promise.resolve("");
    const memoPromise = CONFIG.GID_MEMO
      ? fetchCSV(CONFIG.GID_MEMO).catch(() => "")
      : Promise.resolve("");

    const [cfgR, prodR, salesR, coupangR, stockR, memoR] = await Promise.all([
      fetchCSV(CONFIG.GID_CONFIG),
      fetchCSV(CONFIG.GID_PROD),
      fetchCSV(CONFIG.GID_SALES),
      fetchCSV(CONFIG.GID_COUPANG),
      stockPromise,
      memoPromise,
    ]);

    // 설정 시트
    const cfg = {};
    parseCSV(cfgR).slice(1).forEach(r => { if (r[0]) cfg[r[0]] = r[1]; });

    // 제품 시트
    const products = parseCSV(prodR).slice(1).filter(r => r[0])
      .map(r => ({ name: r[0], actual: n(r[1]), target: n(r[2]), soldout: r[1].trim() === '품절' }));

    // 매출 시트
    const salesRows  = parseCSV(salesR).slice(1).filter(r => r[0]);
    const totalSales = n(salesRows.at(-1)?.[1] ?? 0);

    // 쿠팡납품 시트
    const coupangRows = parseCSV(coupangR).slice(1).filter(r => r[0]);
    const coupangData = coupangRows.map(r => ({
      week:      r[0],
      period:    r[1],
      ordered:   n(r[2]),
      delivered: n(r[3]),
      rate:      n(r[2]) > 0 ? (n(r[3]) / n(r[2]) * 100) : 0,
    }));

    // 재고 시트
    const stockMap = {};
    if (stockR) {
      parseCSV(stockR).slice(1).filter(r => r[0]).forEach(r => {
        stockMap[r[0].trim()] = {
          stockoutDate: r[1] || "",
          restockQty:   r[2] ? n(r[2]) : null,
          restockDate:  r[3] || "",
        };
      });
    }
    const stockData = CONFIG.STOCK_PRODUCTS.map(name => {
      const s = stockMap[name] || {};
      return { name, dday: calcDday(s.stockoutDate), restockQty: s.restockQty ?? null, restockDate: s.restockDate || "" };
    });

    // 발주요청사항 시트
    const memoMap = { team: '', manager: '', staff: '' };
    const roleKey = { '팀장': 'team', '과장': 'manager', '주임': 'staff' };
    if (memoR) {
      parseCSV(memoR).slice(1).filter(r => r[0]).forEach(r => {
        const k = roleKey[r[0].trim()];
        if (k) memoMap[k] = r[1] || '';
      });
    }

    const elapsedDays  = n(cfg["경과일"] ?? 24);
    const totalDays    = n(cfg["총일수"] ?? 30);
    const targetMain   = n(cfg["자사몰목표"] ?? 0) + n(cfg["네이버목표"] ?? 0);
    const currentMain  = n(cfg["현재일매출_자사몰"] ?? 0) + n(cfg["현재일매출_네이버"] ?? 0);
    const allDailyAvg  = elapsedDays > 0 ? Math.round(totalSales / elapsedDays) : 0;
    const deferralDeadline = cfg["결제유예가능일"] || "";
    const deferralLimit    = n(cfg["유예월발주한도"] ?? 0);

    setSyncStatus('ok', `${nowTime()} 업데이트`);
    render({ targetMain, currentMain, allDailyAvg, spentBudget: n(cfg["누적발주지출"] ?? 0),
      coupangData, elapsedDays, totalDays, totalSales, products, stockData,
      deferralDeadline, deferralLimit, memoData: memoMap });

  } catch(e) {
    setSyncStatus('error', '연결 실패');
    document.getElementById("err").innerHTML =
      `<div class="err-box">⚠️ 데이터 로드 실패: <strong>${e.message}</strong><br><br>
       1. Sheets 공유 → <strong>"링크가 있는 모든 사용자" 뷰어</strong> 설정<br>
       2. 설정 시트 A열 키 이름 확인<br>
       3. gid 번호 확인 (시트 탭 클릭 → URL 끝 #gid= 숫자)</div>`;
    document.getElementById("content").innerHTML = "";
  }
}

// ── 렌더 ──────────────────────────────────────────────────
function render({ targetMain, currentMain, allDailyAvg, spentBudget, elapsedDays, totalDays,
                  totalSales, products, coupangData, stockData, deferralDeadline, deferralLimit, memoData = {} }) {

  const pct        = targetMain > 0 ? (currentMain / targetMain * 100) : 0;
  const remain     = totalDays - elapsedDays;
  const projected  = Math.round((currentMain * elapsedDays + currentMain * remain) / CONFIG.NAVER_RATIO);
  const adjBudget  = Math.round(projected * CONFIG.ORDER_RATIO);
  const spendRatio = projected > 0 ? (spentBudget / projected * 100) : 0;
  const extraBudget = adjBudget - spentBudget;
  const G = gradeInfo(pct);

  const needDaily = remain > 0 && currentMain < targetMain
    ? Math.round((targetMain * totalDays - currentMain * elapsedDays) / remain)
    : targetMain;

  // ── 시나리오 HTML ────────────────────────────────────────
  function buildScenarioRow(dailyMain, note, isCurrent, isTarget) {
    const mainMonthly  = currentMain * elapsedDays + dailyMain * remain;
    const scProj       = Math.round(mainMonthly / CONFIG.NAVER_RATIO);
    const scAdj        = Math.round(scProj * CONFIG.ORDER_RATIO);
    const scExtra      = scAdj - spentBudget;
    const extraCls     = scExtra >= 0 ? 'pos' : 'neg';
    const rowCls       = isCurrent ? 'row-current' : isTarget ? 'row-target' : '';
    const noteTag      = `<span class="sc-note">(${note})</span>`;
    const currentTag   = isCurrent ? '<span class="sc-current-tag">◀ 현재</span>' : '';
    return `
      <tr class="${rowCls}">
        <td>${dailyMain.toLocaleString()}만원 ${noteTag}${currentTag}</td>
        <td class="num">${f(scProj)}</td>
        <td class="num">${f(scAdj)}</td>
        <td class="num ${extraCls}">${scExtra >= 0 ? '+' : ''}${f(scExtra)}</td>
      </tr>`;
  }

  const currentIsTarget = Math.abs(currentMain - targetMain) < targetMain * 0.02;
  const scenarioVals = CONFIG.SCENARIOS.map(s => Math.round(targetMain * s.multiplier));
  let insertBefore = scenarioVals.length;
  for (let i = 0; i < scenarioVals.length; i++) {
    if (currentMain > scenarioVals[i] * 1.02) { insertBefore = i; break; }
    if (Math.abs(currentMain - scenarioVals[i]) <= scenarioVals[i] * 0.02) { insertBefore = -1; break; }
  }

  const scenarioRows = (() => {
    const rows = [];
    if (!currentIsTarget && insertBefore === 0) rows.push(buildScenarioRow(currentMain, '현재', true, false));
    CONFIG.SCENARIOS.forEach((s, i) => {
      rows.push(buildScenarioRow(Math.round(targetMain * s.multiplier), s.note, false, s.isTarget));
      if (!currentIsTarget && insertBefore === i + 1) rows.push(buildScenarioRow(currentMain, '현재', true, false));
    });
    if (!currentIsTarget && insertBefore === CONFIG.SCENARIOS.length) rows.push(buildScenarioRow(currentMain, '현재', true, false));
    return rows.join('');
  })();

  // ── 조건부 발주 ─────────────────────────────────────────
  const ddayDefer   = calcDday(deferralDeadline);
  const ddayLabel   = ddayDefer === null ? '—' : ddayDefer < 0 ? `D+${Math.abs(ddayDefer)}` : `D-${ddayDefer}`;
  const noDeadline  = !deferralDeadline;
  const noLimit     = !(deferralLimit > 0);
  const deferralRemain = deferralLimit - Math.max(0, -extraBudget);

  // ── 제품 바 ─────────────────────────────────────────────
  const prodHTML = products.map(p => {
    if (p.soldout) return `
      <div class="prod-row prod-soldout">
        <div class="prod-name muted">${p.name}</div>
        <div class="prod-bar-wrap"><div class="prod-bar-bg"><div class="prod-bar-fill" style="width:0%"></div></div></div>
        <div class="prod-qty muted">—<em>/—</em></div>
        <span class="prod-badge badge-soldout">품절</span>
      </div>`;
    const r   = p.actual / p.target;
    const w   = Math.min(Math.round(r * 100), 100);
    const col = r >= 1 ? '#3b82f6' : '#f59e0b';
    const badge = r < 0.55
      ? `<span class="prod-badge badge-danger">급감</span>`
      : r >= 1
        ? `<span class="prod-badge badge-ok">정상</span>`
        : `<span class="prod-badge badge-warn">부진</span>`;
    return `
      <div class="prod-row">
        <div class="prod-name">${p.name}</div>
        <div class="prod-bar-wrap">
          <div class="prod-bar-bg"><div class="prod-bar-fill" style="width:${w}%;background:${col};"></div></div>
        </div>
        <div class="prod-qty">${p.actual}<em>/${p.target}</em></div>
        ${badge}
      </div>`;
  }).join('');

  // ── 재고 카드 ────────────────────────────────────────────
  const stockHTML = stockData.map(s => {
    const info      = ddayInfo(s.dday);
    const isExpired = s.dday !== null && s.dday < 0;
    const ddLabel   = s.dday === null ? '—'
      : s.dday < 0 ? `D+${Math.abs(s.dday)}`
      : `D-${s.dday}`;
    const restockTxt = (s.restockQty || s.restockDate)
      ? `<strong>${s.restockQty ? s.restockQty.toLocaleString()+'개' : '미정'}</strong> 재입고${s.restockDate ? ` · ${fmtDate(s.restockDate)}` : ''}`
      : `<span class="muted">재입고 정보 없음</span>`;
    return `
      <div class="stock-card ${isExpired ? 'stock-expired' : ''}" style="--stock-accent:${info.accent}">
        <div class="stock-name ${isExpired ? 'muted' : ''}">${s.name}</div>
        <div class="stock-dday ${info.cls}">${ddLabel}</div>
        <div class="stock-tag-wrap"><span class="stock-tag ${info.cls}">${isExpired ? '품절' : info.label}</span></div>
        <div class="stock-divider"></div>
        <div class="stock-restock ${isExpired ? 'muted' : ''}">${restockTxt}</div>
      </div>`;
  }).join('');

  // ── 쿠팡 차트 + 테이블 ───────────────────────────────────
  const totalOrdered   = coupangData.reduce((s, d) => s + d.ordered, 0);
  const totalDelivered = coupangData.reduce((s, d) => s + d.delivered, 0);
  const totalRate      = totalOrdered > 0 ? totalDelivered / totalOrdered * 100 : 0;

  const coupangBars = coupangData.map((d, i) => {
    const h   = Math.max(4, Math.round(d.rate * 1.1));
    const col = d.rate >= 70 ? '#22c55e' : d.rate >= 50 ? '#3b82f6' : d.rate >= 30 ? '#f59e0b' : '#ef4444';
    const isLast = i === coupangData.length - 1;
    return `<div class="coup-bar-col">
      <div class="coup-bar-pct">${d.rate.toFixed(0)}%</div>
      <div class="coup-bar-fill" style="height:${h}px;background:${col};${isLast ? 'outline:1.5px solid var(--accent);outline-offset:-1.5px;' : ''}"></div>
      <div class="coup-bar-lbl">${d.week}</div>
    </div>`;
  }).join('');

  const coupangTableRows = coupangData.map((d, i) => {
    const col     = d.rate >= 70 ? '#22c55e' : d.rate >= 50 ? '#3b82f6' : d.rate >= 30 ? '#f59e0b' : '#ef4444';
    const isLast  = i === coupangData.length - 1;
    const barW    = Math.min(Math.round(d.rate), 100);
    return `<tr class="${isLast ? 'row-current' : ''}">
      <td class="fw">${d.week}</td>
      <td class="muted">${d.period}</td>
      <td class="num">${d.ordered.toLocaleString()}</td>
      <td class="num">${d.delivered.toLocaleString()}</td>
      <td class="num fw" style="color:${col}">${d.rate.toFixed(2)}%</td>
      <td><div class="mini-bar-wrap"><div class="mini-bar-fill" style="width:${barW}%;background:${col}"></div></div></td>
    </tr>`;
  }).join('');

  // ── 경고 배너 ────────────────────────────────────────────
  const alertBanner = (pct < 80 && currentMain > 0)
    ? `<div class="alert-banner alert-danger">⚠ [위험] 자사몰+네이버 달성률 ${pct.toFixed(1)}% — 목표 달성을 위한 잔여 일 매출이 평소 대비 ${Math.round(needDaily / currentMain * 100)}% 이상 필요합니다.</div>`
    : (pct < 90 && currentMain > 0)
    ? `<div class="alert-banner alert-warn">⚡ [경고] 자사몰+네이버 달성률 ${pct.toFixed(1)}% — 목표 대비 부족합니다. 추이를 주시하세요.</div>`
    : '';

  // ── 바 스케일 계산 ────────────────────────────────────────
  const barMin  = Math.min(adjBudget, spentBudget) * 0.85;
  const range   = Math.max(adjBudget, spentBudget) - barMin || 1;
  const adjW    = Math.round((adjBudget   - barMin) / range * 100);
  const spentW  = Math.round((spentBudget - barMin) / range * 100);
  const spentCol = spendRatio <= 18 ? '#22c55e' : '#ef4444';

  // ── SVG 도넛 ─────────────────────────────────────────────
  const R = 34, C = 42;
  const circ = 2 * Math.PI * R;
  const spentArc = Math.min(spendRatio, 100) / 100 * circ;
  const limitArc = Math.min(18, 100) / 100 * circ;

  document.getElementById("content").innerHTML = `

    ${alertBanner}

    <!-- ① 일매출 달성 현황 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">일매출 달성 현황</span></div>
      <div class="kpi-row">

        <!-- 목표 vs 현재 -->
        <div class="kpi-card kpi-wide">
          <div class="kpi-label">목표 vs 현재 평균 일매출 <span class="kpi-label-sub">자사몰+네이버</span></div>
          <div class="bar-compare">
            <div class="bar-compare-row">
              <span class="bar-compare-tag">목표</span>
              <div class="bar-compare-track"><div class="bar-compare-fill" style="width:100%;background:var(--border2)"></div></div>
              <span class="bar-compare-val">${f(targetMain)}</span>
            </div>
            <div class="bar-compare-row">
              <span class="bar-compare-tag">현재</span>
              <div class="bar-compare-track">
                <div class="bar-compare-fill" style="width:${Math.min(pct,100)}%;background:${currentMain >= targetMain ? '#22c55e' : '#ef4444'};"></div>
              </div>
              <span class="bar-compare-val" style="color:${currentMain >= targetMain ? '#22c55e' : '#ef4444'}">${f(currentMain)}</span>
            </div>
          </div>
          <div class="kpi-footer">${elapsedDays}일 경과 / ${totalDays}일 · 달성률 ${pct.toFixed(1)}%</div>
        </div>

        <!-- 달성률 -->
        <div class="kpi-card">
          <div class="kpi-label">목표 달성률</div>
          <div class="kpi-value" style="color:${G.color}">${pct.toFixed(1)}%</div>
          <div class="kpi-badge kpi-badge-${G.cls}">${G.label}</div>
          <div class="prog-track"><div class="prog-fill" style="width:${Math.min(pct,130)/1.3}%;background:${G.color}"></div></div>
        </div>

        <!-- 예상 매출 -->
        <div class="kpi-card">
          <div class="kpi-label">전체 플랫폼 누적 예상 매출</div>
          <div class="kpi-value">${f(projected)}</div>
          <div class="kpi-sub">목표 대비 ${projected >= CONFIG.TARGET_MONTHLY ? '+' : ''}${f(projected - CONFIG.TARGET_MONTHLY)}</div>
        </div>

      </div>
    </section>

    <!-- ② 발주 예산 여유 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">발주 예산 여유</span></div>
      <div class="kpi-row">

        <!-- 조정발주비 vs 누적지출 -->
        <div class="kpi-card kpi-wide">
          <div class="kpi-label">조정 발주비 vs 누적 지출액</div>
          <div class="bar-compare">
            <div class="bar-compare-row">
              <span class="bar-compare-tag" style="width:52px">조정발주</span>
              <div class="bar-compare-track"><div class="bar-compare-fill" style="width:${adjW}%;background:var(--border2)"></div></div>
              <span class="bar-compare-val">${f(adjBudget)}</span>
            </div>
            <div class="bar-compare-row">
              <span class="bar-compare-tag" style="width:52px">누적지출</span>
              <div class="bar-compare-track"><div class="bar-compare-fill" style="width:${spentW}%;background:${spentCol}"></div></div>
              <span class="bar-compare-val" style="color:${spentCol}">${f(spentBudget)}</span>
            </div>
          </div>
          <div class="kpi-footer">월말 예상 매출 × 18% 기준 · 현재 ${spendRatio.toFixed(1)}% 집행</div>
        </div>

        <!-- 도넛 -->
        <div class="kpi-card kpi-donut">
          <div class="kpi-label">현재 기준 발주비 비중</div>
          <div class="donut-wrap">
            <svg viewBox="0 0 84 84" width="80" height="80" style="transform:rotate(-90deg)">
              <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--bg3)" stroke-width="10"/>
              <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="rgba(34,197,94,0.2)" stroke-width="10"
                stroke-dasharray="${limitArc} ${circ}" stroke-dashoffset="0"/>
              <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${spentCol}" stroke-width="10"
                stroke-dasharray="${spentArc} ${circ}" stroke-dashoffset="0" stroke-linecap="round"/>
            </svg>
            <div class="donut-center">
              <span style="font-size:14px;font-weight:700;font-family:var(--mono);color:${spentCol}">${spendRatio.toFixed(1)}%</span>
            </div>
          </div>
          <div class="kpi-badge kpi-badge-${spendRatio <= 18 ? 'green' : 'red'}">${spendRatio <= 18 ? '안전 (18% 이하)' : '위험 (18% 초과)'}</div>
          <div class="donut-legend">
            <span><i style="background:rgba(34,197,94,0.3)"></i>18% 한도</span>
            <span><i style="background:${spentCol}"></i>현재</span>
          </div>
        </div>

        <!-- 추가 가용 -->
        <div class="kpi-card">
          <div class="kpi-label">추가 가용 발주비</div>
          <div class="kpi-value ${extraBudget >= 0 ? 'pos' : 'neg'}">${extraBudget >= 0 ? f(extraBudget) : '-'+f(Math.abs(extraBudget))}</div>
          <div class="kpi-badge kpi-badge-${extraBudget >= 0 ? 'green' : 'red'}">${extraBudget >= 0 ? '여유 있음' : '예산 초과'}</div>
          <div class="kpi-sub" style="margin-top:8px;line-height:1.7">현재 평균 유지 시<br>${extraBudget >= 0 ? f(extraBudget)+' 추가 집행 가능' : f(Math.abs(extraBudget))+' 초과 상태'}</div>
        </div>

      </div>
    </section>

    <!-- ③ 시나리오 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">일평균 시나리오별 추가 가용 발주비</span><span class="sec-sub">목표 일평균 기준</span></div>
      <div class="table-card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>시나리오 일평균</th>
                <th class="num">월말 예상 매출</th>
                <th class="num">조정 발주비 (×18%)</th>
                <th class="num">추가 가용 발주비</th>
              </tr>
            </thead>
            <tbody>${scenarioRows}</tbody>
          </table>
        </div>
        <div class="table-footer">
          시나리오 일평균은 자사몰+네이버 합산 기준 / 월말 예상 매출은 전체 플랫폼 기준 (자사몰+네이버 = 전체의 70%) / 추가 가용 발주비 = 조정 발주비 − 누적 지출액(${f(spentBudget)})
        </div>
      </div>
    </section>

    <!-- ④ 조건부 발주 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">조건부 발주 가능 금액</span><span class="sec-sub">결제 유예 조건</span></div>
      <div class="deferred-card">
        <div class="deferred-top">
          <span class="deferred-icon">💳</span>
          <span class="deferred-desc">잔여 발주 예산이 부족한 경우, 다음달 결제 유예 조건으로 추가 발주 가능한 한도를 표시합니다.</span>
        </div>
        <div class="deferred-cells">
          <div class="deferred-cell">
            <div class="kpi-label">이 날짜까지 결제를 미룰 수 있다면</div>
            <div class="kpi-value ${noDeadline ? 'neg' : ''}" style="${noDeadline ? 'font-size:14px' : ''}">${noDeadline ? '조건부 추가 발주 불가' : fmtDate(deferralDeadline)}</div>
            <div class="kpi-sub">${noDeadline ? '마감일 미설정' : ddayLabel + ' 남음'}</div>
          </div>
          <div class="deferred-cell">
            <div class="kpi-label">추가 발주 가능 한도</div>
            <div class="kpi-value ${noLimit ? 'neg' : ''}">${noLimit ? '0원' : f(deferralLimit)}</div>
            <div class="kpi-sub">${noLimit ? '한도 미설정 (불가)' : '과장 설정 기준'}</div>
          </div>
        </div>
        <div class="deferred-note">
          📌 <strong>조건부 발주</strong>란, 이번 달 발주 예산을 소진한 경우 <strong>${deferralDeadline ? fmtDate(deferralDeadline) : '지정된 날짜'}까지 결제를 유예</strong>하는 조건으로 추가 발주를 진행하는 것입니다.
          한도(<strong>${deferralLimit > 0 ? f(deferralLimit) : '미설정'}</strong>)는 과장이 설정하며, 해당 범위 내에서만 추가 발주가 가능합니다.
        </div>
      </div>
    </section>

    <!-- ⑤ 제품 일평균 판매수량 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">주력 제품 일평균 판매수량</span></div>
      <div class="table-card prod-card">${prodHTML}</div>
    </section>

    <!-- ⑦ 재고현황 -->
    <section class="sec">
      <div class="sec-header"><span class="sec-lbl">주력 제품 재고현황</span><span class="sec-sub">품절 D-day</span></div>
      <div class="stock-grid">${stockHTML}</div>
    </section>
  `;

  // ── 발주 요청 사항 패널 ─────────────────────────────────
  document.getElementById('memo-content').innerHTML = `
    <section class="sec">
      <div class="table-card memo-card">
        ${[['team','팀장'],['manager','과장'],['staff','주임']].map(([role, label], idx) => {
          const txt = memoData[role] || '';
          return `<div class="memo-row ${idx < 2 ? 'memo-border' : ''}">
            <div class="memo-role">${label}</div>
            <div class="memo-body ${txt ? '' : 'muted'}">${txt
              ? txt.split('\n').map(l => l.trim()).filter(l => l !== '').join('<br>')
              : '—'}</div>
          </div>`;
        }).join('')}
        <div class="table-footer">📄 Google Sheets &gt; 발주요청사항 시트에서 수정 · 새로고침 시 반영</div>
      </div>
    </section>
  `;

  // ── 쿠팡 납품 현황 패널 ────────────────────────────────
  document.getElementById('coupang-content').innerHTML = `
    <section class="sec">
      <div class="table-card">
        <div class="coup-chart">
          <div class="coup-bars">${coupangBars}</div>
        </div>
        <div class="coup-legend">
          ${[['#22c55e','70%+'],['#3b82f6','50~69%'],['#f59e0b','30~49%'],['#ef4444','~29%']].map(([c,l])=>
            `<span class="coup-leg-item"><i style="background:${c}"></i>${l}</span>`
          ).join('')}
          <span class="coup-leg-item" style="margin-left:auto;color:var(--muted)">□ 최근 주차</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>주차</th><th>기간</th>
                <th class="num">발주 요청</th><th class="num">입고</th>
                <th class="num">납품율</th><th>달성</th>
              </tr>
            </thead>
            <tbody>${coupangTableRows}</tbody>
            <tfoot>
              <tr class="tfoot-row">
                <td class="fw" colspan="2">전체 합계</td>
                <td class="num fw">${totalOrdered.toLocaleString()}</td>
                <td class="num fw">${totalDelivered.toLocaleString()}</td>
                <td class="num fw">${totalRate.toFixed(2)}%</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  `;
}

// 5분마다 자동 새로고침
setInterval(load, 5 * 60 * 1000);
load();
