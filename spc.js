// spc.js
const vscode = require('vscode');

// ============================================================
// Типы токенов для SNAR-A1
// ============================================================

const TOKEN_TYPES = [
    'string',       // 0 — "..." (только двойные кавычки)
    'comment',      // 1 — #! в начале строки
    'variable',     // 2 — имя параметра (identifier)
    'operator',     // 3 — & (reference)
    'type',         // 4 — {name} (interpolation)
    'number',       // 5 — reserved, не используется
];
const TOKEN_MODIFIERS = [];

const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

// ============================================================
// Токенизация SNAR-A1
// ============================================================

/**
 * Размечает одну строку.
 *
 * Формат: {whitespace} [ parameter | comment ] {whitespace}
 *
 * parameter = identifier "[" value "]"
 * value     = string | array
 * string    = '"' { string-char | interpolation } '"'
 * array     = '(' [ element { ',' element } ] ')'
 * element   = string | reference
 * reference = "&" identifier
 * comment   = "#!" ...
 */
function tokenizeLine(line, lineIdx, tokens) {
    let i = 0;

    // Ведущие пробелы
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= line.length) return;

    // Комментарий #! в начале строки
    if (line[i] === '#' && line[i + 1] === '!') {
        tokens.push({
            line: lineIdx,
            start: i,
            length: line.length - i,
            type: 'comment',
        });
        return;
    }

    // Параметр: identifier "[" value "]"
    if (/[A-Za-z_]/.test(line[i])) {
        const start = i;
        while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) i++;
        tokens.push({
            line: lineIdx,
            start,
            length: i - start,
            type: 'variable',
        });
    } else {
        return;
    }

    // [
    if (i >= line.length || line[i] !== '[') return;
    i++;

    // Внутри — value
    while (i < line.length && line[i] !== ']') {
        const ch = line[i];

        // Строка "..."
        if (ch === '"') {
            const strStart = i;
            i++;
            while (i < line.length && line[i] !== '"') {
                // Интерполяция {name}
                if (line[i] === '{') {
                    if (i > strStart) {
                        tokens.push({
                            line: lineIdx,
                            start: strStart,
                            length: i - strStart,
                            type: 'string',
                        });
                    }
                    const interpStart = i;
                    i++;
                    while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) i++;
                    if (i < line.length && line[i] === '}') i++;
                    tokens.push({
                        line: lineIdx,
                        start: interpStart,
                        length: i - interpStart,
                        type: 'type',
                    });
                    // Продолжаем строку с текущей позиции
                    const newStrStart = i;
                    while (i < line.length && line[i] !== '"' && line[i] !== '{') i++;
                    if (i > newStrStart) {
                        tokens.push({
                            line: lineIdx,
                            start: newStrStart,
                            length: i - newStrStart,
                            type: 'string',
                        });
                    }
                    if (i < line.length && line[i] === '{') continue;
                    break;
                }
                i++;
            }
            if (i < line.length && line[i] === '"') {
                // Если не было разметки — размечаем остаток как string
                const lastToken = tokens[tokens.length - 1];
                const expectedStart = (lastToken && lastToken.line === lineIdx)
                    ? lastToken.start + lastToken.length
                    : strStart;
                if (expectedStart <= i) {
                    tokens.push({
                        line: lineIdx,
                        start: expectedStart,
                        length: i + 1 - expectedStart,
                        type: 'string',
                    });
                }
                i++;
            }
            continue;
        }

        // Массив ( ... )
        if (ch === '(') {
            i++;
            while (i < line.length && line[i] !== ')') {
                const e = line[i];

                // Reference &name
                if (e === '&') {
                    const refStart = i;
                    i++;
                    while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) i++;
                    tokens.push({
                        line: lineIdx,
                        start: refStart,
                        length: i - refStart,
                        type: 'operator',
                    });
                    continue;
                }

                // Строка внутри массива
                if (e === '"') {
                    const strStart = i;
                    i++;
                    while (i < line.length && line[i] !== '"') {
                        if (line[i] === '{') {
                            if (i > strStart) {
                                tokens.push({
                                    line: lineIdx,
                                    start: strStart,
                                    length: i - strStart,
                                    type: 'string',
                                });
                            }
                            const interpStart = i;
                            i++;
                            while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) i++;
                            if (i < line.length && line[i] === '}') i++;
                            tokens.push({
                                line: lineIdx,
                                start: interpStart,
                                length: i - interpStart,
                                type: 'type',
                            });
                            const newStrStart = i;
                            while (i < line.length && line[i] !== '"' && line[i] !== '{') i++;
                            if (i > newStrStart) {
                                tokens.push({
                                    line: lineIdx,
                                    start: newStrStart,
                                    length: i - newStrStart,
                                    type: 'string',
                                });
                            }
                            if (i < line.length && line[i] === '{') continue;
                            break;
                        }
                        i++;
                    }
                    if (i < line.length && line[i] === '"') {
                        const lastToken = tokens[tokens.length - 1];
                        const expectedStart = (lastToken && lastToken.line === lineIdx)
                            ? lastToken.start + lastToken.length
                            : strStart;
                        if (expectedStart <= i) {
                            tokens.push({
                                line: lineIdx,
                                start: expectedStart,
                                length: i + 1 - expectedStart,
                                type: 'string',
                            });
                        }
                        i++;
                    }
                    continue;
                }

                i++;
            }
            if (i < line.length && line[i] === ')') i++;
            continue;
        }

        i++;
    }
}

function tokenize(text) {
    const tokens = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        tokenizeLine(lines[lineIdx], lineIdx, tokens);
    }
    return tokens;
}

// ============================================================
// Activation
// ============================================================

function activateSpc(context) {
    const provider = vscode.languages.registerDocumentSemanticTokensProvider(
        'spc',
        {
            provideDocumentSemanticTokens(document) {
                const tokens = tokenize(document.getText());
                const builder = new vscode.SemanticTokensBuilder(LEGEND);
                for (const t of tokens) {
                    const typeIdx = TOKEN_TYPES.indexOf(t.type);
                    if (typeIdx < 0) continue;
                    builder.push(t.line, t.start, t.length, typeIdx, 0);
                }
                return builder.build();
            }
        },
        LEGEND
    );
    context.subscriptions.push(provider);
}

module.exports = { activateSpc, tokenize };