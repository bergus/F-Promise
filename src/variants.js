import {AdoptingPromise, FulfilledPromise, RejectedPromise} from "base";
import {ContinuationBuilder} from "continuations";
import {} from "Promise";

function makePromiseConstructor(call, makeResolver) {
	// makeResolver creates a fulfill/reject resolver with methods to actually execute the continuations they might return
	function Promise(fn) {
		AdoptingPromise.call(this, function callResolver(adopt, progress, isCancellable) {
			return call(fn, this, makeResolver(adopt, FulfilledPromise), makeResolver(adopt, RejectedPromise), function triggerProgress() {
				Promise.run(Promise.trigger(progress, arguments));
			}, isCancellable);
		});
		fn = null; // garbage collection
	}
	return Object.setPrototypeOf(Promise, AdoptingPromise);
}
var config = {
	sync: function makeSyncResolver(adopt, constructor) {
		return function resolveSync() {
			AdoptingPromise.run(adopt(new constructor(arguments)));
		};
	},
	async: function makeAsyncResolver(adopt, constructor) {
		return function resolveAsync() {
			var cont = adopt(new constructor(arguments)); // this creates the continuation immediately
			setImmediate(function runAsyncResolution() {
				AdoptingPromise.run(cont);
			});
		};
	},
	unsafe: Function.call.bind(Function.call), // function unsafeCaller(fn, that, fulfill, reject, progress) { … }
	safe: function safeCaller(fn, that, fulfill, reject, progress) {
		try {
			return fn.call(that, fulfill, reject, progress);
		} catch(e) {
			reject(e);
		}
	},
	lazy: function(caller) {
		return function lazyCaller(fn, that, fulfill, reject, progress, isCancellable) {
			return ContinuationBuilder.safe(function lazyCall() { // a continuation
				caller(fn, that, fulfill, reject, progress, isCancellable);
			});
		};
	},
	strict: function(caller) {
		return function strictCall(fn, that, fulfill, reject, progress, isCancellable) {
			caller(fn, that, fulfill, reject, progress);
			// doesn't return the result
		};
	},
	cancellable: function(caller, token) {
		return function(fn, that, fulfill, reject, progress, isCancellable) {
			var cancel = caller(fn, that, fulfill, reject, progress);
			if (typeof cancel != "function") return;
			that.onsend = function send(msg, error) {
				if (msg != "cancel" || !isCancellable(token)) return;
				try {
					cancel(error);
				} finally {
					cancel = null;
					reject(error); // return reject continuation???
				}
			};
		};
	},
	lazyCancellable: function(caller) {
		var token = {isCancelled:false};
		caller = this.lazy(this.cancellable(caller, token));
		return function(fn, that, fulfill, reject, progress, isCancellable) {
			that.onsend = function send(msg, error) {
				if (msg != "cancel" || !isCancellable(token)) return;
				// the adopt call is expected to kill the waiting lazy continuation (buggy???)
				reject(error); // return reject continuation???
			};
			return caller(fn, that, fulfill, reject, progress, isCancellable);
		};
	}
};

/* unlikely: continuations (AdoptingPromise, fork), asap (synchronous callbacks), promise-accepting resolvers (chain Promise.resolve)
var ContinuationPromise = makePromiseConstructor(ContinuationBuilder.safe, function makeResolver(constructor) {
	return function resolve() {
		return adopt(new constructor(arguments));
	};
}); */

function makeCreator(proto) {
	return function as() {
		var promise = Object.create(proto);
		promise.fork = this.fork;
		promise.onsend = this.onsend;
		return promise;
	};
}
function id() {
	return this;
}
function makePrototype(safe, lazy) {
	return Object.create(AdoptingPromise.prototype);
}
function makeConstructor(safe, lazy, async, cancellable) {
	var caller = safe ? config.safe : config.unsafe;
	if (cancellable)
		caller = lazy ? config.lazyCancellable(caller) : config.cancellable(caller, {isCancelled:false});
	else
		caller = lazy ? config.lazy(caller) : config.strict(caller);
	return makePromiseConstructor(caller, async ? config.async : config.sync);
}

var characteristics = [["safe", "unsafe"], ["lazy", "strict"]],
    prototypes = [];
for (var i=0, l=1<<characteristics.length; i<l; i++)
	prototypes.push(makePrototype(~i&1, ~i&2));
for (var i=0; i<prototypes.length; i++) {
	var p = prototypes[i],
	    as = makeCreator(p);
	for (var j=0; j<characteristics.length; j++) {
		var prop = characteristics[j][i>>j & 1]; // get description for characteristic of this prototype
		prototypes[i ^ 1<<j][prop] = as; // create converter on oppositional prototype
		p[prop]                    = id; // create identity  on this prototype
		p["_"+characteristics[j][0]] = !(i & 1<<j); // set feature for this characteristic
	}
}

characteristics.push(["async", "sync"], ["cancellable", "uncancellable"]); // constructors only
var constructors = [];
for (var i=0, l=1<<characteristics.length; i<l; i++)
	constructors.push(makeConstructor(~i&1, ~i&2, ~i&4, ~i&8));
for (var i=0; i<constructors.length; i++) {
	var c = constructors[i];
	for (var j=0; j<characteristics.length; j++) {
		var prop = characteristics[j][i>>j & 1]; // get description for characteristic of this constructor
		constructors[i ^ 1<<j][prop] = c; // link from oppositional constructor
		c["_"+characteristics[j][0]] = !(i & 1<<j); // set feature for this characteristic
		c[prop] = c; // link from itself (can't be bad if one can state a characteristic explicitly)
	}
}

// link each other - &3 is equivalent to %prototypes.length
for (var i=0; i<constructors.length; i++)
	constructors[i].prototype = prototypes[i & 3];
for (var i=0; i<prototypes.length; i++)
	prototypes[i & 3].constructor = constructors[i];

// console.log(prototypes);
// console.log(constructors);
var DefaultPromise = AdoptingPromise.default = constructors[0].strict; // inherits from AdoptingPromise

function ES6Promise(fn) {
	return new DefaultPromise.strict.safe.async.uncancellable(fn).chain(DefaultPromise.resolve); // TODO: lazy chain
}
ES6Promise.prototype = DefaultPromise.prototype;
Object.setPrototypeOf(ES6Promise, AdoptingPromise);
DefaultPromise.ES6 = ES6Promise; // or on AdoptingPromise???


export default DefaultPromise;