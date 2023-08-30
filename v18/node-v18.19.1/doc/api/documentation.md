# About this documentation

<!--introduced_in=v0.10.0-->

<!-- type=misc -->

Welcome to the official API reference documentation for Node.js!

Node.js is a JavaScript runtime built on the [V8 JavaScript engine][].

## Contributing

Report errors in this documentation in [the issue tracker][]. See
[the contributing guide][] for directions on how to submit pull requests.

## Stability index

<!--type=misc-->

Throughout the documentation are indications of a section's stability. Some APIs
are so proven and so relied upon that they are unlikely to ever change at all.
Others are brand new and experimental, or known to be hazardous.

The stability indices are as follows:

> Stability: 0 - Deprecated. The feature may emit warnings. Backward
> compatibility is not guaranteed.

<!-- separator -->

> Stability: 1 - Experimental. The feature is not subject to
> [semantic versioning][] rules. Non-backward compatible changes or removal may
> occur in any future release. Use of the feature is not recommended in
> production environments.

<!-- separator -->

> Stability: 2 - Stable. Compatibility with the npm ecosystem is a high
> priority.

<!-- separator -->

> Stability: 3 - Legacy. Although this feature is unlikely to be removed and is
> still covered by semantic versioning guarantees, it is no longer actively
> maintained, and other alternatives are available.

Features are marked as legacy rather than being deprecated if their use does no
harm, and they are widely relied upon within the npm ecosystem. Bugs found in
legacy features are unlikely to be fixed.

Use caution when making use of Experimental features, particularly within
modules. Users may not be aware that experimental features are being used.
Bugs or behavior changes may surprise users when Experimental API
modifications occur. To avoid surprises, use of an Experimental feature may need
a command-line flag. Experimental features may also emit a [warning][].

## Stability overview

<!-- STABILITY_OVERVIEW_SLOT_BEGIN -->
| API | Stability |
| --- | --------- |
| [Assert](assert.html) | (2) Stable |
| [Async hooks](async_hooks.html) | (1) Experimental |
| [Asynchronous context tracking](async_context.html) | (2) Stable |
| [Buffer](buffer.html) | (2) Stable |
| [Child process](child_process.html) | (2) Stable |
| [Cluster](cluster.html) | (2) Stable |
| [Console](console.html) | (2) Stable |
| [Crypto](crypto.html) | (2) Stable |
| [Diagnostics Channel](diagnostics_channel.html) | (2) Stable |
| [DNS](dns.html) | (2) Stable |
| [Domain](domain.html) | (0) Deprecated |
| [File system](fs.html) | (2) Stable |
| [HTTP](http.html) | (2) Stable |
| [HTTP/2](http2.html) | (2) Stable |
| [HTTPS](https.html) | (2) Stable |
| [Inspector](inspector.html) | (2) Stable |
| [Modules: `node:module` API](module.html) | (1) .1 - Active development |
| [Modules: CommonJS modules](modules.html) | (2) Stable |
| [OS](os.html) | (2) Stable |
| [Path](path.html) | (2) Stable |
| [Performance measurement APIs](perf_hooks.html) | (2) Stable |
| [Punycode](punycode.html) | (0) Deprecated |
| [Query string](querystring.html) | (2) Stable |
| [Readline](readline.html) | (2) Stable |
| [REPL](repl.html) | (2) Stable |
| [Single executable applications](single-executable-applications.html) | (1) Experimental: This feature is being designed and will change. |
| [Stream](stream.html) | (2) Stable |
| [String decoder](string_decoder.html) | (2) Stable |
| [Test runner](test.html) | (1) Experimental |
| [Timers](timers.html) | (2) Stable |
| [TLS (SSL)](tls.html) | (2) Stable |
| [Trace events](tracing.html) | (1) Experimental |
| [TTY](tty.html) | (2) Stable |
| [UDP/datagram sockets](dgram.html) | (2) Stable |
| [URL](url.html) | (2) Stable |
| [Util](util.html) | (2) Stable |
| [VM (executing JavaScript)](vm.html) | (2) Stable |
| [Web Crypto API](webcrypto.html) | (1) Experimental |
| [Web Streams API](webstreams.html) | (1) Experimental. |
| [WebAssembly System Interface (WASI)](wasi.html) | (1) Experimental |
| [Worker threads](worker_threads.html) | (2) Stable |
| [Zlib](zlib.html) | (2) Stable |
<!-- STABILITY_OVERVIEW_SLOT_END -->

## JSON output

<!-- YAML
added: v0.6.12
-->

Every `.html` document has a corresponding `.json` document. This is for IDEs
and other utilities that consume the documentation.

## System calls and man pages

Node.js functions which wrap a system call will document that. The docs link
to the corresponding man pages which describe how the system call works.

Most Unix system calls have Windows analogues. Still, behavior differences may
be unavoidable.

[V8 JavaScript engine]: https://v8.dev/
[semantic versioning]: https://semver.org/
[the contributing guide]: https://github.com/nodejs/node/blob/HEAD/CONTRIBUTING.md
[the issue tracker]: https://github.com/nodejs/node/issues/new
[warning]: process.md#event-warning
