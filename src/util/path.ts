import * as path from 'path';
import * as vscode from 'vscode';
import { Uri, workspace } from 'vscode';
import { CharCode } from './charCode';
import { UriScheme } from './uriSchema';
import untildify = require('untildify');

/**
 * A interface to the path in the node.js.
 */
interface PlatformPath {
  normalize(p: string): string;
  join(...paths: string[]): string;
  resolve(...pathSegments: string[]): string;
  isAbsolute(p: string): boolean;
  relative(from: string, to: string): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  sep: string;
  delimiter: string;
}

/**
 * Separate a partial path or full path into dirname and the basename.
 * @param searchPath The path to separate.
 * @param sep The separator of the searchPath.
 * @return A two-element array where the first element is the dirname and the second
 * is the basename.
 */
export function separatePath(searchPath: string, sep: string) {
  // Special handle for UNC path on windows
  if (sep === path.win32.sep) {
    if (searchPath[0] === sep && searchPath[1] === sep) {
      const idx = searchPath.indexOf(sep, 2);
      if (idx === -1) {
        // If there isn't a complete UNC path,
        // return the incomplete UNC as baseName
        // e.g. \\test-server is an incomplete path
        // and \\test-server\ is a complete path
        return [searchPath, ''];
      }
    }
  }

  const baseNameIndex = searchPath.lastIndexOf(sep) + 1;
  const baseName = searchPath.slice(baseNameIndex);
  const dirName = searchPath.slice(0, baseNameIndex);
  return [dirName, baseName];
}

/**
 * The comment is used conjunction with getPathDetails.
 */
interface PathDetails {
  /**
   * A full absolute path resolved from directory of the currently active document.
   * If the active document is an untitled document, full path will be dirName of
   * the input partialPath.
   */
  fullPath: string;
  /**
   * A full absolute path of the directory of fullPath.
   * If the active document is an untitled document, full path will be the input partialPath.
   */
  fullDirPath: string;
  /**
   * The dir name of partialPath.
   * If the partialPath is an absolute path, this will be equal to fullDirPat
   * If partialPath is ./abc/xyz.txt, baseName will be './abc/'
   * If partialPath is /abc/xyz.txt, baseName will be '/abc/'
   */
  dirName: string;
  /**
   * A base name of the partialPath.
   * If partialPath is ./abc/xyz.txt, baseName will be 'xyz.txt'
   * If partialPath is /abc/xyz.txt, baseName will be 'xyz.txt'
   */
  baseName: string;
  /**
   * An updated partialPath which has its / changed to \ on Windows.
   */
  partialPath: string;
  /**
   * The correct node js path for the partial path. This will be either
   * path.win32 or path.posix for further processing.
   */
  path: PlatformPath;
}

/**
 * Get path detail.
 *
 * If the currently active document is an untitled document, we will assume the partialPath
 * is a Windows path only when the VS Code is running on Windows, and not remote session; else, posix path.
 *
 * If the currently active document is not an untitled document, we will assume the partialPath
 * is a Windows path when the current uri is local file where the first character of fsPath of the
 * current uri is not "/"; otherwise, posix path. fsPath can return C:\path\avc.txt or \\drive\location\abc.txt
 * on Windows.
 *
 * This is to maximize usability of the combination of Windows and posix machine using remote while browsing
 * file on both local and remote.
 *
 * @param partialPath A string of relative path to the directory of the currentUri,
 * or an absolute path in the environment of the currentUri.
 * ~/ can be used only if active document is local document, or local untitled document.
 * @param currentUri A uri of the currently active document.
 * @param isRemote A boolean to indicate if the current instance is in remote.
 * @return A PathDetail.
 */
