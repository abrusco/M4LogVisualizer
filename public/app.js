const state = {
  entries: [],
  files: [],
  loadedFiles: [],
  selectedId: null,
  filterFile: 'all',
  search: ''
};

const elements = {
  logDir: document.querySelector('#logDir'),
  summary: document.querySelector('#summary'),
  entryList: document.querySelector('#entryList'),
  searchInput: document.querySelector('#searchInput'),
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('#dropZone'),
  selectedFile: document.querySelector('#selectedFile'),
  selectedTitle: document.querySelector('#selectedTitle'),
  metaObject: document.querySelector('#metaObject'),
  organization: document.querySelector('#organization'),
  date: document.querySelector('#date'),
  duration: document.querySelector('#duration'),
  rowCount: document.querySelector('#rowCount'),
  sqlOutput: document.querySelector('#sqlOutput'),
  rawOutput: document.querySelector('#rawOutput'),
  resultTable: document.querySelector('#resultTable'),
  tableHint: document.querySelector('#tableHint'),
  copyButton: document.querySelector('#copyButton'),
  refreshButton: document.querySelector('#refreshButton')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function decodeBuffer(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
  return utf8;
}

function parseHeader(line) {
  const objectMatch = line.match(/Meta4Object\s*=\s*([^\.\r\n]+)/i);
  const nodeMatch = line.match(/Node\s*=\s*([^\.\r\n]+)/i);
  const recordSetMatch = line.match(/RecordSet\s*=\s*([^\.\r\n]+)/i);
  return {
    meta4Object: objectMatch ? objectMatch[1].trim() : '',
    node: nodeMatch ? nodeMatch[1].trim() : '',
    recordSet: recordSetMatch ? recordSetMatch[1].trim() : ''
  };
}

function parseConnection(line) {
  const roleMatch = line.match(/Role\s*<([^>]+)>/i);
  const rsmMatch = line.match(/RSM\s*<([^>]+)>/i);
  const organizationMatch = line.match(/Organization\s*<([^>]+)>/i);
  const dateMatch = line.match(/Date\s*=\s*([^\.\r\n]+)/i);
  const tickMatch = line.match(/Tick\s*=\s*([^\.\r\n]+)/i);
  return {
    role: roleMatch ? roleMatch[1].trim() : '',
    rsm: rsmMatch ? rsmMatch[1].trim() : '',
    organization: organizationMatch ? organizationMatch[1].trim() : '',
    date: dateMatch ? dateMatch[1].trim() : '',
    tick: tickMatch ? tickMatch[1].trim() : ''
  };
}

function parseTime(line) {
  const timeMatch = line.match(/Time\s*=\s*([0-9]+)\s*\(ms\)/i);
  const threadMatch = line.match(/Thread ID\s*=\s*([0-9]+)/i);
  return {
    durationMs: timeMatch ? Number(timeMatch[1]) : null,
    threadId: threadMatch ? threadMatch[1] : ''
  };
}

function splitResultRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ';' && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        values.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    values.push(trimmed);
  }
  return values;
}

function looksLikeResultRow(line) {
  const trimmed = line.trim();
  if (!trimmed.endsWith(';') || !trimmed.includes(';')) {
    return false;
  }
  if (/^(Execute|DB Connection|Calculating|Number of records)/i.test(trimmed)) {
    return false;
  }
  return /^("?[^"]+"?|-?[0-9]|NULL\b|<null>\b)/i.test(trimmed);
}

