'use strict';

const {
  ArrayPrototypePush,
  ArrayPrototypePop,
  Error,
  MathMax,
  MathMin,
  NumberIsSafeInteger,
  Promise,
  PromisePrototypeThen,
  PromiseResolve,
  PromiseReject,
  SafeArrayIterator,
  SafePromisePrototypeFinally,
  Symbol,
  SymbolAsyncDispose,
  Uint8Array,
  FunctionPrototypeBind,
} = primordials;

const { fs: constants } = internalBinding('constants');
const {
  F_OK,
  O_SYMLINK,
  O_WRONLY,
  S_IFMT,
  S_IFREG,
} = constants;

const binding = internalBinding('fs');
const { Buffer } = require('buffer');

const {
  codes: {
    ERR_FS_FILE_TOO_LARGE,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_STATE,
    ERR_METHOD_NOT_IMPLEMENTED,
  },
  AbortError,
  aggregateTwoErrors,
} = require('internal/errors');
const { isArrayBufferView } = require('internal/util/types');
const { rimrafPromises } = require('internal/fs/rimraf');
const {
  constants: {
    kIoMaxLength,
    kMaxUserId,
    kReadFileBufferLength,
    kReadFileUnknownBufferLength,
    kWriteFileMaxChunkSize,
  },
  copyObject,
  emitRecursiveRmdirWarning,
  getDirents,
  getOptions,
  getStatFsFromBinding,
  getStatsFromBinding,
  getValidatedPath,
  getValidMode,
  preprocessSymlinkDestination,
  stringToFlags,
  stringToSymlinkType,
  toUnixTimestamp,
  validateBufferArray,
  validateCpOptions,
  validateOffsetLengthRead,
  validateOffsetLengthWrite,
  validateRmOptions,
  validateRmdirOptions,
  validatePrimitiveStringAfterArrayBufferView,
  warnOnNonPortableTemplate,
} = require('internal/fs/utils');
const { opendir } = require('internal/fs/dir');
const {
  parseFileMode,
  validateAbortSignal,
  validateBoolean,
  validateBuffer,
  validateEncoding,
  validateInteger,
  validateString,
} = require('internal/validators');
const pathModule = require('path');
const {
  kEmptyObject,
  lazyDOMException,
  promisify,
} = require('internal/util');
const { EventEmitterMixin } = require('internal/event_target');
const { StringDecoder } = require('string_decoder');
const { watch } = require('internal/fs/watchers');
const { isIterable } = require('internal/streams/utils');
const assert = require('internal/assert');

const kHandle = Symbol('kHandle');
const kFd = Symbol('kFd');
const kRefs = Symbol('kRefs');
const kClosePromise = Symbol('kClosePromise');
const kCloseResolve = Symbol('kCloseResolve');
const kCloseReject = Symbol('kCloseReject');
const kRef = Symbol('kRef');
const kUnref = Symbol('kUnref');
const kLocked = Symbol('kLocked');

const { kUsePromises } = binding;
const { Interface } = require('internal/readline/interface');
const {
  JSTransferable, kDeserialize, kTransfer, kTransferList,
} = require('internal/worker/js_transferable');

const getDirectoryEntriesPromise = promisify(getDirents);
const validateRmOptionsPromise = promisify(validateRmOptions);

let cpPromises;
function lazyLoadCpPromises() {
  return cpPromises ??= require('internal/fs/cp/cp').cpFn;
}

// Lazy loaded to avoid circular dependency.
let fsStreams;
function lazyFsStreams() {
  return fsStreams ??= require('internal/fs/streams');
}

class FileHandle extends EventEmitterMixin(JSTransferable) {
  /**
   * @param {InternalFSBinding.FileHandle | undefined} filehandle
   */
  constructor(filehandle) {
    super();
    this[kHandle] = filehandle;
    this[kFd] = filehandle ? filehandle.fd : -1;

    this[kRefs] = 1;
    this[kClosePromise] = null;
  }

  getAsyncId() {
    return this[kHandle].getAsyncId();
  }

  get fd() {
    return this[kFd];
  }

  appendFile(data, options) {
    return fsCall(writeFile, this, data, options);
  }

  chmod(mode) {
    return fsCall(fchmod, this, mode);
  }

  chown(uid, gid) {
    return fsCall(fchown, this, uid, gid);
  }

