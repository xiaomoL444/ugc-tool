export interface UndoCommand {
  undo: () => void
  redo: () => void
  groupId?: string

  label?: string
}

export default class UndoManager {
  /** Adds a command to the queue */
  add(command: UndoCommand): this

  /** Undo last command or command group */
  undo(): this

  /** Redo next command or command group */
  redo(): this

  /** Clear all commands */
  clear(): void

  /** Whether undo is available */
  hasUndo(): boolean

  /** Whether redo is available */
  hasRedo(): boolean

  /** Set max undo steps (0 = unlimited) */
  setLimit(max: number): void

  /** Register callback on undo/redo/add/clear */
  setCallback(cb: () => void): void

  /** Get current command index */
  getIndex(): number

  /** Get all commands or commands of a group */
  getCommands(groupId?: string): UndoCommand[]
}
