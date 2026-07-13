#!/usr/bin/env node
// Convert GoatTracker player.s from Exomizer assembler syntax to xa65 syntax
//
// Issues addressed:
// 1. .IF/.ELSE/.ENDIF → #if/#else/#endif (must be at column 0 for xa)
// 2. .DEFINED(label) → hardcoded 0/1 based on our config (NOAUTHORINFO=1, NOWAVECMD=0)
// 3. .BYTE (a,b) → .byte a,b
// 4. label % 256 → (label & 255)
// 5. ldy label,y → lda label,y / tay (LDY abs,Y is not a valid 6502 instruction)
// 6. Comments with colons sanitized (xa parses label: before ; comments)

const fs = require('fs');

const inputFile = process.argv[2] || 'player.s';
const outputFile = process.argv[3] || 'build/player_xa.s';

let src = fs.readFileSync(inputFile, 'utf8');
const lines = src.split('\n');
const out = [];

// .DEFINED() resolution based on our config: NOAUTHORINFO=1, NOWAVECMD=0
// mt_effectnum: defined (NOWAVECMD=0 means ELSE branch taken, which defines it)
// mt_tick0jumptbl: NOT defined (NOAUTHORINFO=1 skips author info section)
// mt_effectjumptbl: NOT defined (same reason)
// mt_funktempotbl: NOT defined (same reason)
const definedLabels = {
    'mt_effectnum': 1,
    'mt_tick0jumptbl': 0,
    'mt_effectjumptbl': 0,
    'mt_funktempotbl': 0,
};

function resolveDefinedCalls(expr) {
    // Replace .DEFINED(label) with known values
    expr = expr.replace(/\.DEFINED\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, (match, label) => {
        if (label in definedLabels) return String(definedLabels[label]);
        return '1';
    });
    // xa doesn't support ! (NOT) operator in #if expressions
    // Resolve !0 → 1 and !1 → 0
    expr = expr.replace(/!\s*0/g, '1');
    expr = expr.replace(/!\s*1/g, '0');
    return expr;
}

function sanitizeComment(line) {
    // xa65 parses "word:" as label BEFORE processing ";" as comment start
    // Fix: replace colons in comment-only lines with dashes
    if (line.match(/^\s*;/)) {
        return line.replace(/:/g, ' -');
    }
    // For inline comments (code ; comment), only fix the comment part
    const semiPos = line.indexOf(';');
    if (semiPos > 0) {
        const code = line.substring(0, semiPos);
        const comment = line.substring(semiPos).replace(/:/g, ' -');
        return code + comment;
    }
    return line;
}

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trimStart();

    // Handle inline .IF ... .BYTE ... .ENDIF on single lines
    const inlineMatch = trimmed.match(/^\.IF\s+(\([^)]*(?:\([^)]*\))*[^)]*\))\s+\.BYTE\s+\(([^)]*)\)\s+\.ENDIF\s*$/i);
    if (inlineMatch) {
        let [, cond, byteVal] = inlineMatch;
        cond = resolveDefinedCalls(cond);
        out.push(`#if ${cond}`);
        out.push(`.byte ${byteVal}`);
        out.push(`#endif`);
        continue;
    }

    // Convert .IF → #if (at column 0)
    if (trimmed.match(/^\.IF\s+/i)) {
        let cond = trimmed.replace(/^\.IF\s+/i, '').trimEnd();
        cond = resolveDefinedCalls(cond);
        out.push(`#if ${cond}`);
        continue;
    }

    // Convert .ELSE → #else
    if (trimmed.match(/^\.ELSE\s*$/i) || trimmed.match(/^\.ELSE\s*;/i)) {
        out.push(`#else`);
        continue;
    }

    // Convert .ENDIF → #endif
    if (trimmed.match(/^\.ENDIF\s*$/i) || trimmed.match(/^\.ENDIF\s*;/i)) {
        out.push(`#endif`);
        continue;
    }

    // Resolve any remaining .DEFINED() in regular code lines
    line = resolveDefinedCalls(line);

    // Convert .BYTE (val1, val2, ...) → .byte val1, val2, ...
    line = line.replace(/\.BYTE\s+\(([^)]+)\)/gi, '.byte $1');

    // Convert % (modulo) to & for low-byte: label % 256 → (label & 255)
    line = line.replace(/(\w+)\s*%\s*256/g, '($1 & 255)');

    // Convert invalid 6502 addressing: ldy label,y → ldy label,x
    // LDY absolute,Y does not exist on 6502; LDY absolute,X does.
    // The original GT2 assembler silently uses ,x for LDY since that's
    // the only valid indexed addressing mode for LDY.
    const ldyMatch = line.match(/^(\s+)ldy\s+(\S+)\s*,\s*y\s*(;.*)?$/i);
    if (ldyMatch) {
        const [, indent, label, comment] = ldyMatch;
        const commentStr = comment ? `  ${comment}` : '';
        out.push(`${indent}ldy ${label},x${commentStr}`);
        continue;
    }

    // Sanitize comments that contain colons (xa65 quirk)
    line = sanitizeComment(line);

    out.push(line);
}

fs.writeFileSync(outputFile, out.join('\n'));
console.log(`Converted ${lines.length} lines: ${inputFile} → ${outputFile}`);
