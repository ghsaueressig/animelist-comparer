/**
 * Comparador de Listas de Anime
 * Integração de alta disponibilidade (MAL XML + Fallback)
 */

let RAW_DATA = {};
let USERS = [];
let activeUsers = new Set();
let currentMode = 'individual';

// Inicialização
async function init() {
  try {
    const response = await fetch('data/anime-data.json');
    if (!response.ok) throw new Error('Não foi possível carregar os dados locais padrão.');
    RAW_DATA = await response.json();
    USERS = Object.keys(RAW_DATA);
    activeUsers = new Set(USERS);

    renderUserButtons();
    render();
  } catch (err) {
    console.error(err);
    document.getElementById('info-status').textContent = 'Erro ao carregar banco de dados local.';
  }
}

/**
 * Busca a lista completa do MyAnimeList utilizando o endpoint de export XML
 * que retorna todos os animes em 1 única requisição rápida, sem rate limits nem 504.
 */
async function fetchMalUser() {
  const input = document.getElementById('mal-user-input');
  const btn = document.getElementById('mal-fetch-btn');
  const loadingIndicator = document.getElementById('mal-loading-indicator');
  const username = input.value.trim();

  if (!username) {
    alert('Por favor, digite um nome de usuário do MyAnimeList.');
    return;
  }

  const userKey = username.toLowerCase();

  if (RAW_DATA[userKey]) {
    activeUsers.add(userKey);
    renderUserButtons();
    render();
    input.value = '';
    return;
  }

  btn.disabled = true;
  loadingIndicator.style.display = 'inline';
  loadingIndicator.textContent = `⏳ Buscando lista de "${username}" no MyAnimeList...`;

  try {
    const targetUrl = `https://myanimelist.net/malappinfo.php?u=${encodeURIComponent(username)}&status=all&type=anime`;
    
    // Tentativa com proxies CORS rápidos
    const proxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
    ];

    let xmlText = null;
    let lastError = null;

    for (const url of proxies) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          xmlText = await res.text();
          if (xmlText && xmlText.includes('<anime>')) break;
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (!xmlText || !xmlText.includes('<anime>')) {
      if (xmlText && xmlText.includes('<error>')) {
        throw new Error('Usuário não encontrado no MyAnimeList ou lista privada.');
      }
      throw new Error('Servidor do MyAnimeList não respondeu no momento. Tente novamente em instantes.');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const animeNodes = xmlDoc.getElementsByTagName('anime');

    if (animeNodes.length === 0) {
      alert(`Nenhum anime encontrado para o usuário "${username}".`);
      return;
    }

    const statusMap = {
      '1': { status: 'Watching', statusCode: 'C' },
      '2': { status: 'Completed', statusCode: 'F' },
      '3': { status: 'On Hold', statusCode: 'H' },
      '4': { status: 'Dropped', statusCode: 'D' },
      '6': { status: 'Planned', statusCode: 'P' }
    };

    const formattedList = [];
    for (let i = 0; i < animeNodes.length; i++) {
      const node = animeNodes[i];
      const title = node.getElementsByTagName('series_title')[0]?.textContent || 'Sem título';
      const score = parseInt(node.getElementsByTagName('my_score')[0]?.textContent || '0', 10);
      const statusCode = node.getElementsByTagName('my_status')[0]?.textContent || '0';
      const st = statusMap[statusCode] || { status: 'Outro', statusCode: 'O' };

      formattedList.push({
        title: title,
        score: score,
        status: st.status,
        statusCode: st.statusCode
      });
    }

    RAW_DATA[userKey] = {
      username: username + ' (MAL)',
      isDynamic: true,
      list: formattedList
    };

    if (!USERS.includes(userKey)) {
      USERS.push(userKey);
    }
    activeUsers.add(userKey);

    input.value = '';
    renderUserButtons();
    render();

    alert(`Lista de "${username}" importada com sucesso (${formattedList.length} animes carregados)!`);
  } catch (err) {
    console.error(err);
    alert(`Não foi possível carregar a lista de "${username}". Detalhes: ${err.message}`);
  } finally {
    btn.disabled = false;
    loadingIndicator.style.display = 'none';
  }
}