  datasync() {
    return fsCall(fdatasync, this);
  }

  sync() {
    return fsCall(fsync, this);
  }

  read(buffer, offset, length, position) {
    return fsCall(read, this, buffer, offset, length, position);
  }

  readv(buffers, position) {
    return fsCall(readv, this, buffers, position);
  }

  readFile(options) {
    return fsCall(readFile, this, options);
  }

  readLines(options = undefined) {
    return new Interface({
      input: this.createReadStream(options),
      crlfDelay: Infinity,
    });
  }

  stat(options) {
    return fsCall(fstat, this, options);
  }

  truncate(len = 0) {
    return fsCall(ftruncate, this, len);
  }

  utimes(atime, mtime) {
    return fsCall(futimes, this, atime, mtime);
  }

  write(buffer, offset, length, position) {
    return fsCall(write, this, buffer, offset, length, position);
  }

  writev(buffers, position) {
    return fsCall(writev, this, buffers, position);
  }

  writeFile(data, options) {
    return fsCall(writeFile, this, data, options);
  }

  close = () => {
    if (this[kFd] === -1) {
      return PromiseResolve();
    }

    if (this[kClosePromise]) {
      return this[kClosePromise];
    }

    this[kRefs]--;
    if (this[kRefs] === 0) {
      this[kFd] = -1;
      this[kClosePromise] = SafePromisePrototypeFinally(
        this[kHandle].close(),
        () => { this[kClosePromise] = undefined; },
      );
    } else {
      this[kClosePromise] = SafePromisePrototypeFinally(
        new Promise((resolve, reject) => {
          this[kCloseResolve] = resolve;
          this[kCloseReject] = reject;
        }), () => {
          this[kClosePromise] = undefined;
          this[kCloseReject] = undefined;
          this[kCloseResolve] = undefined;
        },
      );
    }

    this.emit('close');
    return this[kClosePromise];
  };

  async [SymbolAsyncDispose]() {
    return this.close();
  }

  /**
   * @typedef {import('../webstreams/readablestream').ReadableStream
   * } ReadableStream
   * @param {{
   *   type?: string;
   *   }} [options]
   * @returns {ReadableStream}
   */
  readableWebStream(options = kEmptyObject) {
    if (this[kFd] === -1)
      throw new ERR_INVALID_STATE('The FileHandle is closed');
    if (this[kClosePromise])
      throw new ERR_INVALID_STATE('The FileHandle is closing');
    if (this[kLocked])
      throw new ERR_INVALID_STATE('The FileHandle is locked');
    this[kLocked] = true;

    if (options.type !== undefined) {
      validateString(options.type, 'options.type');
    }

    let readable;

    if (options.type !== 'bytes') {
      const {
        newReadableStreamFromStreamBase,
      } = require('internal/webstreams/adapters');
      readable = newReadableStreamFromStreamBase(
        this[kHandle],
        undefined,
        { ondone: () => this[kUnref]() });
    } else {
      const {
        ReadableStream,
      } = require('internal/webstreams/readablestream');

      const readFn = FunctionPrototypeBind(this.read, this);
      const ondone = FunctionPrototypeBind(this[kUnref], this);

      readable = new ReadableStream({
        type: 'bytes',
        autoAllocateChunkSize: 16384,

        async pull(controller) {
          const view = controller.byobRequest.view;
          const { bytesRead } = await readFn(view, view.byteOffset, view.byteLength);

          if (bytesRead === 0) {
            ondone();
            controller.close();
          }

          controller.byobRequest.respond(bytesRead);
        },

        cancel() {
          ondone();
        },
      });
    }

    const {
      readableStreamCancel,
    } = require('internal/webstreams/readablestream');
    this[kRef]();
    this.once('close', () => {
      readableStreamCancel(readable);
    });

    return readable;
  }

  /**
   * @typedef {import('./streams').ReadStream
   * } ReadStream
   * @param {{
   *   encoding?: string;
   *   autoClose?: boolean;
   *   emitClose?: boolean;
   *   start: number;
   *   end?: number;
   *   highWaterMark?: number;
   *   }} [options]
   * @returns {ReadStream}
   */
  createReadStream(options = undefined) {
    const { ReadStream } = lazyFsStreams();
    return new ReadStream(undefined, { ...options, fd: this });
  }

