import * as vscode from 'vscode';

// Extract the leading line number from a text line, or null if absent
function getLineNumber(text: string): number | null {
    const match = text.trimStart().match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

// Remove the leading line number and exactly ONE following space from a line,
// preserving any additional indentation (spaces used for FOR/NEXT etc.).
function stripLineNumber(text: string): string {
    return text.trimStart().replace(/^\d+\s?/, '');
}

// Replace old line numbers in branch/jump targets according to a shift map.
// Covers: GOTO, GOSUB, THEN <num>, ELSE <num>, RUN <num>, RESTORE <num>
function patchBranches(code: string, map: Map<number, number>): string {
    return code.replace(
        /\b(GOTO|GOSUB|THEN|ELSE|RUN|RESTORE)\s+(\d+)/gi,
        (_, cmd: string, num: string) => {
            const updated = map.get(parseInt(num, 10));
            return updated !== undefined ? `${cmd} ${updated}` : `${cmd} ${num}`;
        }
    );
}

// Returns [firstLine, lastLine] of the active selection when it spans at least
// one full line; otherwise returns [0, lineCount-1] (whole document).
function getTargetRange(editor: vscode.TextEditor): [number, number] {
    const sel = editor.selection;
    if (!sel.isEmpty) {
        // If the selection ends exactly at column 0 of a line, exclude that line
        const endLine =
            sel.end.character === 0 && sel.end.line > sel.start.line
                ? sel.end.line - 1
                : sel.end.line;
        return [sel.start.line, endLine];
    }
    return [0, editor.document.lineCount - 1];
}

export function activate(context: vscode.ExtensionContext) {

    //  Add line numbers
    const addLineNumbers = vscode.commands.registerCommand('basic.addLineNumbers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const config = vscode.workspace.getConfiguration('basicLineNumber');
        const start  = config.get<number>('start', 100);
        const step   = config.get<number>('step',  10);
        const doc    = editor.document;
        const edit   = new vscode.WorkspaceEdit();

        const [firstLine, lastLine] = getTargetRange(editor);

        let current  = start;
        const firstText = doc.lineAt(firstLine).text;
        const match = firstText.match(/^(\d+)/);
        if (match) {
            current = parseInt(match[1], 10);
        }

        for (let i = firstLine; i <= lastLine; i++) {
            const line = doc.lineAt(i);
            if (line.text.trim() === '') continue;
            const code = stripLineNumber(line.text); // strip existing number if any
            edit.replace(doc.uri, line.range, `${current} ${code}`);
            current += step;
        }

        await vscode.workspace.applyEdit(edit);
    });

    //  Remove line numbers
    const removeLineNumbers = vscode.commands.registerCommand('basic.removeLineNumbers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const doc  = editor.document;
        const edit = new vscode.WorkspaceEdit();

        const [firstLine, lastLine] = getTargetRange(editor);

        for (let i = firstLine; i <= lastLine; i++) {
            const line = doc.lineAt(i);
            if (line.text.trim() === '') continue;
            if (getLineNumber(line.text) !== null) {
                edit.replace(doc.uri, line.range, stripLineNumber(line.text));
            }
        }

        await vscode.workspace.applyEdit(edit);
    });

    //  Renumber lines and update GOTO / GOSUB / THEN / ELSE / RUN / RESTORE
    const renumber = vscode.commands.registerCommand('basic.renumber', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const config      = vscode.workspace.getConfiguration('basicLineNumber');
        const start       = config.get<number>('start', 100);
        const step        = config.get<number>('step',  10);
        const doc         = editor.document;
        const isSelection = !editor.selection.isEmpty;

        const lines: string[] = [];
        for (let i = 0; i < doc.lineCount; i++) {
            lines.push(doc.lineAt(i).text);
        }

        const [firstLine, lastLine] = getTargetRange(editor);

        let current    = start;
        const firstText = doc.lineAt(firstLine).text;
        const match = firstText.match(/^(\d+)/);
        if (match) {
            current = parseInt(match[1], 10);
        }

        let emptyCount = 0;

        // newNumbers[i] holds the new line number for document line i,
        // or null if the line keeps no number (blank / unnumbered block).
        const newNumbers: (number | null)[] = new Array(lines.length).fill(null);
        const numberMap  = new Map<number, number>(); // old → new

        // walk the target range, assign new numbers, build the map
        for (let i = firstLine; i <= lastLine; i++) {
            const trimmed = lines[i].trim();

            if (trimmed === '') {
                emptyCount++;
                continue; // leave newNumbers[i] = null
            }

            // For whole-document mode: two+ blank lines signal an unnumbered block
            if (!isSelection && emptyCount >= 2) {
                emptyCount = 0;
                continue; // newNumbers[i] stays null
            }

            emptyCount = 0;

            // Record the old→new mapping so branch targets can be patched
            const oldNum = getLineNumber(lines[i]);
            if (oldNum !== null) {
                numberMap.set(oldNum, current);
            }

            newNumbers[i] = current;
            current += step;
        }

        const edit = new vscode.WorkspaceEdit();

        // rewrite target lines; patch branches in ALL lines
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') continue;

            // Strip exactly one space after the line number to preserve indentation,
            // then patch branch targets
            const rawCode = trimmed.replace(/^\d+\s?/, '');
            const patched = patchBranches(rawCode, numberMap);

            const inTarget = i >= firstLine && i <= lastLine;

            if (inTarget) {
                const newNum  = newNumbers[i];
                const newText = newNum !== null ? `${newNum} ${patched}` : patched;
                edit.replace(doc.uri, doc.lineAt(i).range, newText);
            } else if (patched !== rawCode) {
                // Outside the target range: only touch the line if a branch
                // target changed; preserve the existing line number.
                const existingNum = getLineNumber(lines[i]);
                const prefix      = existingNum !== null ? `${existingNum} ` : '';
                edit.replace(doc.uri, doc.lineAt(i).range, `${prefix}${patched}`);
            }
        }

        await vscode.workspace.applyEdit(edit);
    });

    // Enter key handler
    const insertLine = vscode.commands.registerCommand('basic.insertLineWithNumber', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const config = vscode.workspace.getConfiguration('basicLineNumber');
        const step   = config.get<number>('step', 10);

        const doc       = editor.document;
        const selection = editor.selection;
        const pos       = selection.active;
        const curLine   = doc.lineAt(pos.line);
        const curNum    = getLineNumber(curLine.text);

        // No line number → fallback to default Enter behavior
        if (curNum === null) {
            await vscode.commands.executeCommand('default:type', { text: '\n' });
            return;
        }

        const isAtLineStart = pos.character === 0;
        const isAtLineEnd   = pos.character === curLine.range.end.character;
        const isMiddle      = !isAtLineStart && !isAtLineEnd;

        const fullText = curLine.text;

        // shared shift logic (kept identical to original Enter branch)
        const buildShiftEdit = (baseLine: number, nextNum: number) => {
            const allLines: string[] = [];
            for (let i = 0; i < doc.lineCount; i++) {
                allLines.push(doc.lineAt(i).text);
            }

            const shiftIndices: number[] = [];
            let expected = nextNum;

            for (let i = baseLine + 1; i < allLines.length; i++) {
                if (allLines[i].trim() === '') continue;

                const ln = getLineNumber(allLines[i]);
                if (ln === null || ln !== expected) break;

                shiftIndices.push(i);
                expected += step;
            }

            const shiftMap = new Map<number, number>();
            for (const idx of shiftIndices) {
                const ln = getLineNumber(allLines[idx])!;
                shiftMap.set(ln, ln + step);
            }

            const edit = new vscode.WorkspaceEdit();

            // Shift conflicting numbered lines
            for (const idx of shiftIndices) {
                const ln   = getLineNumber(allLines[idx])!;
                let   code = stripLineNumber(allLines[idx]);

                code = patchBranches(code, shiftMap);

                edit.replace(
                    doc.uri,
                    doc.lineAt(idx).range,
                    `${ln + step} ${code}`
                );
            }

            // Update all GOTO/GOSUB references in other lines
            if (shiftMap.size > 0) {
                for (let i = 0; i < allLines.length; i++) {
                    if (shiftIndices.includes(i)) continue;
                    if (allLines[i].trim() === '') continue;

                    const ln   = getLineNumber(allLines[i]);
                    let   code = stripLineNumber(allLines[i]);

                    const patched = patchBranches(code, shiftMap);

                    if (patched !== code) {
                        const prefix = ln !== null ? `${ln} ` : '';
                        edit.replace(doc.uri, doc.lineAt(i).range, `${prefix}${patched}`);
                    }
                }
            }

            return edit;
        };

        if (isAtLineStart) {
            const nextNum = curNum + step;

            const edit = buildShiftEdit(pos.line, nextNum);
            const code = stripLineNumber(fullText);

            edit.replace(doc.uri, curLine.range, `${nextNum} ${code}`);

            // Insert new numbered line ABOVE current line
            edit.insert(
                doc.uri,
                new vscode.Position(pos.line, 0),
                `${curNum} \n`
            );

            await vscode.workspace.applyEdit(edit);

            // Move cursor to new line
            editor.selection = new vscode.Selection(
                new vscode.Position(pos.line, `${nextNum} `.length),
                new vscode.Position(pos.line, `${nextNum} `.length)
            );

            return;
        }

        // Enter in the middle of a line → split the line
        if (isMiddle) {
            const left  = fullText.substring(0, pos.character);
            const right = fullText.substring(pos.character);

            const nextNum = curNum + step;

            const edit = buildShiftEdit(pos.line, nextNum);

            // Keep left part in current line
            edit.replace(doc.uri, curLine.range, `${left}`);

            // Move right part to a new numbered line
            edit.insert(
                doc.uri,
                new vscode.Position(pos.line + 1, 0),
                `${nextNum} ${right}\n`
            );

            await vscode.workspace.applyEdit(edit);

            // Move cursor to new line
            const newPos = new vscode.Position(pos.line + 1, `${nextNum} `.length);
            editor.selection = new vscode.Selection(newPos, newPos);

            return;
        }

        const curCode = stripLineNumber(curLine.text).trim();

        // Empty numbered line → remove number (separator line)
        if (curCode === '') {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(doc.uri, curLine.range, '');
            await vscode.workspace.applyEdit(edit);
            return;
        }

        // Normal Enter behavior (line end or line start)

        // Snapshot all lines before modification
        const allLines: string[] = [];
        for (let i = 0; i < doc.lineCount; i++) {
            allLines.push(doc.lineAt(i).text);
        }

        const nextNum = curNum + step;

        // Detect consecutive numbered lines that would collide
        const shiftIndices: number[] = [];
        let expected = nextNum;

        for (let i = pos.line + 1; i < allLines.length; i++) {
            if (allLines[i].trim() === '') continue;

            const ln = getLineNumber(allLines[i]);
            if (ln === null || ln !== expected) break;

            shiftIndices.push(i);
            expected += step;
        }

        // Build mapping for updating GOTO/GOSUB references
        const shiftMap = new Map<number, number>();
        for (const idx of shiftIndices) {
            const ln = getLineNumber(allLines[idx])!;
            shiftMap.set(ln, ln + step);
        }

        const edit = new vscode.WorkspaceEdit();

        // Shift conflicting numbered lines
        for (const idx of shiftIndices) {
            const ln   = getLineNumber(allLines[idx])!;
            let   code = stripLineNumber(allLines[idx]);

            code = patchBranches(code, shiftMap);

            edit.replace(
                doc.uri,
                doc.lineAt(idx).range,
                `${ln + step} ${code}`
            );
        }

        // Update all GOTO/GOSUB references in other lines
        if (shiftMap.size > 0) {
            for (let i = 0; i < allLines.length; i++) {
                if (shiftIndices.includes(i)) continue;
                if (allLines[i].trim() === '') continue;

                const ln   = getLineNumber(allLines[i]);
                let   code = stripLineNumber(allLines[i]);

                const patched = patchBranches(code, shiftMap);

                if (patched !== code) {
                    const prefix = ln !== null ? `${ln} ` : '';
                    edit.replace(doc.uri, doc.lineAt(i).range, `${prefix}${patched}`);
                }
            }
        }

        // Insert new numbered line
        const endOfCurLine = new vscode.Position(
            pos.line,
            curLine.range.end.character
        );

        edit.insert(doc.uri, endOfCurLine, `\n${nextNum} `);

        await vscode.workspace.applyEdit(edit);

        // Move cursor to new line
        const newPos = new vscode.Position(pos.line + 1, `${nextNum} `.length);
        editor.selection = new vscode.Selection(newPos, newPos);
    });

    context.subscriptions.push(addLineNumbers, removeLineNumbers, renumber, insertLine);
}

export function deactivate() {}