function normalizeOracleDateLiterals(sql) {
  return String(sql || '')
    .replace(/\{\s*d\s*'(\d{4})-(\d{2})-(\d{2})'\s*\}/gi, (_match, year, month, day) => {
      return `to_date('${day}/${month}/${year}', 'DD/MM/YYYY')`;
    })
    .replace(/\{\s*ts\s*'(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})'\s*\}/gi, (_match, year, month, day, hour, minute, second) => {
      return `to_date('${year}-${month}-${day} ${hour}:${minute}:${second}', 'YYYY-MM-DD HH24:MI:SS')`;
    });
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function createEntry(fileName, index, headerLine) {
  return {
    id: `${fileName}-${index}`,
    fileName,
    lineNumber: index + 1,
    ...parseHeader(headerLine),
    connection: {},
    sql: '',
    normalizedSql: '',
    rows: [],
    recordCount: null,
    durationMs: null,
    threadId: '',
    rawLines: [headerLine]
  };
}

function cloneEntryForStatement(entry, index, statementLine) {
  return {
    ...createEntry(entry.fileName, index, entry.rawLines[0]),
    id: `${entry.fileName}-${index}-${entry.rawLines.length}`,
    meta4Object: entry.meta4Object,
    node: entry.node,
    recordSet: entry.recordSet,
    connection: { ...entry.connection },
    rawLines: [entry.rawLines[0], statementLine]
  };
}

function parseLogContent(content, fileName) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let current = null;
  let readingSql = false;

  function finishCurrent() {
    if (!current) {
      return;
    }
    current.sql = normalizeOracleDateLiterals(current.sql.trim());
    current.normalizedSql = normalizeSql(current.sql);
    entries.push(current);
    current = null;
    readingSql = false;
  }

  lines.forEach((line, index) => {
    if (/^\s*Execute Real Stmt\./i.test(line)) {
      finishCurrent();
      current = createEntry(fileName, index, line.trim());
      return;
    }

    if (!current) {
      return;
    }

    current.rawLines.push(line);
    const trimmed = line.trim();

    if (/^DB Connection/i.test(trimmed)) {
      current.connection = parseConnection(trimmed);
      return;
    }

    if (/^Execute Stmt\s*=/i.test(trimmed)) {
      if (current.sql.trim().length > 0 || current.rows.length > 0) {
        const previous = current;
        finishCurrent();
        current = cloneEntryForStatement(previous, index, line);
      }
      current.sql += trimmed.replace(/^Execute Stmt\s*=\s*/i, '');
      readingSql = true;
      return;
    }

    if (/^Number of records\s*:/i.test(trimmed)) {
      const count = trimmed.match(/Number of records\s*:\s*([0-9]+)/i);
      current.recordCount = count ? Number(count[1]) : current.rows.length;
      readingSql = false;
      return;
    }

    if (/^Calculating Time\./i.test(trimmed)) {
      Object.assign(current, parseTime(trimmed));
      readingSql = false;
      return;
    }

    if (looksLikeResultRow(trimmed)) {
      current.rows.push(splitResultRow(trimmed));
      readingSql = false;
      return;
    }

    if (readingSql && trimmed.length > 0) {
      current.sql += ` ${trimmed}`;
    }
  });

  finishCurrent();
  return entries;
}

function highlightSql(sql) {
  const keywords = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER', 'BY', 'GROUP', 'HAVING',
    'INSERT', 'UPDATE', 'DELETE', 'VALUES', 'SET', 'INTO', 'JOIN', 'INNER',
    'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON', 'UNION', 'ALL', 'DISTINCT', 'AS',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'BEGIN', 'NULL', 'IS', 'NOT', 'IN',
    'EXISTS', 'LIKE', 'BETWEEN', 'ASC', 'DESC', 'CREATE', 'ALTER', 'DROP'
  ]);
  const functions = new Set([
    'NVL', 'TO_DATE', 'TRUNC', 'REGEXP_SUBSTR', 'SYSDATE', 'COUNT', 'SUM',
    'MIN', 'MAX', 'AVG', 'SUBSTR', 'DECODE', 'COALESCE', 'TO_CHAR', 'TO_NUMBER'
  ]);
  const tokenPattern = /(--[^\n]*|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_$#]*\b|<>|<=|>=|:=|[=+\-*/(),.;])/g;

  return String(sql || '').replace(tokenPattern, (token) => {
    const escaped = escapeHtml(token);
    if (token.startsWith('--')) {
      return `<span class="sql-comment">${escaped}</span>`;
    }
    if (token.startsWith("'")) {
      return `<span class="sql-string">${escaped}</span>`;
    }
    if (/^\d/.test(token)) {
      return `<span class="sql-number">${escaped}</span>`;
    }

    const upper = token.toUpperCase();
    if (keywords.has(upper)) {
      return `<span class="sql-keyword">${escaped}</span>`;
    }
    if (functions.has(upper)) {
      return `<span class="sql-function">${escaped}</span>`;
    }
    if (/^(<>|<=|>=|:=|[=+\-*/(),.;])$/.test(token)) {
      return `<span class="sql-operator">${escaped}</span>`;
    }
    return escaped;
  });
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  return value;
}