  /**
   * @typedef {import('./streams').WriteStream
   * } WriteStream
   * @param {{
   *   encoding?: string;
   *   autoClose?: boolean;
   *   emitClose?: boolean;
   *   start: number;
   *   }} [options]
   * @returns {WriteStream}
   */
  createWriteStream(options = undefined) {
    const { WriteStream } = lazyFsStreams();
    return new WriteStream(undefined, { ...options, fd: this });
  }

  [kTransfer]() {
    if (this[kClosePromise] || this[kRefs] > 1) {
      throw lazyDOMException('Cannot transfer FileHandle while in use',
                             'DataCloneError');
    }

    const handle = this[kHandle];
    this[kFd] = -1;
    this[kHandle] = null;
    this[kRefs] = 0;

    return {
      data: { handle },
      deserializeInfo: 'internal/fs/promises:FileHandle',
    };
  }

  [kTransferList]() {
    return [ this[kHandle] ];
  }

  [kDeserialize]({ handle }) {
    this[kHandle] = handle;
    this[kFd] = handle.fd;
  }

  [kRef]() {
    this[kRefs]++;
  }

  [kUnref]() {
    this[kRefs]--;
    if (this[kRefs] === 0) {
      this[kFd] = -1;
      PromisePrototypeThen(
        this[kHandle].close(),
        this[kCloseResolve],
        this[kCloseReject],
      );
    }
  }
}

async function handleFdClose(fileOpPromise, closeFunc) {
  return PromisePrototypeThen(
    fileOpPromise,
    (result) => PromisePrototypeThen(closeFunc(), () => result),
    (opError) =>
      PromisePrototypeThen(
        closeFunc(),
        () => PromiseReject(opError),
        (closeError) => PromiseReject(aggregateTwoErrors(closeError, opError)),
      ),
  );
}

async function fsCall(fn, handle, ...args) {
  assert(handle[kRefs] !== undefined,
         'handle must be an instance of FileHandle');

  if (handle.fd === -1) {
    // eslint-disable-next-line no-restricted-syntax
    const err = new Error('file closed');
    err.code = 'EBADF';
    err.syscall = fn.name;
    throw err;
  }

  try {
    handle[kRef]();
    return await fn(handle, ...new SafeArrayIterator(args));
  } finally {
    handle[kUnref]();
  }
}

function checkAborted(signal) {
  if (signal?.aborted)
    throw new AbortError(undefined, { cause: signal?.reason });
}

async function writeFileHandle(filehandle, data, signal, encoding) {
  checkAborted(signal);
  if (isCustomIterable(data)) {
    for await (const buf of data) {
      checkAborted(signal);
      const toWrite =
        isArrayBufferView(buf) ? buf : Buffer.from(buf, encoding || 'utf8');
      let remaining = toWrite.byteLength;
      while (remaining > 0) {
        const writeSize = MathMin(kWriteFileMaxChunkSize, remaining);
        const { bytesWritten } = await write(
          filehandle, toWrite, toWrite.byteLength - remaining, writeSize);
        remaining -= bytesWritten;
        checkAborted(signal);
      }
    }
    return;
  }
  data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let remaining = data.byteLength;
  if (remaining === 0) return;
  do {
    checkAborted(signal);
    const { bytesWritten } =
      await write(filehandle, data, 0,
                  MathMin(kWriteFileMaxChunkSize, data.byteLength));
    remaining -= bytesWritten;
    data = new Uint8Array(
      data.buffer,
      data.byteOffset + bytesWritten,
      data.byteLength - bytesWritten,
    );
  } while (remaining > 0);
}

