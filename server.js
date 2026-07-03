const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const LOG_DIR = process.env.M4_LOG_DIR || 'C:\\ProgramData\\meta4\\M4Temp\\m4ldb';
const LOG_FILES = ['ldbinsp0_1.txt', 'ldbinsp0_2.txt'];
const PUBLIC_DIR = path.join(__dirname, 'public');

function decodeBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) {
    return buffer.toString('latin1');
  }
  return utf8;
}

function getLogPath(fileName) {
  if (!LOG_FILES.includes(fileName)) {
    return null;
  }
  return path.join(LOG_DIR, fileName);
}

function readLogFile(fileName) {
  const filePath = getLogPath(fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    return { fileName, filePath, exists: false, content: '' };
  }

  const stat = fs.statSync(filePath);
  const content = decodeBuffer(fs.readFileSync(filePath));
  return {
    fileName,
    filePath,
    exists: true,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content
  };
}

function parseHeader(line) {
  const objectMatch = line.match(/Meta4Object\s*=\s*([^.\r\n]+)/i);
  const nodeMatch = line.match(/Node\s*=\s*([^.\r\n]+)/i);
  const recordSetMatch = line.match(/RecordSet\s*=\s*([^.\r\n]+)/i);
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
  const dateMatch = line.match(/Date\s*=\s*([^.\r\n]+)/i);
  const tickMatch = line.match(/Tick\s*=\s*([^.\r\n]+)/i);
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
  return /^("?[^"]+"?|-?[0-9]|NULL\b)/i.test(trimmed);
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
    current.sql = current.sql.trim();
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

function getParsedLogs() {
  const files = LOG_FILES.map(readLogFile);
  const entries = files.flatMap((file) => (
    file.exists ? parseLogContent(file.content, file.fileName) : []
  ));

  return {
    logDir: LOG_DIR,
    files: files.map(({ content, ...file }) => file),
    entries
  };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sendStatic(response, requestPath) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';

  response.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/api/logs') {
      sendJson(response, 200, getParsedLogs());
      return;
    }

    if (url.pathname === '/api/raw') {
      const fileName = url.searchParams.get('file') || LOG_FILES[0];
      const file = readLogFile(fileName);
      if (!file.exists) {
        sendJson(response, 404, file);
        return;
      }
      sendJson(response, 200, file);
      return;
    }

    sendStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    sendJson(response, 500, {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

server.listen(PORT, () => {
  console.log(`M4 Log Visualizer running at http://localhost:${PORT}`);
  console.log(`Reading logs from ${LOG_DIR}`);
});

