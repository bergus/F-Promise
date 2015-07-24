import {AdoptingPromise, FulfilledPromise, RejectedPromise} from "base";
import {ContinuationBuilder} from "continuations";

AdoptingPromise.create = function create(constructor, arg) {
// instantiates a new Promise object of the current subclass
// using the supplied super constructor
	// TODO: optimisation
//	if (this.prototype == CommonPrototype)
//		console.warn("The abstract base class should not be instantiated except for internal purposes") & console.trace();
	var o = Object.create(this.prototype);
	constructor.call(o, arg);
	return o;
};

function makeUnitFunction(constructor) {
	return function unit(val) {
		// like `new constructor(arguments)`
		// optimisable in V8 - http://jsperf.com/array-with-and-without-length/
		var args = [];
		switch (arguments.length) {
			case 3: args[2] = arguments[2];
			case 2: args[1] = arguments[1];
			case 1: args[0] = val;
			case 0: break;
			default:
				for (var i=0; i<arguments.length; i++)
					args[i] = arguments[i];
		}
		return this.create(constructor, args);
	};
}

// unit function for extensible constructors
var xfulfill = makeUnitFunction(FulfilledPromise);
var xreject  = makeUnitFunction(RejectedPromise);

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
	Object.setPrototypeOf(Promise, AdoptingPromise);
	
	Promise.of = Promise.fulfill = xfulfill;
	Promise.reject = xreject;
	
	return Promise;
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
	eager: function(caller) {
		return function eagerCall(fn, that, fulfill, reject, progress, isCancellable) {
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
		var token = {isCancelled:false}; // TODO: fix token scope
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

export default function makeConstructor(safe, lazy, async, cancellable) {
	var caller = safe ? config.safe : config.unsafe;
	if (cancellable)
		caller = lazy ? config.lazyCancellable(caller) : config.cancellable(caller, {isCancelled:false}); // TODO: fix token scope
	else
		caller = lazy ? config.lazy(caller) : config.eager(caller);
	return makePromiseConstructor(caller, async ? config.async : config.sync);
};