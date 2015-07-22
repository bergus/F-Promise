import {AdoptingPromise, ContinuationBuilder, FulfilledPromise, RejectedPromise} from "./Promise.js";

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
			Promise.run(adopt(new constructor(arguments)));
		};
	},
	async: function makeAsyncResolver(adopt, constructor) {
		return function resolveAsync() {
			var cont = adopt(new constructor(arguments)); // this creates the continuation immediately
			setImmediate(function runAsyncResolution() {
				Promise.run(cont);
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

// unlikely: continuations (AdoptingPromise, fork), asap (synchronous callbacks), promise-accepting resolvers (chain Promise.resolve)
var ContinuationPromise = makePromiseConstructor(ContinuationBuilder.safe, function makeResolver(constructor) {
	return function resolve() {
		return adopt(new constructor(arguments));
	};
});
function ES6Promise(fn) {
	return new Promise.strict.async.safe.uncancellable(fn).chain(Promise.resolve); // TODO: lazy chain
}

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
function makeConstructor(safe, lazy, async, cancellable) {
	var caller = safe ? config.safe : config.unsafe;
	if (cancellable)
		caller = lazy ? config.lazyCancellable(caller) : config.cancellable(caller, {isCancelled:false});
	else
		caller = lazy ? config.lazy(caller) : config.strict(caller);
	return makePromiseConstructor(caller, async ? config.async : config.sync);
}
var combinations = [["safe", "unsafe"], ["lazy", "strict"]],
    prototypes = [];
for (var i=0, l=1<<combinations.length; i<l; i++)
	prototypes.push(Object.create(AdoptingPromise.prototype));
for (var i=0; i<prototypes.length; i++) {
	var p = prototypes[i],
	    as = makeCreator(p);
	for (var j=0; j<combinations.length; j++) {
		var prop = combinations[j][i>>j & 1];
		prototypes[i ^ 1<<j][prop] = as;
		p["_"+combinations[j][0]] = !(i & 1<<j);
		p[prop] = id;
	}
}

combinations.push(["async", "sync"], ["cancellable", "uncancellable"]); // constructors only
var constructors = [];
for (var i=0, l=1<<combinations.length; i<l; i++) {
	var c = makeConstructor(~i&1, ~i&2, ~i&4, ~i&8);
	constructors.push(c);
	c.prototype = prototypes[i & 3];
	if (i>>2 == 0)
		c.prototype.constructor = c;
}
for (var i=0; i<constructors.length; i++) {
	var c = constructors[i];
	for (var j=0; j<combinations.length; j++) {
		var prop = combinations[j][i>>j & 1];
		constructors[i ^ 1<<j][prop] = c;
		c["_"+combinations[j][0]] = !(i & 1<<j);
		c[prop] = c; // can't be bad if one can state a property explicitly
	}
}

// console.log(prototypes);
// console.log(constructors);
var Promise = constructors[0].strict; // inherits from AdoptingPromise
AdoptingPromise.default = Promise;
Promise.ES6 = ES6Promise;

export default Promise;