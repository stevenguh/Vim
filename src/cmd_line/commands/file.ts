import * as fs from 'fs';
import * as node from '../node';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import untildify = require('untildify');
import { Logger } from '../../util/logger';

async function doesFileExist(filePath: string) {
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeTextEditor) {
    // Use the Uri from the active text editor so
    // we can use the correct scheme and authority
    // for remote fs like remote ssh
    const activeUri = activeTextEditor.document.uri;
    const updatedUri = activeUri.with({ path: filePath });
    try {
      await vscode.workspace.fs.stat(updatedUri);
      return true;
    } catch {
      return false;
    }
  } else {
    // fallback to local fs
    const fsExists = util.promisify(fs.exists);
    return fsExists(filePath);
  }
}

async function createNewFile(filePath: string) {
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeTextEditor) {
    // Use the Uri from the active text editor so
    // we can use the correct scheme and authority
    // for remote fs like remote ssh
    const activeUri = activeTextEditor.document.uri;
    const updatedUri = activeUri.with({ path: filePath });
    await vscode.workspace.fs.writeFile(updatedUri, new Uint8Array(), {
      create: true,
      overwrite: false,
    });
  } else {
    // fallback to local fs
    await util.promisify(fs.close)(await util.promisify(fs.open)(filePath, 'w'));
  }
}

export enum FilePosition {
  NewWindowVerticalSplit,
  NewWindowHorizontalSplit,
}

export interface IFileCommandArguments extends node.ICommandArgs {
  name: string | undefined;
  bang?: boolean;
  position?: FilePosition;
  lineNumber?: number;
  createFileIfNotExists?: boolean;
}

export class FileCommand extends node.CommandBase {
  protected _arguments: IFileCommandArguments;
  private readonly _logger = Logger.get('File');

  constructor(args: IFileCommandArguments) {
    super();
    this._name = 'file';
    this._arguments = args;

    if (this.arguments.name) {
      this._arguments.name = this.arguments.name;
    }
  }

  get arguments(): IFileCommandArguments {
    return this._arguments;
  }

  async execute(): Promise<void> {
    if (this._arguments.bang) {
      await vscode.commands.executeCommand('workbench.action.files.revert');
      return;
    }

    // Need to do this before the split since it loses the activeTextEditor
    const editorFileUri = vscode.window.activeTextEditor!.document.uri;
    let editorFilePath = editorFileUri.fsPath;

    // Do the split if requested
    let split = false;
    if (this._arguments.position === FilePosition.NewWindowVerticalSplit) {
      await vscode.commands.executeCommand('workbench.action.splitEditorRight');
      split = true;
    }
    if (this._arguments.position === FilePosition.NewWindowHorizontalSplit) {
      await vscode.commands.executeCommand('workbench.action.splitEditorDown');
      split = true;
    }

    let hidePreviousEditor = async function() {
      if (split === true) {
        await vscode.commands.executeCommand('workbench.action.previousEditor');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      }
    };

    // No name was specified
    if (this._arguments.name === undefined) {
      if (this._arguments.createFileIfNotExists === true) {
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
        await hidePreviousEditor();
      }
      return;
    }

    let filePath = '';

    // Only untidify when the currently open page and file completion is local
    if (this.arguments.name && editorFileUri.scheme === 'file') {
      this._arguments.name = <string>untildify(this.arguments.name);
    }

    // Using the empty string will request to open a file
    if (this._arguments.name === '') {
      // No name on split is fine and just return
      if (split === true) {
        return;
      }

      const fileList = await vscode.window.showOpenDialog({});
      if (fileList) {
        filePath = fileList[0].fsPath;
      }
    } else {
      // Using a filename, open or create the file
      this._arguments.name = this._arguments.name.replace(/^file:\/\//, '');

      filePath = path.isAbsolute(this._arguments.name)
        ? path.normalize(this._arguments.name)
        : path.join(path.dirname(editorFilePath), this._arguments.name);

      if (filePath !== editorFilePath) {
        let fileExists = await doesFileExist(filePath);
        if (!fileExists) {
          // if file does not exist
          // try to find it with the same extension as the current file
          const pathWithExt = filePath + path.extname(editorFilePath);
          fileExists = await doesFileExist(pathWithExt);
          if (fileExists) {
            filePath = pathWithExt;
          }
        }

        if (!fileExists) {
          if (this._arguments.createFileIfNotExists) {
            await createNewFile(filePath);
          } else {
            this._logger.error(`${filePath} does not exist.`);
            return;
          }
        }
      }
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    vscode.window.showTextDocument(doc);

    if (this.arguments.lineNumber) {
      vscode.window.activeTextEditor!.revealRange(
        new vscode.Range(
          new vscode.Position(this.arguments.lineNumber, 0),
          new vscode.Position(this.arguments.lineNumber, 0)
        )
      );
    }
    await hidePreviousEditor();
  }
}