function removeDynamicUser(key, e) {
  e.stopPropagation();
  delete RAW_DATA[key];
  USERS = USERS.filter(u => u !== key);
  activeUsers.delete(key);
  renderUserButtons();
  render();
}

function renderUserButtons() {
  const container = document.getElementById('users-toggle-group');
  container.innerHTML = '<label>Usuários:</label>';
  
  USERS.forEach(key => {
    const user = RAW_DATA[key];
    const btn = document.createElement('button');
    btn.className = 'toggle-btn' + (activeUsers.has(key) ? ' active' : '');
    btn.id = `btn-${key}`;
    
    let btnHtml = `<span>${user.username || key}</span>`;
    if (user.isDynamic) {
      btnHtml += `<span class="remove-user-btn" title="Remover usuário" onclick="removeDynamicUser('${key}', event)">✕</span>`;
    }
    btn.innerHTML = btnHtml;
    btn.onclick = () => toggleUser(key);
    container.appendChild(btn);
  });
}

function toggleUser(key) {
  if (activeUsers.has(key)) {
    if (activeUsers.size > 1) activeUsers.delete(key);
  } else {
    activeUsers.add(key);
  }
  const btn = document.getElementById(`btn-${key}`);
  if (btn) btn.classList.toggle('active', activeUsers.has(key));
  render();
}

function setMode(m) {
  currentMode = m;
  document.getElementById('mode-individual').classList.toggle('active', m === 'individual');
  document.getElementById('mode-compare').classList.toggle('active', m === 'compare');
  render();
}

function getFilter() {
  return {
    search: document.getElementById('search').value.toLowerCase().trim(),
    status: document.getElementById('status-filter').value,
    sort: document.getElementById('sort-by').value
  };
}

function scoreClass(s) {
  return 'score-' + (s > 0 ? s : 0);
}

function statusBadge(a) {
  return `<span class="status-badge st-${a.statusCode}">${a.status}</span>`;
}

function applyFilters(list, f) {
  let r = list;
  if (f.status) r = r.filter(a => a.statusCode === f.status);
  if (f.search) r = r.filter(a => a.title.toLowerCase().includes(f.search));
  if (f.sort === 'title') r = [...r].sort((a, b) => a.title.localeCompare(b.title));
  else if (f.sort === 'score-desc') r = [...r].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  else if (f.sort === 'score-asc') r = [...r].sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
  return r;
}

function renderIndividual() {
  const f = getFilter();
  const cols = USERS.filter(u => activeUsers.has(u));
  let totalShown = 0;

  const parts = cols.map(key => {
    const user = RAW_DATA[key];
    const items = applyFilters(user.list, f);
    totalShown += items.length;

    const rows = items.map(a => `
      <tr>
        <td>${a.title}</td>
        <td class="score-col ${scoreClass(a.score)}">${a.score > 0 ? a.score : '—'}</td>
        <td>${statusBadge(a)}</td>
      </tr>`).join('');

    return `
      <div class="list-col">
        <div class="list-header">
          <span>${user.username}</span>
          <span class="count">${items.length} animes</span>
        </div>
        <table class="list-table">
          <thead><tr><th>Título</th><th class="score-col">Nota</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" class="empty-msg">Nenhum resultado</td></tr>'}</tbody>
        </table>
      </div>`;
  });

  document.getElementById('info-status').textContent = `Mostrando ${totalShown} entradas no total (${cols.length} usuário(s) selecionado(s))`;
  document.getElementById('content').innerHTML = `<div id="lists-area">${parts.join('')}</div>`;
}