export function getPathDetails(
  partialPath: string,
  currentUri: vscode.Uri,
  isRemote: boolean
): PathDetails {
  let isWindows: boolean;
  if (currentUri.scheme === 'untitled') {
    // Assume remote server is nix only
    isWindows = path === path.win32 && !isRemote;
  } else {
    // Assuming other schemes return full path
    // e.g. 'file' and 'vscode-remote' both return full path
    // Also only scheme that support Windows is 'file', so we can
    // safely check if fsPath returns '/' as the first character
    // (fsPath in 'vscode-remote' on Windows return \ as separator instead of /)
    isWindows = currentUri.scheme === 'file' && currentUri.fsPath[0] !== '/';
  }

  const p = isWindows ? path.win32 : path.posix;
  if (isWindows) {
    // normalize / to \ on windows
    partialPath = partialPath.replace(/\//g, '\\');
  }
  const updatedPartialPath = partialPath;

  if (
    currentUri.scheme === UriScheme.File ||
    (currentUri.scheme === UriScheme.Untitled && !isRemote)
  ) {
    // We can untildify when the scheme is 'file' or 'untitled' on local fs because
    // because we only support opening files mounted locally.
    partialPath = untildify(partialPath);
  }

  let [dirName, baseName] = separatePath(partialPath, p.sep);
  let fullDirPath: string;
  if (p.isAbsolute(dirName)) {
    fullDirPath = dirName;
  } else {
    fullDirPath = p.join(
      // On Windows machine:
      // fsPath returns Windows drive path (C:\xxx\) or UNC path (\\server\xxx)
      // fsPath returns path with \ as separator even if 'vscode-remote' is connect to a linux box
      //
      // path will return /home/user for example even 'vscode-remote' is used on windows
      // as we relied of our isWindows detection
      separatePath(isWindows ? currentUri.fsPath : currentUri.path, p.sep)[0],
      dirName
    );
  }

  const fullPath = p.join(fullDirPath, baseName);
  return {
    fullPath,
    fullDirPath,
    dirName,
    baseName,
    partialPath: updatedPartialPath,
    path: p,
  };
}
// Schema: vscode-remote
// Authority: "ssh-remote+192.168.1.1"

// Schema: "file"
// Authority: "wsl$"

// Local untitled
// Schema: untitled
// Authority: """
// Path: "Untitled-1"

// Schema: untitled
// Authority: """
// Path: "/c:/path/to/file"

// Schema: untitled
// Authority: "ssh-remote+192.168.1.1"
// Path: "/c:/path/to/file"

export function getBaseDirectoryUri() {
  let uri = vscode.window.activeTextEditor?.document.uri;
  if (uri) {
    const folder = workspace.getWorkspaceFolder(uri);
    if (folder) {
      // If the currently open editor is in a workspace
      // use that directory instead
      uri = folder.uri;
    } else {
      // if the active editor is not in a workspace
      // use folder of that file
      if (uri.scheme === UriScheme.File || uri.scheme === UriScheme.VscodeRemote) {
        uri = joinPath(uri, '../');
      } else {
        // If it is untitled or other schemes, try looking into the workspace
        const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri;
        if (workspaceUri) {
          // Keep the untitled instead of undefined if workspace is undefined
          uri = workspaceUri;
        }
      }
    }
  } else {
    uri = vscode.workspace.workspaceFolders?.[0].uri;
  }

  return uri;
}

/**
 * Modified from https://github.com/microsoft/vscode/blob/f74e473238aca7b79c08be761d99a0232838ca4c/src/vs/base/common/uri.ts#L346-L357
 */
export function joinPath(uri: Uri, ...pathFragment: string[]) {
  const platformPath = getPlatformPath(uri);
  const newPath = platformPath.join(uriToFsPath(uri), ...pathFragment);
  return createFileUri(newPath, uri, platformPath);
}

export function resolveDirectoryPath(baseUri: Uri, partialPath: string) {
  // 1. Get the platform path
  let platformPath: PlatformPath;
  if (baseUri.scheme === UriScheme.VscodeRemote) {
    // guess the platform base on the uri
    platformPath = getPlatformPath(baseUri);
  } else {
    // For UriScheme.File and UriScheme.Untitled
    // Use host machine's platform
    platformPath = path;
  }

  // 2. Normalized for display if it is Windows
  let normalizedPartialPath = partialPath;
  if (platformPath.sep === path.win32.sep) {
    // normalize / to \ on windows
    partialPath = partialPath.replace(/\//g, '\\');
    normalizedPartialPath = partialPath;
  }

  // 3. Untildify if necessary. This only only be done on file and untitled
  // because those are the types that we assume we will use the local machine
  // hence can be untildify.
  if (baseUri.scheme === UriScheme.File || baseUri.scheme === UriScheme.Untitled) {
    partialPath = untildify(partialPath);
  }

  // 4. Get the directory path base on the partial path
  let dirName: string;
  let baseName: string;
  let directoryUri: Uri;
  if (baseUri.scheme === UriScheme.File || baseUri.scheme === UriScheme.VscodeRemote) {
    [dirName, baseName] = separatePath(partialPath, platformPath.sep);
    const absolute = platformPath.isAbsolute(dirName);
    if (absolute) {
      directoryUri = createFileUri(dirName, baseUri, platformPath);
    } else {
      partialPath = platformPath.join(uriToFsPath(baseUri), dirName);
      directoryUri = createFileUri(partialPath, baseUri, platformPath);
    }
  } else {
    // For UriScheme.Untitled and the rest
    // Only works for local path
    [dirName, baseName] = separatePath(partialPath, platformPath.sep);
    directoryUri = createFileUri(dirName, baseUri, platformPath);
  }

  // 5. Get the file path base on the partial path
  const filePath = platformPath.join(uriToFsPath(directoryUri), baseName);
  const fileUri = createFileUri(filePath, baseUri, platformPath);

  return {
    fileUri,
    directoryUri,
    basename: baseName,
    dirname: dirName,
    partialPath: normalizedPartialPath,
    platformPath,
  };
}

/**
 * Resolve the absolutePath to Uri.
 *
 * @param absolutePath A string of absolute path.
 * @param sep The separator of the absolutePath.
 * This is used to determine we should consider absolutePath a Windows path.
 * @param currentUri A uri to resolve the absolutePath to Uri.
 * @param isRemote A boolean to indicate if the current instance is in remote.
 * @return null if the absolutePath is invalid. A uri resolved with the currentUri.
 */
export function resolveUri(
  absolutePath: string,
  sep: string,
  currentUri: vscode.Uri,
  isRemote: boolean
) {
  const isWindows = sep === path.win32.sep;
  if (isWindows && !/^(\\\\.+\\)|([a-zA-Z]:\\)/.test(absolutePath)) {
    // if it is windows and but don't have either
    // UNC path or the windows drive
    return null;
  }
  if (!isWindows && absolutePath[0] !== sep) {
    // if it is not windows, but the absolute path doesn't begin with /
    return null;
  }

  const isLocalUntitled = !isRemote && currentUri.scheme === 'untitled';
  return isWindows
    ? // Create new local Uri when it's on windows.
      // Only local resource is support (vscode-remote doesn't have windows path)
      // UNC path like //server1/folder should also work.
      vscode.Uri.file(absolutePath)
    : currentUri.with({
        // search local file with currently active document is a local untitled doc
        scheme: isLocalUntitled ? 'file' : currentUri.scheme,
        path: absolutePath,
      });
}

export async function readDirectory(
  directoryUri: Uri,
  addCurrentAndUp: boolean,
  platformPath?: PlatformPath
) {
  try {
    platformPath = platformPath ?? getPlatformPath(directoryUri);
    const sep = platformPath.sep;
    const directoryResult = await vscode.workspace.fs.readDirectory(directoryUri);
    return (
      directoryResult
        // Add the separator at the end to the path if it is a directory
        .map((d) => d[0] + (d[1] === vscode.FileType.Directory ? sep : ''))
        // Add ./ and ../ to the result if specified
        .concat(addCurrentAndUp ? [`.${sep}`, `..${sep}`] : [])
    );
  } catch {
    return [];
  }
}

export function join(...paths: string[]): string {
  return path.join(...paths);
}

function hasDriveLetter(fsPath: string, offset = 0): boolean {
  if (fsPath.length >= 2 + offset) {
    // Checks C:\Users
    //        ^^
    const char0 = fsPath.charCodeAt(0 + offset);
    const char1 = fsPath.charCodeAt(1 + offset);
    return (
      char1 === CharCode.Colon &&
      ((char0 >= CharCode.A && char0 <= CharCode.Z) || (char0 >= CharCode.a && char0 <= CharCode.z))
    );
  }
  return false;
}

function isPathSeparator(code: number): boolean {
  return code === CharCode.Slash || code === CharCode.Backslash;
}

function isUNC(fsPath: string, offset = 0) {
  if (fsPath.length >= 3) {
    // Checks \\localhost\shares\ddd
    //        ^^^
    return (
      isPathSeparator(fsPath.charCodeAt(0 + offset)) &&
      isPathSeparator(fsPath.charCodeAt(1 + offset)) &&
      !isPathSeparator(fsPath.charCodeAt(2 + offset))
    );
  }
  return false;
}

/**
 * Get the platform path base on the uri.
 *
 * This is similar with the assumption in `uriToFsPath`. If the path has drive letter
 * or is an UNC path, assumed the uri to be a Windows path.
 */
function getPlatformPath(uri: Uri) {
  const fsPath = uriToFsPath(uri);
  return hasDriveLetter(fsPath) || isUNC(fsPath) ? path.win32 : path.posix;
}

/**
 * Compute `fsPath` with slash normalized to `/` for the given uri.
 *
 * This is what vscode uses internally to compute uri.fsPath; however,
 * backslash conversion for Windows host is removed, and drive letter is always normalized to uppercase.
 *
 * The problems with the internal `uri.fsPath`:
 *  - Windows machine remoting into a linux will return a `\` as separator
 *  - *nix machine remoting into a windows will return `/` as separator
 *
 * Modified from https://github.com/microsoft/vscode/blob/f74e473238aca7b79c08be761d99a0232838ca4c/src/vs/base/common/uri.ts#L579-L604
 */
function uriToFsPath(uri: Uri): string {
  let value: string;
  if (uri.authority && uri.path.length > 1 && uri.scheme === UriScheme.File) {
    // unc path: file://shares/c$/far/boo
    value = `//${uri.authority}${uri.path}`;
  } else if (
    // e.g. local file and vscode-remote file
    uri.path.charCodeAt(0) === CharCode.Slash &&
    hasDriveLetter(uri.path, 1)
  ) {
    // windows drive letter: file:///c:/far/boo
    // Normalized drive letter -> C:/far/boo
    value = uri.path[1].toUpperCase() + uri.path.substr(2);
  } else {
    // other path
    value = uri.path;
  }
  return value;
}

const _slash = '/';

function equalsIgnoreCase(a1: string, a2: string) {
  return a1.length === a1.length && a1.toLowerCase() === a2.toLowerCase();
}

function isEqualAuthority(a1: string, a2: string) {
  return a1 === a2 || equalsIgnoreCase(a1, a2);
}

/**
 * Create a uri that doesn't base on the local system
 * Modified from https://github.com/microsoft/vscode/blob/f74e473238aca7b79c08be761d99a0232838ca4c/src/vs/base/common/uri.ts#L302-L327
 * @param filePath
 * @param platformPath
 * @param baseUri
 */
function createFileUri(filePath: string, baseUri: Uri, platformPath?: PlatformPath) {
  platformPath = platformPath ?? getPlatformPath(baseUri);
  // Use local file system if the uri is untitled
  const scheme = baseUri.scheme === UriScheme.Untitled ? UriScheme.File : baseUri.scheme;
  let authority = baseUri.authority;

  // normalize to fwd-slashes on windows,
  // on other systems bwd-slashes are valid
  // filename character, eg /f\oo/ba\r.txt
  if (platformPath.sep === path.win32.sep) {
    // isWindow
    filePath = filePath.replace(/\\/g, _slash);
  }

  // check for authority as used in UNC shares
  // or use the fsPath as given
  if (filePath[0] === _slash && filePath[1] === _slash) {
    const idx = filePath.indexOf(_slash, 2);
    if (idx === -1) {
      authority = filePath.substring(2);
      filePath = _slash;
    } else {
      authority = filePath.substring(2, idx);
      filePath = filePath.substring(idx) || _slash;
    }
  }

  if (filePath.length > 0 && filePath.charCodeAt(0) !== CharCode.Slash) {
    // Add slash for drive path and UNC
    filePath = _slash + filePath;
  }

  // Note: cannot open UNC path with vscode remote
  return baseUri.with({ path: filePath, authority, scheme });
}

export function isValidFileUri(uri: Uri, platformPath: PlatformPath) {
  let isValid = uri.path.charCodeAt(0) === CharCode.Slash;
  if (isValid && platformPath === path.win32) {
    if (uri.authority && uri.path.length > 1 && uri.scheme === UriScheme.File) {
      // unc path: file://shares/c$/far/boo
      // value = `//${uri.authority}${uri.path}`;
      // test to make it has a complete UNC path
      isValid = /^\/.+\//.test(uri.path);
    } else {
      // Has letter and closing slash
      isValid = hasDriveLetter(uri.path, 1) && uri.path.charCodeAt(3) === CharCode.Slash;
    }
  }

  return isValid;
}
