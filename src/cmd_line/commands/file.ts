import * as vscode from 'vscode';
import { Logger } from '../../util/logger';
import { getBaseDirectoryUri, resolveDirectoryPath, isValidFileUri } from '../../util/path';
import { UriScheme } from '../../util/uriSchema';
import * as node from '../node';
import { doesFileExist } from 'platform/fs';
import untildify = require('untildify');

async function doesFileExist(fileUri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(fileUri);
    return true;
  } catch {
    return false;
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
    this._arguments = args;
  }

  get arguments(): IFileCommandArguments {
    return this._arguments;
  }

  async execute(): Promise<void> {
    if (this.arguments.bang) {
      await vscode.commands.executeCommand('workbench.action.files.revert');
      return;
    }

    // Need to do this before the split since it loses the activeTextEditor
    const editorFileUri = vscode.window.activeTextEditor!.document.uri;

    // Do the split if requested
    let split = false;
    if (this.arguments.position === FilePosition.NewWindowVerticalSplit) {
      await vscode.commands.executeCommand('workbench.action.splitEditorRight');
      split = true;
    }
    if (this.arguments.position === FilePosition.NewWindowHorizontalSplit) {
      await vscode.commands.executeCommand('workbench.action.splitEditorDown');
      split = true;
    }

    let hidePreviousEditor = async function () {
      if (split === true) {
        await vscode.commands.executeCommand('workbench.action.previousEditor');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      }
    };

    // No name was specified
    if (this.arguments.name === undefined) {
      if (this.arguments.createFileIfNotExists === true) {
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
        await hidePreviousEditor();
      }
      return;
    }

    // Only untidify when the currently open page and file completion is local
    if (this.arguments.name && editorFileUri.scheme === UriScheme.File) {
      this._arguments.name = untildify(this.arguments.name);
    }

    let fileUri = editorFileUri;
    // Using the empty string will request to open a file
    if (this.arguments.name === '') {
      // No name on split is fine and just return
      if (split === true) {
        return;
      }

      const fileList = await vscode.window.showOpenDialog({});
      if (fileList && fileList.length > 0) {
        fileUri = fileList[0];
      }
    } else {
      // remove file://
      this._arguments.name = this.arguments.name.replace(/^file:\/\//, '');

      const baseUri = getBaseDirectoryUri();
      if (!baseUri) {
        return;
      }

      const { fileUri: uriPath, platformPath } = resolveDirectoryPath(
        baseUri,
        this._arguments.name
      );
      if (!isValidFileUri(uriPath, platformPath)) {
        return;
      }

      // Only if the expanded path of the full path is different than
      // the currently opened window path
      if (uriPath.fsPath !== editorFileUri.fsPath) {
        const fileExists = await doesFileExist(uriPath);
        if (fileExists) {
          // If the file without the added ext exists
          fileUri = uriPath;
        } else {
          if (this.arguments.createFileIfNotExists) {
            // Change the scheme to untitled to open an
            // untitled tab
            fileUri = uriPath.with({ scheme: 'untitled' });
          } else {
            this._logger.error(`${this.arguments.name} does not exist.`);
            return;
          }
        }
      }
    }

    const doc = await vscode.workspace.openTextDocument(fileUri);
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
