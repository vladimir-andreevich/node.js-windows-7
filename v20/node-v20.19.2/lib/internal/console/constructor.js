'use strict';

// The Console constructor is not actually used to construct the global
// console. It's exported for backwards compatibility.

const {
  ArrayFrom,
  ArrayIsArray,
  ArrayPrototypeForEach,
  ArrayPrototypePush,
  ArrayPrototypeUnshift,
  Boolean,
  ErrorCaptureStackTrace,
  FunctionPrototypeBind,
  MathFloor,
  Number,
  NumberPrototypeToFixed,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  ObjectValues,
  ReflectApply,
  ReflectConstruct,
  ReflectOwnKeys,
  RegExpPrototypeSymbolReplace,
  SafeArrayIterator,
  SafeMap,
  SafeWeakMap,
  SafeSet,
  StringPrototypeIncludes,
  StringPrototypePadStart,
  StringPrototypeRepeat,
  StringPrototypeSlice,
  StringPrototypeSplit,
  Symbol,
  SymbolHasInstance,
  SymbolToStringTag,
} = primordials;

const { trace } = internalBinding('trace_events');
const {
  isStackOverflowError,
  codes: {
    ERR_CONSOLE_WRITABLE_STREAM,
    ERR_INCOMPATIBLE_OPTION_PAIR,
  },
} = require('internal/errors');
const {
  validateArray,
  validateInteger,
  validateObject,
  validateOneOf,
} = require('internal/validators');
const { previewEntries } = internalBinding('util');
const { Buffer: { isBuffer } } = require('buffer');
const {
  inspect,
  formatWithOptions,
} = require('internal/util/inspect');
const {
  isTypedArray, isSet, isMap, isSetIterator, isMapIterator,
} = require('internal/util/types');
const {
  CHAR_LOWERCASE_B: kTraceBegin,
  CHAR_LOWERCASE_E: kTraceEnd,
  CHAR_LOWERCASE_N: kTraceInstant,
  CHAR_UPPERCASE_C: kTraceCount,
} = require('internal/constants');
const kCounts = Symbol('counts');

const kTraceConsoleCategory = 'node,node.console';

const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;
const kMaxGroupIndentation = 1000;

// Lazy loaded for startup performance.
let cliTable;

let utilColors;
function lazyUtilColors() {
  utilColors ??= require('internal/util/colors');
  return utilColors;
}

// Track amount of indentation required via `console.group()`.
const kGroupIndent = Symbol('kGroupIndent');
const kGroupIndentationWidth = Symbol('kGroupIndentWidth');
const kFormatForStderr = Symbol('kFormatForStderr');
const kFormatForStdout = Symbol('kFormatForStdout');
const kGetInspectOptions = Symbol('kGetInspectOptions');
const kColorMode = Symbol('kColorMode');
const kIsConsole = Symbol('kIsConsole');
const kWriteToConsole = Symbol('kWriteToConsole');
const kBindProperties = Symbol('kBindProperties');
const kBindStreamsEager = Symbol('kBindStreamsEager');
const kBindStreamsLazy = Symbol('kBindStreamsLazy');
const kUseStdout = Symbol('kUseStdout');
const kUseStderr = Symbol('kUseStderr');

const optionsMap = new SafeWeakMap();
function Console(options /* or: stdout, stderr, ignoreErrors = true */) {
  // We have to test new.target here to see if this function is called
  // with new, because we need to define a custom instanceof to accommodate
  // the global console.
  if (new.target === undefined) {
    return ReflectConstruct(Console, arguments);
  }

  if (!options || typeof options.write === 'function') {
    options = {
      stdout: options,
      stderr: arguments[1],
      ignoreErrors: arguments[2],
    };
  }

  const {
    stdout,
    stderr = stdout,
    ignoreErrors = true,
    colorMode = 'auto',
    inspectOptions,
    groupIndentation,
  } = options;

  if (!stdout || typeof stdout.write !== 'function') {
    throw new ERR_CONSOLE_WRITABLE_STREAM('stdout');
  }
  if (!stderr || typeof stderr.write !== 'function') {
    throw new ERR_CONSOLE_WRITABLE_STREAM('stderr');
  }

  validateOneOf(colorMode, 'colorMode', ['auto', true, false]);

  if (groupIndentation !== undefined) {
    validateInteger(groupIndentation, 'groupIndentation',
                    0, kMaxGroupIndentation);
  }

  if (inspectOptions !== undefined) {
    validateObject(inspectOptions, 'options.inspectOptions');

    if (inspectOptions.colors !== undefined &&
        options.colorMode !== undefined) {
      throw new ERR_INCOMPATIBLE_OPTION_PAIR(
        'options.inspectOptions.color', 'colorMode');
    }
    optionsMap.set(this, inspectOptions);
  }

  // Bind the prototype functions to this Console instance
  ArrayPrototypeForEach(ObjectKeys(Console.prototype), (key) => {
    // We have to bind the methods grabbed from the instance instead of from
    // the prototype so that users extending the Console can override them
    // from the prototype chain of the subclass.
    this[key] = FunctionPrototypeBind(this[key], this);
    ObjectDefineProperty(this[key], 'name', {
      __proto__: null,
      value: key,
    });
  });

  this[kBindStreamsEager](stdout, stderr);
  this[kBindProperties](ignoreErrors, colorMode, groupIndentation);
}