function selectedEntry() {
  return state.entries.find((entry) => entry.id === state.selectedId) || null;
}

function entrySearchText(entry) {
  return [
    entry.fileName,
    entry.meta4Object,
    entry.node,
    entry.recordSet,
    entry.connection?.organization,
    entry.connection?.date,
    entry.sql,
    entry.rows.flat().join(' ')
  ].join(' ').toLowerCase();
}

function entryDisplayTitle(entry) {
  const object = entry.meta4Object || 'SQL sem objeto';
  const node = entry.node || '';

  if (!node || node === object) {
    return object;
  }

  return `${object} :: ${node}`;
}

function entryDisplaySubtitle(entry) {
  const parts = [
    entry.fileName,
    `linha ${entry.lineNumber}`,
    entry.connection?.date || 'sem data',
    `${entry.rows.length} linha(s)`
  ];

  return parts.join(' | ');
}

function filteredEntries() {
  const search = state.search.trim().toLowerCase();
  return state.entries.filter((entry) => {
    const fileMatches = state.filterFile === 'all' || entry.fileName === state.filterFile;
    const searchMatches = !search || entrySearchText(entry).includes(search);
    return fileMatches && searchMatches;
  });
}

function renderSummary(entries) {
  const existing = state.files.filter((file) => file.exists);
  const missing = state.files.filter((file) => !file.exists);
  const rowTotal = state.entries.reduce((sum, entry) => sum + entry.rows.length, 0);

  if (state.files.length === 0) {
    elements.summary.textContent = 'Nenhum arquivo carregado.';
    return;
  }

  elements.summary.textContent = `${entries.length} de ${state.entries.length} SQLs visiveis, ${rowTotal} linhas de resultado. ${existing.length} arquivo(s) lido(s), ${missing.length} ausente(s).`;
}

function renderEntryList() {
  const entries = filteredEntries();
  renderSummary(entries);

  if (state.files.length === 0) {
    elements.entryList.innerHTML = '<div class="empty">Carregue os arquivos de log para iniciar.</div>';
    return;
  }

  if (entries.length === 0) {
    elements.entryList.innerHTML = '<div class="empty">Nenhuma query encontrada.</div>';
    return;
  }

  elements.entryList.innerHTML = entries.map((entry) => {
    const title = entryDisplayTitle(entry);
    const subtitle = entryDisplaySubtitle(entry);
    return `
      <button class="entry-item ${entry.id === state.selectedId ? 'active' : ''}" data-id="${escapeHtml(entry.id)}">
        <span class="entry-title">
          <span>${escapeHtml(title)}</span>
          <span>${escapeHtml(entry.durationMs ?? '-')} ms</span>
        </span>
        <span class="entry-meta">${escapeHtml(subtitle)}</span>
        <span class="entry-sql">${escapeHtml(entry.normalizedSql || entry.sql || 'Sem SQL capturado')}</span>
      </button>
    `;
  }).join('');
}

