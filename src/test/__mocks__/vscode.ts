/**
 * Mock for the vscode module used in unit tests.
 * Provides stubs for the VS Code APIs our extension uses.
 */

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const TextDocumentChangeReason = {
  Undo: 1,
  Redo: 2,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
  parse: (str: string) => ({ fsPath: str, toString: () => str }),
};

export const EventEmitter = class {
  handlers: Function[] = [];
  event = (handler: Function) => {
    this.handlers.push(handler);
    return { dispose: () => {} };
  };
  fire(data: any) {
    this.handlers.forEach((h) => h(data));
  }
};

const createMockStatusBarItem = () => ({
  text: '',
  tooltip: '',
  command: '',
  show: () => {},
  hide: () => {},
  dispose: () => {},
});

export const window = {
  createStatusBarItem: () => createMockStatusBarItem(),
  createWebviewPanel: () => ({
    webview: { html: '', options: {} },
    reveal: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  activeTextEditor: undefined,
  visibleTextEditors: [],
  tabGroups: { all: [] },
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
};

export const workspace = {
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
  onDidOpenTextDocument: () => ({ dispose: () => {} }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  textDocuments: [],
  getConfiguration: () => ({
    get: (key: string, defaultValue: any) => defaultValue,
  }),
  openTextDocument: async (opts: any) => ({
    getText: () => opts?.content || '',
    uri: Uri.file('/mock'),
  }),
};

export const languages = {
  registerInlineCompletionItemProvider: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (_id: string, _handler: Function) => ({ dispose: () => {} }),
  executeCommand: async () => {},
  getCommands: async () => [],
};

export const extensions = {
  getExtension: (_id: string) => undefined,
};

export default {
  StatusBarAlignment,
  TextDocumentChangeReason,
  ViewColumn,
  Uri,
  EventEmitter,
  window,
  workspace,
  languages,
  commands,
  extensions,
};