const consolePropAttributes = {
  writable: true,
  enumerable: false,
  configurable: true,
};

// Fixup global.console instanceof global.console.Console
ObjectDefineProperty(Console, SymbolHasInstance, {
  __proto__: null,
  value(instance) {
    return instance[kIsConsole];
  },
});

const kColorInspectOptions = { colors: true };
const kNoColorInspectOptions = {};

ObjectDefineProperties(Console.prototype, {
  [kBindStreamsEager]: {
    __proto__: null,
    ...consolePropAttributes,
    // Eager version for the Console constructor
    value: function(stdout, stderr) {
      ObjectDefineProperties(this, {
        '_stdout': { __proto__: null, ...consolePropAttributes, value: stdout },
        '_stderr': { __proto__: null, ...consolePropAttributes, value: stderr },
      });
    },
  },
  [kBindStreamsLazy]: {
    __proto__: null,
    ...consolePropAttributes,
    // Lazily load the stdout and stderr from an object so we don't
    // create the stdio streams when they are not even accessed
    value: function(object) {
      let stdout;
      let stderr;
      ObjectDefineProperties(this, {
        '_stdout': {
          __proto__: null,
          enumerable: false,
          configurable: true,
          get() {
            if (!stdout) stdout = object.stdout;
            return stdout;
          },
          set(value) { stdout = value; },
        },
        '_stderr': {
          __proto__: null,
          enumerable: false,
          configurable: true,
          get() {
            if (!stderr) { stderr = object.stderr; }
            return stderr;
          },
          set(value) { stderr = value; },
        },
      });
    },
  },
  [kBindProperties]: {
    __proto__: null,
    ...consolePropAttributes,
    value: function(ignoreErrors, colorMode, groupIndentation = 2) {
      ObjectDefineProperties(this, {
        '_stdoutErrorHandler': {
          __proto__: null,
          ...consolePropAttributes,
          value: createWriteErrorHandler(this, kUseStdout),
        },
        '_stderrErrorHandler': {
          ...consolePropAttributes,
          __proto__: null,
          value: createWriteErrorHandler(this, kUseStderr),
        },
        '_ignoreErrors': {
          __proto__: null,
          ...consolePropAttributes,
          value: Boolean(ignoreErrors),
        },
        '_times': { __proto__: null, ...consolePropAttributes, value: new SafeMap() },
        // Corresponds to https://console.spec.whatwg.org/#count-map
        [kCounts]: { __proto__: null, ...consolePropAttributes, value: new SafeMap() },
        [kColorMode]: { __proto__: null, ...consolePropAttributes, value: colorMode },
        [kIsConsole]: { __proto__: null, ...consolePropAttributes, value: true },
        [kGroupIndent]: { __proto__: null, ...consolePropAttributes, value: '' },
        [kGroupIndentationWidth]: {
          __proto__: null,
          ...consolePropAttributes,
          value: groupIndentation,
        },
        [SymbolToStringTag]: {
          __proto__: null,
          writable: false,
          enumerable: false,
          configurable: true,
          value: 'console',
        },
      });
    },
  },
  [kWriteToConsole]: {
    __proto__: null,
    ...consolePropAttributes,
    value: function(streamSymbol, string) {
      const ignoreErrors = this._ignoreErrors;
      const groupIndent = this[kGroupIndent];

      const useStdout = streamSymbol === kUseStdout;
      const stream = useStdout ? this._stdout : this._stderr;
      const errorHandler = useStdout ?
        this._stdoutErrorHandler : this._stderrErrorHandler;

      if (groupIndent.length !== 0) {
        if (StringPrototypeIncludes(string, '\n')) {
          string = RegExpPrototypeSymbolReplace(/\n/g, string, `\n${groupIndent}`);
        }
        string = groupIndent + string;
      }
      string += '\n';

      if (ignoreErrors === false) return stream.write(string);

      // There may be an error occurring synchronously (e.g. for files or TTYs
      // on POSIX systems) or asynchronously (e.g. pipes on POSIX systems), so
      // handle both situations.
      try {
        // Add and later remove a noop error handler to catch synchronous
        // errors.
        if (stream.listenerCount('error') === 0)
          stream.once('error', noop);

        stream.write(string, errorHandler);
      } catch (e) {
        // Console is a debugging utility, so it swallowing errors is not
        // desirable even in edge cases such as low stack space.
        if (isStackOverflowError(e))
          throw e;
        // Sorry, there's no proper way to pass along the error here.
      } finally {
        stream.removeListener('error', noop);
      }
    },
  },
  [kGetInspectOptions]: {
    __proto__: null,
    ...consolePropAttributes,
    value: function(stream) {
      let color = this[kColorMode];
      if (color === 'auto') {
        color = lazyUtilColors().shouldColorize(stream);
      }

      const options = optionsMap.get(this);
      if (options) {
        if (options.colors === undefined) {
          options.colors = color;
        }
        return options;
      }

      return color ? kColorInspectOptions : kNoColorInspectOptions;
    },
  },
  [kFormatForStdout]: {
    __proto__: null,
    ...consolePropAttributes,
    value: function(args) {
      const opts = this[kGetInspectOptions](this._stdout);
      ArrayPrototypeUnshift(args, opts);
      return ReflectApply(formatWithOptions, null, args);
    },
  },
  [kFormatForStderr]: {
    __proto__: null,
    ...consolePropAttributes,
    value: function(args) {
      const opts = this[kGetInspectOptions](this._stderr);
      ArrayPrototypeUnshift(args, opts);
      return ReflectApply(formatWithOptions, null, args);
    },
  },
});