function renderTable(entry) {
  if (!entry || entry.rows.length === 0) {
    elements.resultTable.innerHTML = '<tbody><tr><td class="empty">Nenhum resultado retornado neste trecho.</td></tr></tbody>';
    elements.tableHint.textContent = '';
    return;
  }

  const columnCount = Math.max(...entry.rows.map((row) => row.length));
  const header = Array.from({ length: columnCount }, (_, index) => `<th>Col ${index + 1}</th>`).join('');
  const body = entry.rows.map((row) => {
    const cells = Array.from({ length: columnCount }, (_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  elements.tableHint.textContent = `${entry.rows.length} linha(s), ${columnCount} coluna(s)`;
  elements.resultTable.innerHTML = `<thead><tr>${header}</tr></thead><tbody>${body}</tbody>`;
}

function renderSelectedEntry() {
  const entry = selectedEntry();

  if (!entry) {
    elements.selectedFile.textContent = 'Nenhum item selecionado';
    elements.selectedTitle.textContent = 'Selecione uma query';
    elements.metaObject.textContent = '-';
    elements.organization.textContent = '-';
    elements.date.textContent = '-';
    elements.duration.textContent = '-';
    elements.rowCount.textContent = '-';
    elements.sqlOutput.textContent = state.files.length === 0 ? 'Carregue ldbinsp0_1.txt e/ou ldbinsp0_2.txt.' : 'Aguardando selecao...';
    elements.rawOutput.textContent = '';
    elements.resultTable.innerHTML = '<tbody><tr><td class="empty">Selecione uma query na lista lateral.</td></tr></tbody>';
    elements.tableHint.textContent = '';
    return;
  }

  elements.selectedFile.textContent = `${entry.fileName} | linha ${entry.lineNumber}`;
  elements.selectedTitle.textContent = entryDisplayTitle(entry);
  elements.metaObject.textContent = entry.meta4Object || '-';
  elements.organization.textContent = entry.connection?.organization || '-';
  elements.date.textContent = formatDate(entry.connection?.date);
  elements.duration.textContent = entry.durationMs == null ? '-' : `${entry.durationMs} ms`;
  elements.rowCount.textContent = String(entry.recordCount ?? entry.rows.length);
  elements.sqlOutput.innerHTML = entry.sql ? highlightSql(entry.sql) : 'Sem SQL capturado.';
  elements.rawOutput.textContent = (entry.rawLines || []).join('\n');
  renderTable(entry);
}

function render() {
  renderEntryList();
  renderSelectedEntry();
}

async function readLogFile(file) {
  const buffer = await file.arrayBuffer();
  return {
    fileName: file.name,
    exists: true,
    size: file.size,
    modifiedAt: new Date(file.lastModified).toISOString(),
    content: decodeBuffer(buffer)
  };
}

async function loadFiles(fileList, keepSelection = false) {
  const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith('.txt'));
  if (files.length === 0) {
    elements.summary.textContent = 'Selecione ao menos um arquivo .txt.';
    return;
  }

  state.loadedFiles = files;
  elements.summary.textContent = 'Lendo arquivos...';

  const parsedFiles = await Promise.all(files.map(readLogFile));
  const entries = parsedFiles.flatMap((file) => parseLogContent(file.content, file.fileName));

  state.files = parsedFiles.map(({ content, ...file }) => file);
  state.entries = entries;
  elements.logDir.textContent = `${state.files.length} arquivo(s) carregado(s) no navegador`;

  if (!keepSelection || !state.entries.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = state.entries[0]?.id || null;
  }

  render();
}

function reloadLoadedFiles() {
  if (state.loadedFiles.length === 0) {
    elements.fileInput.click();
    return;
  }
  loadFiles(state.loadedFiles, true).catch((error) => {
    elements.summary.textContent = error.message;
  });
}

elements.entryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) {
    return;
  }
  state.selectedId = button.dataset.id;
  render();
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.filterFile = button.dataset.file;
    const visible = filteredEntries();
    if (!visible.some((entry) => entry.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
    }
    render();
  });
});

elements.searchInput.addEventListener('input', () => {
  state.search = elements.searchInput.value;
  const visible = filteredEntries();
  if (!visible.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
  }
  render();
});

elements.fileInput.addEventListener('change', () => {
  loadFiles(elements.fileInput.files).catch((error) => {
    elements.summary.textContent = error.message;
  });
});

['dragenter', 'dragover'].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
});

elements.dropZone.addEventListener('drop', (event) => {
  loadFiles(event.dataTransfer.files).catch((error) => {
    elements.summary.textContent = error.message;
  });
});

elements.copyButton.addEventListener('click', async () => {
  const entry = selectedEntry();
  if (!entry?.sql) {
    return;
  }
  await navigator.clipboard.writeText(entry.sql);
  const original = elements.copyButton.textContent;
  elements.copyButton.textContent = 'Copiado';
  window.setTimeout(() => {
    elements.copyButton.textContent = original;
  }, 1200);
});

elements.refreshButton.addEventListener('click', reloadLoadedFiles);

render();