async function readFileHandle(filehandle, options) {
  const signal = options?.signal;
  const encoding = options?.encoding;
  const decoder = encoding && new StringDecoder(encoding);

  checkAborted(signal);

  const statFields = await binding.fstat(filehandle.fd, false, kUsePromises);

  checkAborted(signal);

  let size = 0;
  let length = 0;
  if ((statFields[1/* mode */] & S_IFMT) === S_IFREG) {
    size = statFields[8/* size */];
    length = encoding ? MathMin(size, kReadFileBufferLength) : size;
  }
  if (length === 0) {
    length = kReadFileUnknownBufferLength;
  }

  if (size > kIoMaxLength)
    throw new ERR_FS_FILE_TOO_LARGE(size);

  let totalRead = 0;
  let buffer = Buffer.allocUnsafeSlow(length);
  let result = '';
  let offset = 0;
  let buffers;
  const chunkedRead = length > kReadFileBufferLength;

  while (true) {
    checkAborted(signal);

    if (chunkedRead) {
      length = MathMin(size - totalRead, kReadFileBufferLength);
    }

    const bytesRead = (await binding.read(filehandle.fd, buffer, offset,
                                          length, -1, kUsePromises)) ?? 0;
    totalRead += bytesRead;

    if (bytesRead === 0 ||
        totalRead === size ||
        (bytesRead !== buffer.length && !chunkedRead)) {
      const singleRead = bytesRead === totalRead;

      const bytesToCheck = chunkedRead ? totalRead : bytesRead;

      if (bytesToCheck !== buffer.length) {
        buffer = buffer.subarray(0, bytesToCheck);
      }

      if (!encoding) {
        if (size === 0 && !singleRead) {
          ArrayPrototypePush(buffers, buffer);
          return Buffer.concat(buffers, totalRead);
        }
        return buffer;
      }

      if (singleRead) {
        return buffer.toString(encoding);
      }
      result += decoder.end(buffer);
      return result;
    }

    if (encoding) {
      result += decoder.write(buffer);
    } else if (size !== 0) {
      offset = totalRead;
    } else {
      buffers ??= [];
      // Unknown file size requires chunks.
      ArrayPrototypePush(buffers, buffer);
      buffer = Buffer.allocUnsafeSlow(kReadFileUnknownBufferLength);
    }
  }
}

// All of the functions are defined as async in order to ensure that errors
// thrown cause promise rejections rather than being thrown synchronously.
async function access(path, mode = F_OK) {
  path = getValidatedPath(path);

  mode = getValidMode(mode, 'access');
  return binding.access(pathModule.toNamespacedPath(path), mode,
                        kUsePromises);
}

async function cp(src, dest, options) {
  options = validateCpOptions(options);
  src = pathModule.toNamespacedPath(getValidatedPath(src, 'src'));
  dest = pathModule.toNamespacedPath(getValidatedPath(dest, 'dest'));
  return lazyLoadCpPromises()(src, dest, options);
}

async function copyFile(src, dest, mode) {
  src = getValidatedPath(src, 'src');
  dest = getValidatedPath(dest, 'dest');
  mode = getValidMode(mode, 'copyFile');
  return binding.copyFile(pathModule.toNamespacedPath(src),
                          pathModule.toNamespacedPath(dest),
                          mode,
                          kUsePromises);
}

// Note that unlike fs.open() which uses numeric file descriptors,
// fsPromises.open() uses the fs.FileHandle class.
async function open(path, flags, mode) {
  path = getValidatedPath(path);
  const flagsNumber = stringToFlags(flags);
  mode = parseFileMode(mode, 'mode', 0o666);
  return new FileHandle(
    await binding.openFileHandle(pathModule.toNamespacedPath(path),
                                 flagsNumber, mode, kUsePromises));
}

async function read(handle, bufferOrParams, offset, length, position) {
  let buffer = bufferOrParams;
  if (!isArrayBufferView(buffer)) {
    // This is fh.read(params)
    ({
      buffer = Buffer.alloc(16384),
      offset = 0,
      length = buffer.byteLength - offset,
      position = null,
    } = bufferOrParams ?? kEmptyObject);

    validateBuffer(buffer);
  }

  if (offset !== null && typeof offset === 'object') {
    // This is fh.read(buffer, options)
    ({
      offset = 0,
      length = buffer.byteLength - offset,
      position = null,
    } = offset);
  }

  if (offset == null) {
    offset = 0;
  } else {
    validateInteger(offset, 'offset', 0);
  }

  length |= 0;

  if (length === 0)
    return { bytesRead: length, buffer };

  if (buffer.byteLength === 0) {
    throw new ERR_INVALID_ARG_VALUE('buffer', buffer,
                                    'is empty and cannot be written');
  }

  validateOffsetLengthRead(offset, length, buffer.byteLength);

  if (!NumberIsSafeInteger(position))
    position = -1;

  const bytesRead = (await binding.read(handle.fd, buffer, offset, length,
                                        position, kUsePromises)) || 0;

  return { bytesRead, buffer };
}