function renderCompare() {
  const f = getFilter();
  const cols = USERS.filter(u => activeUsers.has(u));

  if (cols.length < 2) {
    document.getElementById('content').innerHTML = '<div class="empty-msg">Selecione pelo menos 2 usuários para comparar.</div>';
    document.getElementById('info-status').textContent = '—';
    return;
  }

  const maps = {};
  cols.forEach(key => {
    maps[key] = {};
    RAW_DATA[key].list.forEach(a => { maps[key][a.title] = a; });
  });

  const allTitles = new Set();
  cols.forEach(key => Object.keys(maps[key]).forEach(t => allTitles.add(t)));

  let commonTitles = [...allTitles].filter(t => {
    let count = cols.filter(k => maps[k][t]).length;
    return count >= 2;
  });

  if (f.status) {
    commonTitles = commonTitles.filter(t => cols.some(k => maps[k][t] && maps[k][t].statusCode === f.status));
  }

  if (f.search) commonTitles = commonTitles.filter(t => t.toLowerCase().includes(f.search));

  if (f.sort === 'title') commonTitles.sort((a, b) => a.localeCompare(b));
  else if (f.sort === 'score-desc') {
    commonTitles.sort((a, b) => {
      const sa = cols.reduce((acc, k) => acc + (maps[k][a] ? maps[k][a].score : 0), 0);
      const sb = cols.reduce((acc, k) => acc + (maps[k][b] ? maps[k][b].score : 0), 0);
      return sb - sa || a.localeCompare(b);
    });
  } else if (f.sort === 'score-asc') {
    commonTitles.sort((a, b) => {
      const sa = cols.reduce((acc, k) => acc + (maps[k][a] ? maps[k][a].score : 0), 0);
      const sb = cols.reduce((acc, k) => acc + (maps[k][b] ? maps[k][b].score : 0), 0);
      return sa - sb || a.localeCompare(b);
    });
  }

  const userHeaders = cols.map(k => `<th class="centered">${RAW_DATA[k].username}<br><small>nota / status</small></th>`).join('');
  const diffHeader = cols.length >= 2 ? '<th class="centered">Δ maior</th>' : '';

  const rows = commonTitles.map(title => {
    const scores = cols.map(k => maps[k][title] ? maps[k][title].score : null);
    const definedScores = scores.filter(s => s !== null && s > 0);
    let diffCell = '';
    if (cols.length >= 2 && definedScores.length >= 2) {
      const mx = Math.max(...definedScores);
      const mn = Math.min(...definedScores);
      const d = mx - mn;
      const cls = d === 0 ? 'diff-eq' : d >= 3 ? 'diff-neg' : 'diff-pos';
      diffCell = `<td class="${cls}" style="text-align:center">${d === 0 ? '=' : `±${d}`}</td>`;
    } else {
      diffCell = '<td style="text-align:center; color:#ccc;">—</td>';
    }

    const userCells = cols.map(k => {
      const entry = maps[k][title];
      if (!entry) return `<td class="not-in-list" style="text-align:center">—</td>`;
      const s = entry.score;
      return `<td style="text-align:center"><span class="${scoreClass(s)}" style="font-weight:bold">${s > 0 ? s : '—'}</span> ${statusBadge(entry)}</td>`;
    }).join('');

    return `<tr><td>${title}</td>${userCells}${diffHeader ? diffCell : ''}</tr>`;
  }).join('');

  const allCount = commonTitles.length;
  document.getElementById('info-status').textContent = `${allCount} anime(s) em comum entre os usuários selecionados (com filtros aplicados)`;
  document.getElementById('content').innerHTML = `
    <div id="compare-area">
      <div class="compare-header">
        <span>Animes em comum</span>
        <span style="font-size:11px;font-weight:normal">${allCount} resultado(s)</span>
      </div>
      <table>
        <thead><tr><th>Título</th>${userHeaders}${diffHeader}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${cols.length + 2}" class="empty-msg">Nenhum anime em comum com esses filtros.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function render() {
  if (currentMode === 'individual') renderIndividual();
  else renderCompare();
}

document.addEventListener('DOMContentLoaded', init);
