# BASIC Line Tools

A practical line-numbering toolkit for BASIC in Visual Studio Code.

This extension provides fast and reliable commands to add, remove, and renumber line numbers — with automatic updates for branching statements like `GOTO` and `GOSUB`.

---

## Features

- Add line numbers to entire files or selections
- Remove existing line numbers safely
- Renumber lines with configurable start and step values
- Automatically updates branch targets:
  - `GOTO`
  - `GOSUB`
  - `THEN`
  - `ELSE`
  - `RUN`
  - `RESTORE`
- Smart Enter key behavior:
  - Inserts the next numbered line automatically
  - Shifts conflicting lines when necessary
  - Updates all affected jump targets
- Preserves indentation (important for structured BASIC code)

---

## Commands

Available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or editor context menu:

- `BASIC: Add Line Numbers (or Selection)`
- `BASIC: Remove Line Numbers (or Selection)`
- `BASIC: Renumber Lines (or Selection)`

---

## Smart Enter Behavior

When editing a BASIC file:

- Press **Enter** on a numbered line → inserts the next numbered line
- If needed, subsequent lines are automatically shifted
- All affected `GOTO` / `GOSUB` targets are updated

### Special Case: Double Enter

- Press Enter on an empty numbered line → removes the line number
- Useful for creating visual spacing (unnumbered blocks)

---

## Configuration

Customize behavior in VS Code settings:

| Setting | Default | Description |
|--------|--------|------------|
| `basicLineNumber.start` | `100` | Starting line number |
| `basicLineNumber.step`  | `10`  | Increment between lines |

---

## How It Works

### Renumbering Logic

- Detects existing line numbers
- Builds a mapping of old → new numbers
- Rewrites all affected lines
- Updates branch instructions globally (even outside selection when needed)

### Intelligent Block Handling

- Multiple blank lines can act as separators
- Prevents unintended renumbering across logical blocks

---

## License
MIT License