async function readv(handle, buffers, position) {
  validateBufferArray(buffers);

  if (typeof position !== 'number')
    position = null;

  const bytesRead = (await binding.readBuffers(handle.fd, buffers, position,
                                               kUsePromises)) || 0;
  return { bytesRead, buffers };
}

async function write(handle, buffer, offsetOrOptions, length, position) {
  if (buffer?.byteLength === 0)
    return { bytesWritten: 0, buffer };

  let offset = offsetOrOptions;
  if (isArrayBufferView(buffer)) {
    if (typeof offset === 'object') {
      ({
        offset = 0,
        length = buffer.byteLength - offset,
        position = null,
      } = offsetOrOptions ?? kEmptyObject);
    }

    if (offset == null) {
      offset = 0;
    } else {
      validateInteger(offset, 'offset', 0);
    }
    if (typeof length !== 'number')
      length = buffer.byteLength - offset;
    if (typeof position !== 'number')
      position = null;
    validateOffsetLengthWrite(offset, length, buffer.byteLength);
    const bytesWritten =
      (await binding.writeBuffer(handle.fd, buffer, offset,
                                 length, position, kUsePromises)) || 0;
    return { bytesWritten, buffer };
  }

  validatePrimitiveStringAfterArrayBufferView(buffer, 'buffer');
  validateEncoding(buffer, length);
  const bytesWritten = (await binding.writeString(handle.fd, buffer, offset,
                                                  length, kUsePromises)) || 0;
  return { bytesWritten, buffer };
}

async function writev(handle, buffers, position) {
  validateBufferArray(buffers);

  if (typeof position !== 'number')
    position = null;

  if (buffers.length === 0) {
    return { bytesWritten: 0, buffers };
  }

  const bytesWritten = (await binding.writeBuffers(handle.fd, buffers, position,
                                                   kUsePromises)) || 0;
  return { bytesWritten, buffers };
}

async function rename(oldPath, newPath) {
  oldPath = getValidatedPath(oldPath, 'oldPath');
  newPath = getValidatedPath(newPath, 'newPath');
  return binding.rename(pathModule.toNamespacedPath(oldPath),
                        pathModule.toNamespacedPath(newPath),
                        kUsePromises);
}

async function truncate(path, len = 0) {
  const fd = await open(path, 'r+');
  return handleFdClose(ftruncate(fd, len), fd.close);
}

async function ftruncate(handle, len = 0) {
  validateInteger(len, 'len');
  len = MathMax(0, len);
  return binding.ftruncate(handle.fd, len, kUsePromises);
}

async function rm(path, options) {
  path = pathModule.toNamespacedPath(getValidatedPath(path));
  options = await validateRmOptionsPromise(path, options, false);
  return rimrafPromises(path, options);
}

async function rmdir(path, options) {
  path = pathModule.toNamespacedPath(getValidatedPath(path));
  options = validateRmdirOptions(options);

  if (options.recursive) {
    emitRecursiveRmdirWarning();
    const stats = await stat(path);
    if (stats.isDirectory()) {
      return rimrafPromises(path, options);
    }
  }

  return binding.rmdir(path, kUsePromises);
}

async function fdatasync(handle) {
  return binding.fdatasync(handle.fd, kUsePromises);
}

async function fsync(handle) {
  return binding.fsync(handle.fd, kUsePromises);
}

async function mkdir(path, options) {
  if (typeof options === 'number' || typeof options === 'string') {
    options = { mode: options };
  }
  const {
    recursive = false,
    mode = 0o777,
  } = options || kEmptyObject;
  path = getValidatedPath(path);
  validateBoolean(recursive, 'options.recursive');

  return binding.mkdir(pathModule.toNamespacedPath(path),
                       parseFileMode(mode, 'mode', 0o777), recursive,
                       kUsePromises);
}