// Make a function that can serve as the callback passed to `stream.write()`.
function createWriteErrorHandler(instance, streamSymbol) {
  return (err) => {
    // This conditional evaluates to true if and only if there was an error
    // that was not already emitted (which happens when the _write callback
    // is invoked asynchronously).
    const stream = streamSymbol === kUseStdout ?
      instance._stdout : instance._stderr;
    if (err !== null && !stream._writableState.errorEmitted) {
      // If there was an error, it will be emitted on `stream` as
      // an `error` event. Adding a `once` listener will keep that error
      // from becoming an uncaught exception, but since the handler is
      // removed after the event, non-console.* writes won't be affected.
      // we are only adding noop if there is no one else listening for 'error'
      if (stream.listenerCount('error') === 0) {
        stream.once('error', noop);
      }
    }
  };
}

const consoleMethods = {
  log(...args) {
    this[kWriteToConsole](kUseStdout, this[kFormatForStdout](args));
  },


  warn(...args) {
    this[kWriteToConsole](kUseStderr, this[kFormatForStderr](args));
  },


  dir(object, options) {
    this[kWriteToConsole](kUseStdout, inspect(object, {
      customInspect: false,
      ...this[kGetInspectOptions](this._stdout),
      ...options,
    }));
  },

  time(label = 'default') {
    // Coerces everything other than Symbol to a string
    label = `${label}`;
    if (this._times.has(label)) {
      process.emitWarning(`Label '${label}' already exists for console.time()`);
      return;
    }
    trace(kTraceBegin, kTraceConsoleCategory, `time::${label}`, 0);
    this._times.set(label, process.hrtime());
  },

  timeEnd(label = 'default') {
    // Coerces everything other than Symbol to a string
    label = `${label}`;
    const found = timeLogImpl(this, 'timeEnd', label);
    trace(kTraceEnd, kTraceConsoleCategory, `time::${label}`, 0);
    if (found) {
      this._times.delete(label);
    }
  },

  timeLog(label = 'default', ...data) {
    // Coerces everything other than Symbol to a string
    label = `${label}`;
    timeLogImpl(this, 'timeLog', label, data);
    trace(kTraceInstant, kTraceConsoleCategory, `time::${label}`, 0);
  },

  trace: function trace(...args) {
    const err = {
      name: 'Trace',
      message: this[kFormatForStderr](args),
    };
    ErrorCaptureStackTrace(err, trace);
    this.error(err.stack);
  },

  assert(expression, ...args) {
    if (!expression) {
      args[0] = `Assertion failed${args.length === 0 ? '' : `: ${args[0]}`}`;
      // The arguments will be formatted in warn() again
      ReflectApply(this.warn, this, args);
    }
  },

  // Defined by: https://console.spec.whatwg.org/#clear
  clear() {
    // It only makes sense to clear if _stdout is a TTY.
    // Otherwise, do nothing.
    if (this._stdout.isTTY && process.env.TERM !== 'dumb') {
      // The require is here intentionally to avoid readline being
      // required too early when console is first loaded.
      const {
        cursorTo,
        clearScreenDown,
      } = require('internal/readline/callbacks');
      cursorTo(this._stdout, 0, 0);
      clearScreenDown(this._stdout);
    }
  },

  // Defined by: https://console.spec.whatwg.org/#count
  count(label = 'default') {
    // Ensures that label is a string, and only things that can be
    // coerced to strings. e.g. Symbol is not allowed
    label = `${label}`;
    const counts = this[kCounts];
    let count = counts.get(label);
    if (count === undefined)
      count = 1;
    else
      count++;
    counts.set(label, count);
    trace(kTraceCount, kTraceConsoleCategory, `count::${label}`, 0, count);
    this.log(`${label}: ${count}`);
  },

  // Defined by: https://console.spec.whatwg.org/#countreset
  countReset(label = 'default') {
    const counts = this[kCounts];
    if (!counts.has(label)) {
      process.emitWarning(`Count for '${label}' does not exist`);
      return;
    }
    trace(kTraceCount, kTraceConsoleCategory, `count::${label}`, 0, 0);
    counts.delete(`${label}`);
  },

  group(...data) {
    if (data.length > 0) {
      ReflectApply(this.log, this, data);
    }
    this[kGroupIndent] +=
      StringPrototypeRepeat(' ', this[kGroupIndentationWidth]);
  },

  groupEnd() {
    this[kGroupIndent] = StringPrototypeSlice(
      this[kGroupIndent],
      0,
      this[kGroupIndent].length - this[kGroupIndentationWidth],
    );
  },

  // https://console.spec.whatwg.org/#table
  table(tabularData, properties) {
    if (properties !== undefined)
      validateArray(properties, 'properties');

    if (tabularData === null || typeof tabularData !== 'object')
      return this.log(tabularData);

    cliTable ??= require('internal/cli_table');
    const final = (k, v) => this.log(cliTable(k, v));

    const _inspect = (v) => {
      const depth = v !== null &&
                    typeof v === 'object' &&
                    !isArray(v) &&
                    ObjectKeys(v).length > 2 ? -1 : 0;
      const opt = {
        depth,
        maxArrayLength: 3,
        breakLength: Infinity,
        ...this[kGetInspectOptions](this._stdout),
      };
      return inspect(v, opt);
    };
    const getIndexArray = (length) => ArrayFrom(
      { length }, (_, i) => _inspect(i));

    const mapIter = isMapIterator(tabularData);
    let isKeyValue = false;
    let i = 0;
    if (mapIter) {
      const res = previewEntries(tabularData, true);
      tabularData = res[0];
      isKeyValue = res[1];
    }

    if (isKeyValue || isMap(tabularData)) {
      const keys = [];
      const values = [];
      let length = 0;
      if (mapIter) {
        for (; i < tabularData.length / 2; ++i) {
          ArrayPrototypePush(keys, _inspect(tabularData[i * 2]));
          ArrayPrototypePush(values, _inspect(tabularData[i * 2 + 1]));
          length++;
        }
      } else {
        for (const { 0: k, 1: v } of tabularData) {
          ArrayPrototypePush(keys, _inspect(k));
          ArrayPrototypePush(values, _inspect(v));
          length++;
        }
      }
      return final([
        iterKey, keyKey, valuesKey,
      ], [
        getIndexArray(length),
        keys,
        values,
      ]);
    }

    const setIter = isSetIterator(tabularData);
    if (setIter)
      tabularData = previewEntries(tabularData);

    const setlike = setIter || mapIter || isSet(tabularData);
    if (setlike) {
      const values = [];
      let length = 0;
      for (const v of tabularData) {
        ArrayPrototypePush(values, _inspect(v));
        length++;
      }
      return final([iterKey, valuesKey], [getIndexArray(length), values]);
    }

    const map = { __proto__: null };
    let hasPrimitives = false;
    const valuesKeyArray = [];
    const indexKeyArray = ObjectKeys(tabularData);

    for (; i < indexKeyArray.length; i++) {
      const item = tabularData[indexKeyArray[i]];
      const primitive = item === null ||
          (typeof item !== 'function' && typeof item !== 'object');
      if (properties === undefined && primitive) {
        hasPrimitives = true;
        valuesKeyArray[i] = _inspect(item);
      } else {
        const keys = properties || ObjectKeys(item);
        for (const key of keys) {
          map[key] ??= [];
          if ((primitive && properties) ||
               !ObjectPrototypeHasOwnProperty(item, key))
            map[key][i] = '';
          else
            map[key][i] = _inspect(item[key]);
        }
      }
    }

    const keys = ObjectKeys(map);
    const values = ObjectValues(map);
    if (hasPrimitives) {
      ArrayPrototypePush(keys, valuesKey);
      ArrayPrototypePush(values, valuesKeyArray);
    }
    ArrayPrototypeUnshift(keys, indexKey);
    ArrayPrototypeUnshift(values, indexKeyArray);

    return final(keys, values);
  },
};

