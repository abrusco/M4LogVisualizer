const DEFAULT_LOG_DIR = String.raw`C:\ProgramData\meta4\M4Temp\m4ldb`;
const DEFAULT_LOG_FILES = ['ldbinsp0_1.txt', 'ldbinsp0_2.txt'];
const ALWAYS_IGNORED_OBJECTS = new Set([
  'M4PRES_MAPPINGS',
  'M4OBJECT_MAPPINGS',
  'SAV_PARAMS',
  'M4DINAMICPARAM',
  'ELIGIBILITY_CHANNEL',
  'DESIGN_CHANNEL',
  'DICTIONARY_QUERY',
  'DM_DESIGNER_3T',
  'DC_M4_TYPES',
  'SBP__RT',
  'SCH_MD_VERSION',
  'C4_JS_TASK_EXPIRATION',
  'CH_JS_SITE_DEF',
  'C4_JS_SCHED_DATES',
  'C4_JS_SCHEDULING',
  'C4_JS_INFO_TASKS',
  'C4_JS_TASK_DEF',
  'CH_JS_DST_INFO',
  'CH_JS_T_EXEC_STATUS',
  'C4_JS_DOCS',
  'C4_JSFE_EXE_LIST',
  'C4_JSFE_RESULTS',
  'M4LOAD'
]);
const SYSTEM_LOG_OBJECT_PREFIXES = [
  'SCH_',
  'SRTC_',
  'SSC_',
  'SCO_',
  'SCC_',
  'SRP_',
  'STD_',
  'M4R'
];
const SYSTEM_LOG_OBJECTS = new Set([
  'SCH_SESSION',
  'SCH_LEVEL2_ITEMS',
  'SRTC_LOGON_PARAMS',
  'SSC_APPUSER',
  'SSC_APP_USER',
  'SSC_APP_USERS'
]);

const state = {
  entries: [],
  files: [],
  loadedFiles: [],
  source: 'default',
  selectedId: null,
  filterFile: 'all',
  search: '',
  onlyRealStmt: false,
  descendingLogOrder: true
};

const elements = {
  logDir: document.querySelector('#logDir'),
  summary: document.querySelector('#summary'),
  entryList: document.querySelector('#entryList'),
  searchInput: document.querySelector('#searchInput'),
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('#dropZone'),
  onlyRealStmt: document.querySelector('#onlyRealStmt'),
  sortDescButton: document.querySelector('#sortDescButton'),
  sortIcon: document.querySelector('#sortIcon'),
  selectedFile: document.querySelector('#selectedFile'),
  selectedTitle: document.querySelector('#selectedTitle'),
  metaObject: document.querySelector('#metaObject'),
  organization: document.querySelector('#organization'),
  date: document.querySelector('#date'),
  duration: document.querySelector('#duration'),
  rowCount: document.querySelector('#rowCount'),
  sqlOutput: document.querySelector('#sqlOutput'),
  formatSqlButton: document.querySelector('#formatSqlButton'),
  rawOutput: document.querySelector('#rawOutput'),
  resultTable: document.querySelector('#resultTable'),
  tableHint: document.querySelector('#tableHint'),
  themeButton: document.querySelector('#themeButton'),
  themeIcon: document.querySelector('#themeIcon'),
  copyButton: document.querySelector('#copyButton'),
  refreshButton: document.querySelector('#refreshButton')
};

function getStoredTheme() {
  try {
    return localStorage.getItem('m4-theme');
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem('m4-theme', theme);
  } catch {
    // Tema continua funcionando mesmo quando o navegador bloqueia localStorage.
  }
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalizedTheme;
  if (document.body) {
    document.body.dataset.theme = normalizedTheme;
  }
  if (!elements.themeButton) {
    return;
  }
  const iconTarget = elements.themeIcon || elements.themeButton;
  elements.themeButton.dataset.theme = normalizedTheme;
  iconTarget.textContent = normalizedTheme === 'dark' ? '☾' : '☀';
  elements.themeButton.title = normalizedTheme === 'dark' ? 'Tema escuro ativo. Alternar para tema claro' : 'Tema claro ativo. Alternar para tema escuro';
  elements.themeButton.setAttribute('aria-label', elements.themeButton.title);
}

function initializeTheme() {
  const storedTheme = getStoredTheme();
  const preferredTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(storedTheme || preferredTheme);
}
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