async function readdirRecursive(originalPath, options) {
  const result = [];
  const queue = [
    [
      originalPath,
      await binding.readdir(
        pathModule.toNamespacedPath(originalPath),
        options.encoding,
        !!options.withFileTypes,
        kUsePromises,
      ),
    ],
  ];


  if (options.withFileTypes) {
    while (queue.length > 0) {
      // If we want to implement BFS make this a `shift` call instead of `pop`
      const { 0: path, 1: readdir } = ArrayPrototypePop(queue);
      for (const dirent of getDirents(path, readdir)) {
        ArrayPrototypePush(result, dirent);
        if (dirent.isDirectory()) {
          const direntPath = pathModule.join(path, dirent.name);
          ArrayPrototypePush(queue, [
            direntPath,
            await binding.readdir(
              direntPath,
              options.encoding,
              true,
              kUsePromises,
            ),
          ]);
        }
      }
    }
  } else {
    while (queue.length > 0) {
      const { 0: path, 1: readdir } = ArrayPrototypePop(queue);
      for (const ent of readdir) {
        const direntPath = pathModule.join(path, ent);
        const stat = binding.internalModuleStat(direntPath);
        ArrayPrototypePush(
          result,
          pathModule.relative(originalPath, direntPath),
        );
        if (stat === 1) {
          ArrayPrototypePush(queue, [
            direntPath,
            await binding.readdir(
              pathModule.toNamespacedPath(direntPath),
              options.encoding,
              false,
              kUsePromises,
            ),
          ]);
        }
      }
    }
  }

  return result;
}

async function readdir(path, options) {
  options = getOptions(options);
  path = getValidatedPath(path);
  if (options.recursive) {
    return readdirRecursive(path, options);
  }
  const result = await binding.readdir(
    pathModule.toNamespacedPath(path),
    options.encoding,
    !!options.withFileTypes,
    kUsePromises,
  );
  return options.withFileTypes ?
    getDirectoryEntriesPromise(path, result) :
    result;
}

async function readlink(path, options) {
  options = getOptions(options);
  path = getValidatedPath(path, 'oldPath');
  return binding.readlink(pathModule.toNamespacedPath(path),
                          options.encoding, kUsePromises);
}

async function symlink(target, path, type_) {
  const type = (typeof type_ === 'string' ? type_ : null);
  target = getValidatedPath(target, 'target');
  path = getValidatedPath(path);
  return binding.symlink(preprocessSymlinkDestination(target, type, path),
                         pathModule.toNamespacedPath(path),
                         stringToSymlinkType(type),
                         kUsePromises);
}

async function fstat(handle, options = { bigint: false }) {
  const result = await binding.fstat(handle.fd, options.bigint, kUsePromises);
  return getStatsFromBinding(result);
}

async function lstat(path, options = { bigint: false }) {
  path = getValidatedPath(path);
  const result = await binding.lstat(pathModule.toNamespacedPath(path),
                                     options.bigint, kUsePromises);
  return getStatsFromBinding(result);
}

async function stat(path, options = { bigint: false }) {
  path = getValidatedPath(path);
  const result = await binding.stat(pathModule.toNamespacedPath(path),
                                    options.bigint, kUsePromises);
  return getStatsFromBinding(result);
}

async function statfs(path, options = { bigint: false }) {
  path = getValidatedPath(path);
  const result = await binding.statfs(pathModule.toNamespacedPath(path),
                                      options.bigint, kUsePromises);
  return getStatFsFromBinding(result);
}

async function link(existingPath, newPath) {
  existingPath = getValidatedPath(existingPath, 'existingPath');
  newPath = getValidatedPath(newPath, 'newPath');
  return binding.link(pathModule.toNamespacedPath(existingPath),
                      pathModule.toNamespacedPath(newPath),
                      kUsePromises);
}

async function unlink(path) {
  path = getValidatedPath(path);
  return binding.unlink(pathModule.toNamespacedPath(path), kUsePromises);
}

async function fchmod(handle, mode) {
  mode = parseFileMode(mode, 'mode');
  return binding.fchmod(handle.fd, mode, kUsePromises);
}

async function chmod(path, mode) {
  path = getValidatedPath(path);
  mode = parseFileMode(mode, 'mode');
  return binding.chmod(pathModule.toNamespacedPath(path), mode, kUsePromises);
}

async function lchmod(path, mode) {
  if (O_SYMLINK === undefined)
    throw new ERR_METHOD_NOT_IMPLEMENTED('lchmod()');

  const fd = await open(path, O_WRONLY | O_SYMLINK);
  return handleFdClose(fchmod(fd, mode), fd.close);
}