// Returns true if label was found
function timeLogImpl(self, name, label, data) {
  const time = self._times.get(label);
  if (time === undefined) {
    process.emitWarning(`No such label '${label}' for console.${name}()`);
    return false;
  }
  const duration = process.hrtime(time);
  const ms = duration[0] * 1000 + duration[1] / 1e6;

  const formatted = formatTime(ms);

  if (data === undefined) {
    self.log('%s: %s', label, formatted);
  } else {
    self.log('%s: %s', label, formatted, ...new SafeArrayIterator(data));
  }
  return true;
}

function pad(value) {
  return StringPrototypePadStart(`${value}`, 2, '0');
}

function formatTime(ms) {
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (ms >= kSecond) {
    if (ms >= kMinute) {
      if (ms >= kHour) {
        hours = MathFloor(ms / kHour);
        ms = ms % kHour;
      }
      minutes = MathFloor(ms / kMinute);
      ms = ms % kMinute;
    }
    seconds = ms / kSecond;
  }

  if (hours !== 0 || minutes !== 0) {
    ({ 0: seconds, 1: ms } = StringPrototypeSplit(
      NumberPrototypeToFixed(seconds, 3),
      '.',
    ));
    const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
    return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? 'h:m' : ''}m:ss.mmm)`;
  }

  if (seconds !== 0) {
    return `${NumberPrototypeToFixed(seconds, 3)}s`;
  }

  return `${Number(NumberPrototypeToFixed(ms, 3))}ms`;
}

const keyKey = 'Key';
const valuesKey = 'Values';
const indexKey = '(index)';
const iterKey = '(iteration index)';

const isArray = (v) => ArrayIsArray(v) || isTypedArray(v) || isBuffer(v);

function noop() {}

for (const method of ReflectOwnKeys(consoleMethods))
  Console.prototype[method] = consoleMethods[method];

Console.prototype.debug = Console.prototype.log;
Console.prototype.info = Console.prototype.log;
Console.prototype.dirxml = Console.prototype.log;
Console.prototype.error = Console.prototype.warn;
Console.prototype.groupCollapsed = Console.prototype.group;

function initializeGlobalConsole(globalConsole) {
  globalConsole[kBindStreamsLazy](process);
  const {
    namespace: {
      addSerializeCallback,
      isBuildingSnapshot,
    },
  } = require('internal/v8/startup_snapshot');

  if (!internalBinding('config').hasInspector || !isBuildingSnapshot()) {
    return;
  }
  const { console: consoleFromVM } = internalBinding('inspector');
  const nodeConsoleKeys = ObjectKeys(Console.prototype);
  const vmConsoleKeys = ObjectKeys(consoleFromVM);
  const originalKeys = new SafeSet(vmConsoleKeys.concat(nodeConsoleKeys));
  const inspectorConsoleKeys = new SafeSet();
  for (const key of ObjectKeys(globalConsole)) {
    if (!originalKeys.has(key)) {
      inspectorConsoleKeys.add(key);
    }
  }
  // During deserialization these should be reinstalled to console by
  // V8 when the inspector client is created.
  addSerializeCallback(() => {
    for (const key of inspectorConsoleKeys) {
      globalConsole[key] = undefined;
    }
  });
}

module.exports = {
  Console,
  kBindStreamsLazy,
  kBindProperties,
  initializeGlobalConsole,
  formatTime, // exported for tests
};