function isAlwaysIgnoredEntry(entry) {
  const object = (entry.meta4Object || '').toUpperCase();
  return ALWAYS_IGNORED_OBJECTS.has(object);
}
function isSystemLogEntry(entry) {
  const object = (entry.meta4Object || '').toUpperCase();
  if (!object) {
    return false;
  }
  if (SYSTEM_LOG_OBJECTS.has(object)) {
    return true;
  }
  return SYSTEM_LOG_OBJECT_PREFIXES.some((prefix) => object.startsWith(prefix));
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

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function getExecutionType(headerLine) {
  const match = headerLine.match(/^\s*Execute\s+([^\.]+)/i);
  return match ? match[1].trim() : '';
}

function createEntry(fileName, index, headerLine) {
  return {
    id: `${fileName}-${index}`,
    fileName,
    lineNumber: index + 1,
    executionType: getExecutionType(headerLine),
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
    executionType: entry.executionType,
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
    current.sql = current.sql.trim();
    current.normalizedSql = normalizeSql(current.sql);
    entries.push(current);
    current = null;
    readingSql = false;
  }

  lines.forEach((line, index) => {
    if (/^\s*Execute (?:Real Stmt|Load)\./i.test(line)) {
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

function splitSqlTokens(sql) {
  const tokens = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        i += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function formatSql(sql) {
  const normalized = normalizeSql(sql || '');
  if (!normalized) {
    return '';
  }

  const tokens = splitSqlTokens(normalized);
  const majorKeywords = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION']);
  const joinKeywords = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER']);
  const conditionKeywords = new Set(['AND', 'OR']);
  const lines = [];
  let current = '';
  let indent = 0;

  function pushCurrent() {
    const trimmed = current.trim();
    if (trimmed) {
      lines.push(`${'  '.repeat(Math.max(indent, 0))}${trimmed}`);
    }
    current = '';
  }

  tokens.forEach((token) => {
    const upper = token.toUpperCase();
    const startsClause = majorKeywords.has(upper) || joinKeywords.has(upper) || conditionKeywords.has(upper);

    if (upper === 'SELECT') {
      pushCurrent();
      indent = 0;
      current = token;
      return;
    }

    if (upper === 'FROM' || upper === 'WHERE' || upper === 'GROUP' || upper === 'ORDER' || upper === 'HAVING' || upper === 'UNION') {
      pushCurrent();
      indent = 0;
      current = token;
      return;
    }

    if (joinKeywords.has(upper) || upper === 'ON') {
      pushCurrent();
      indent = upper === 'ON' ? 1 : 0;
      current = token;
      return;
    }

    if (conditionKeywords.has(upper)) {
      pushCurrent();
      indent = 1;
      current = token;
      return;
    }

    if (token.includes('(') && !token.includes(')')) {
      current += current ? ` ${token}` : token;
      indent += 1;
      return;
    }

    if (token.includes(')') && !token.includes('(')) {
      indent = Math.max(indent - 1, 0);
    }

    current += current ? ` ${token}` : token;

    if (current.length > 120 && !startsClause) {
      pushCurrent();
      indent = Math.max(indent, 1);
    }
  });

  pushCurrent();
  return lines.join('\n');
}

function currentSqlText(entry = selectedEntry()) {
  if (!entry?.sql) {
    return '';
  }
  return state.formatSql ? formatSql(entry.sql) : entry.sql;
}

function updateFormatSqlButton() {
  if (!elements.formatSqlButton) {
    return;
  }
  elements.formatSqlButton.textContent = state.formatSql ? 'SQL original' : 'Formatar SQL';
  elements.formatSqlButton.title = state.formatSql ? 'Mostrar SQL original' : 'Formatar e indentar SQL';
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

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
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
    formatDate(entry.connection?.date) || 'sem data',
    `${entry.rows.length} linha(s)`
  ];

  return parts.join(' | ');
}

function entrySortTime(entry) {
  const dateText = entry.connection?.date || '';
  const normalized = dateText.replace(' ', 'T');
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareEntriesDescending(a, b) {
  const dateDiff = entrySortTime(b) - entrySortTime(a);
  if (dateDiff !== 0) {
    return dateDiff;
  }
  const fileOrderDiff = (b.fileOrder || 0) - (a.fileOrder || 0);
  if (fileOrderDiff !== 0) {
    return fileOrderDiff;
  }
  return (b.lineNumber || 0) - (a.lineNumber || 0);
}

function compareEntriesOriginal(a, b) {
  const fileOrderDiff = (a.fileOrder || 0) - (b.fileOrder || 0);
  if (fileOrderDiff !== 0) {
    return fileOrderDiff;
  }
  return (a.lineNumber || 0) - (b.lineNumber || 0);
}

function updateSortButton() {
  if (!elements.sortDescButton) {
    return;
  }
  const title = state.descendingLogOrder ? 'Eventos mais recentes no topo' : 'Eventos na ordem do arquivo';
  elements.sortDescButton.classList.toggle('active', state.descendingLogOrder);
  elements.sortDescButton.title = title;
  elements.sortDescButton.setAttribute('aria-label', title);
  if (elements.sortIcon) {
    elements.sortIcon.textContent = state.descendingLogOrder ? '↓' : '↑';
  }
}

function filteredEntries() {
  const search = state.search.trim().toLowerCase();
  const entries = state.entries.filter((entry) => {
    const fileMatches = state.filterFile === 'all' || entry.fileName === state.filterFile;
    const ignoredObjectMatches = !isAlwaysIgnoredEntry(entry);
    const realStmtMatches = !state.onlyRealStmt || entry.executionType === 'Real Stmt';
    const searchMatches = !search || entrySearchText(entry).includes(search);
    return fileMatches && ignoredObjectMatches && realStmtMatches && searchMatches;
  });

  return entries.sort(state.descendingLogOrder ? compareEntriesDescending : compareEntriesOriginal);
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
    updateFormatSqlButton();
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
  const sqlText = currentSqlText(entry);
  elements.sqlOutput.innerHTML = sqlText ? highlightSql(sqlText) : 'Sem SQL capturado.';
  updateFormatSqlButton();
  elements.rawOutput.textContent = (entry.rawLines || []).join('\n');
  renderTable(entry);
}

function render() {
  updateSortButton();
  renderEntryList();
  renderSelectedEntry();
}

async function readBundledLogFile(fileName) {
  const response = await fetch(`m4ldb/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
  if (!response.ok) {
    return {
      fileName,
      filePath: `${DEFAULT_LOG_DIR}\\${fileName}`,
      exists: false,
      size: 0,
      modifiedAt: '',
      content: ''
    };
  }

  const buffer = await response.arrayBuffer();
  return {
    fileName,
    filePath: `${DEFAULT_LOG_DIR}\\${fileName}`,
    exists: true,
    size: buffer.byteLength,
    modifiedAt: '',
    content: decodeBuffer(buffer)
  };
}

async function loadDefaultLogs(keepSelection = false) {
  state.source = 'default';
  state.loadedFiles = [];
  elements.summary.textContent = `Lendo ${DEFAULT_LOG_DIR}...`;

  const parsedFiles = await Promise.all(DEFAULT_LOG_FILES.map(readBundledLogFile));
  const entries = parsedFiles.flatMap((file, fileOrder) => (
    file.exists ? parseLogContent(file.content, file.fileName).map((entry) => ({ ...entry, fileOrder })) : []
  ));

  state.files = parsedFiles.map(({ content, ...file }) => file);
  state.entries = entries;
  elements.logDir.textContent = DEFAULT_LOG_DIR;

  if (!keepSelection || !state.entries.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = filteredEntries()[0]?.id || state.entries[0]?.id || null;
  }

  render();
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
  state.source = 'selected';
  elements.summary.textContent = 'Lendo arquivos...';

  const parsedFiles = await Promise.all(files.map(readLogFile));
  const entries = parsedFiles.flatMap((file, fileOrder) => (
    parseLogContent(file.content, file.fileName).map((entry) => ({ ...entry, fileOrder }))
  ));

  state.files = parsedFiles.map(({ content, ...file }) => file);
  state.entries = entries;
  elements.logDir.textContent = `${state.files.length} arquivo(s) carregado(s) no navegador`;

  if (!keepSelection || !state.entries.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = filteredEntries()[0]?.id || state.entries[0]?.id || null;
  }

  render();
}

function reloadLoadedFiles() {
  if (state.source === 'default') {
    loadDefaultLogs(true).catch((error) => {
      elements.summary.textContent = `Nao foi possivel ler m4ldb automaticamente. Selecione os arquivos manualmente. ${error.message}`;
    });
    return;
  }
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

if (elements.sortDescButton) {
  elements.sortDescButton.addEventListener('click', () => {
    state.descendingLogOrder = !state.descendingLogOrder;
    const visible = filteredEntries();
    if (!visible.some((entry) => entry.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
    }
    render();
  });
}
elements.onlyRealStmt.checked = state.onlyRealStmt;

elements.onlyRealStmt.addEventListener('change', () => {
  state.onlyRealStmt = elements.onlyRealStmt.checked;
  const visible = filteredEntries();
  if (!visible.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
  }
  render();
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

if (elements.themeButton) {
  elements.themeButton.addEventListener('click', (event) => {
  event.preventDefault();
  const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  storeTheme(nextTheme);
  });
}

if (elements.formatSqlButton) {
  elements.formatSqlButton.addEventListener('click', () => {
    state.formatSql = !state.formatSql;
    renderSelectedEntry();
  });
}

elements.copyButton.addEventListener('click', async () => {
  const entry = selectedEntry();
  if (!entry?.sql) {
    return;
  }
  await navigator.clipboard.writeText(currentSqlText(entry));
  const original = elements.copyButton.textContent;
  elements.copyButton.textContent = 'Copiado';
  window.setTimeout(() => {
    elements.copyButton.textContent = original;
  }, 1200);
});

elements.refreshButton.addEventListener('click', reloadLoadedFiles);

initializeTheme();

loadDefaultLogs().catch((error) => {
  state.files = [];
  state.entries = [];
  elements.logDir.textContent = DEFAULT_LOG_DIR;
  elements.summary.textContent = `Nao foi possivel carregar m4ldb automaticamente. Selecione os arquivos manualmente. ${error.message}`;
  render();
});




















