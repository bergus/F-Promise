Things to do:

* implement debugging
  links for promise.cast (github, domenic)
  link to so [promise] stack bluebird 
* fix bugs
* write tests for progression
* write tests for cancellation
* write tests for lazyness
* if possible, run tests from other implementations with compatible api
* benchmark against other implementations
 - bluebird
 - cujojs/when
 - kriskowal/q
 - (dojo)
 - https://github.com/petkaantonov/bluebird/blob/master/benchmark/stats/latest.md
* implement utility functions
 - catch/handle with Bluebird semantics
 - done (or whatever) to force a lazy chain
 - finally, using
 - Fantasyland's ap
 - promisify for node and dom
* write Functor and Monad utilities
* split files and make build process
* use own repository
  - test by giving Lazy and own subdirectory, and then own repository
* choose license
* write readme
 - links to promise introductions
 - why you should use this library
  - higly functional capabilities, algebraic
  - rich features: lazyness, smart cancellation, multivalues
  - easy debugging?
  - speed?
  - size? (ratio?)
 - how to include this library
 - how to switch to this library
* register with Promises/A+ and Fantasyland
 - include badges in readme
* write API docs (not the technical implementation doku.md)
* publish github pages website
* promote the issue tracker, possibly stackoverflow
* ...
* the things that were forgotten
* shameless advertising
  - http://stackoverflow.com/questions/25556716/cancelling-promises