async function lchown(path, uid, gid) {
  path = getValidatedPath(path);
  validateInteger(uid, 'uid', -1, kMaxUserId);
  validateInteger(gid, 'gid', -1, kMaxUserId);
  return binding.lchown(pathModule.toNamespacedPath(path),
                        uid, gid, kUsePromises);
}

async function fchown(handle, uid, gid) {
  validateInteger(uid, 'uid', -1, kMaxUserId);
  validateInteger(gid, 'gid', -1, kMaxUserId);
  return binding.fchown(handle.fd, uid, gid, kUsePromises);
}

async function chown(path, uid, gid) {
  path = getValidatedPath(path);
  validateInteger(uid, 'uid', -1, kMaxUserId);
  validateInteger(gid, 'gid', -1, kMaxUserId);
  return binding.chown(pathModule.toNamespacedPath(path),
                       uid, gid, kUsePromises);
}

async function utimes(path, atime, mtime) {
  path = getValidatedPath(path);
  return binding.utimes(pathModule.toNamespacedPath(path),
                        toUnixTimestamp(atime),
                        toUnixTimestamp(mtime),
                        kUsePromises);
}

async function futimes(handle, atime, mtime) {
  atime = toUnixTimestamp(atime, 'atime');
  mtime = toUnixTimestamp(mtime, 'mtime');
  return binding.futimes(handle.fd, atime, mtime, kUsePromises);
}

async function lutimes(path, atime, mtime) {
  path = getValidatedPath(path);
  return binding.lutimes(pathModule.toNamespacedPath(path),
                         toUnixTimestamp(atime),
                         toUnixTimestamp(mtime),
                         kUsePromises);
}

async function realpath(path, options) {
  options = getOptions(options);
  path = getValidatedPath(path);
  return binding.realpath(path, options.encoding, kUsePromises);
}

async function mkdtemp(prefix, options) {
  options = getOptions(options);

  prefix = getValidatedPath(prefix, 'prefix');
  warnOnNonPortableTemplate(prefix);

  let path;
  if (typeof prefix === 'string') {
    path = `${prefix}XXXXXX`;
  } else {
    path = Buffer.concat([prefix, Buffer.from('XXXXXX')]);
  }

  return binding.mkdtemp(path, options.encoding, kUsePromises);
}

async function writeFile(path, data, options) {
  options = getOptions(options, { encoding: 'utf8', mode: 0o666, flag: 'w' });
  const flag = options.flag || 'w';

  if (!isArrayBufferView(data) && !isCustomIterable(data)) {
    validatePrimitiveStringAfterArrayBufferView(data, 'data');
    data = Buffer.from(data, options.encoding || 'utf8');
  }

  validateAbortSignal(options.signal);
  if (path instanceof FileHandle)
    return writeFileHandle(path, data, options.signal, options.encoding);

  checkAborted(options.signal);

  const fd = await open(path, flag, options.mode);
  return handleFdClose(
    writeFileHandle(fd, data, options.signal, options.encoding), fd.close);
}

function isCustomIterable(obj) {
  return isIterable(obj) && !isArrayBufferView(obj) && typeof obj !== 'string';
}

async function appendFile(path, data, options) {
  options = getOptions(options, { encoding: 'utf8', mode: 0o666, flag: 'a' });
  options = copyObject(options);
  options.flag = options.flag || 'a';
  return writeFile(path, data, options);
}

async function readFile(path, options) {
  options = getOptions(options, { flag: 'r' });
  const flag = options.flag || 'r';

  if (path instanceof FileHandle)
    return readFileHandle(path, options);

  checkAborted(options.signal);

  const fd = await open(path, flag, 0o666);
  return handleFdClose(readFileHandle(fd, options), fd.close);
}

module.exports = {
  exports: {
    access,
    copyFile,
    cp,
    open,
    opendir: promisify(opendir),
    rename,
    truncate,
    rm,
    rmdir,
    mkdir,
    readdir,
    readlink,
    symlink,
    lstat,
    stat,
    statfs,
    link,
    unlink,
    chmod,
    lchmod,
    lchown,
    chown,
    utimes,
    lutimes,
    realpath,
    mkdtemp,
    writeFile,
    appendFile,
    readFile,
    watch,
    constants,
  },

  FileHandle,
  kRef,
  kUnref,
};
