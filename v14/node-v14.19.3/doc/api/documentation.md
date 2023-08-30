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
> [Semantic Versioning][] rules. Non-backward compatible changes or removal may
> occur in any future release. Use of the feature is not recommended in
> production environments.

<!-- separator -->

> Stability: 2 - Stable. Compatibility with the npm ecosystem is a high
> priority.

<!-- separator -->

> Stability: 3 - Legacy. The feature is no longer recommended for use. While it
> likely will not be removed, and is still covered by semantic-versioning
> guarantees, use of the feature should be avoided.

Use caution when making use of Experimental features, particularly within
modules. Users may not be aware that experimental features are being used.
Bugs or behavior changes may surprise users when Experimental API
modifications occur. To avoid surprises, use of an Experimental feature may need
a command-line flag. Experimental features may also emit a [warning][].

## Stability overview
<!-- STABILITY_OVERVIEW_SLOT_BEGIN -->
| API | Stability |
| --- | --------- |
| [assert](assert.html) | (2) Stable |
| [async_hooks](async_hooks.html) | (1) Experimental |
| [buffer](buffer.html) | (2) Stable |
| [child_process](child_process.html) | (2) Stable |
| [cluster](cluster.html) | (2) Stable |
| [console](console.html) | (2) Stable |
| [crypto](crypto.html) | (2) Stable |
| [dgram](dgram.html) | (2) Stable |
| [diagnostics_channel](diagnostics_channel.html) | (1) Experimental |
| [dns](dns.html) | (2) Stable |
| [domain](domain.html) | (0) Deprecated |
| [fs](fs.html) | (2) Stable |
| [http](http.html) | (2) Stable |
| [http/2](http2.html) | (2) Stable |
| [https](https.html) | (2) Stable |
| [inspector](inspector.html) | (2) Stable |
| [module](modules.html) | (2) Stable |
| [os](os.html) | (2) Stable |
| [path](path.html) | (2) Stable |
| [performance_measurement_apis](perf_hooks.html) | (2) Stable |
| [punycode](punycode.html) | (0) Deprecated |
| [querystring](querystring.html) | (3) Legacy |
| [readline](readline.html) | (2) Stable |
| [repl](repl.html) | (2) Stable |
| [stream](stream.html) | (2) Stable |
| [string_decoder](string_decoder.html) | (2) Stable |
| [timers](timers.html) | (2) Stable |
| [tls_(ssl)](tls.html) | (2) Stable |
| [trace_events](tracing.html) | (1) Experimental |
| [tty](tty.html) | (2) Stable |
| [url](url.html) | (2) Stable |
| [util](util.html) | (2) Stable |
| [vm](vm.html) | (2) Stable |
| [webassembly_system_interface_(wasi)](wasi.html) | (1) Experimental |
| [worker_threads](worker_threads.html) | (2) Stable |
| [zlib](zlib.html) | (2) Stable |
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

[Semantic Versioning]: https://semver.org/
[V8 JavaScript engine]: https://v8.dev/
[the contributing guide]: https://github.com/nodejs/node/blob/HEAD/CONTRIBUTING.md
[the issue tracker]: https://github.com/nodejs/node/issues/new
[warning]: process.md#process_event_warning
